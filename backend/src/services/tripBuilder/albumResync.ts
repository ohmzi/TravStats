/**
 * Updating the album of an existing trip (spec 2026-10-09 §K.3).
 *
 * This file has two halves: the planning (target album, what to add, what lies
 * outside the dates), pure apart from its injected Immich client, and the write
 * (`resyncTripAlbum`, Task 155). Both only ever act on ids the SERVER
 * computed — the commit body carries no asset id.
 */
import logger from "../../utils/logger";
import { invalidateAlbumAssets } from "../immich/immichAssetCache";
import type { ImmichClient } from "../immich/immichClient";
import { ALBUM_REMOVE_SCOPE, albumRemovalCapability } from "../immich/immichCapabilities";
import { ImmichError, type ImmichAlbumInfo } from "../immich/types";
import { albumDescription, failed, messageOf, upsertAlbumLink } from "./albumWrite";
import {
  hasTravstatsMarker,
  type AlbumRemoveSkip,
  type AlbumSyncPreview,
  type ExistingAlbumLink,
} from "./existingTypes";
import { loadAlbumLinks, type AlbumDescriber } from "./existingState";
import type { AlbumOutcome, Day } from "./types";

export type AlbumResyncClient = Pick<
  ImmichClient,
  "getAlbumInfo" | "listAlbumAssets" | "findOwnedAlbumByName" | "getMyApiKey"
>;

/**
 * The linked album to update: owned by the user and named like the trip, else the
 * first owned linked album. An album whose owner is unknown is not owned.
 */
export function pickLinkedAlbum(
  links: readonly ExistingAlbumLink[],
  tripName: string
): ExistingAlbumLink | null {
  const owned = links.filter((link) => link.ownedByUser === true);
  return owned.find((link) => link.albumName === tripName) ?? owned[0] ?? null;
}

export interface MemberRef {
  id: string;
  fileCreatedAt: string;
}

/**
 * Album members the server can prove lie outside [S, E]:
 * - a member the clean step classed as outside by its LOCAL day (the context photos), or
 * - a member whose capture instant lies outside the whole fetch range, which no
 *   zone can bring back into the window.
 * A member in the fetch range that is neither in the window nor in the context (a
 * partner's photo, a hidden Live Photo half) is not judged, and one with no capture
 * time (`fileCreatedAt` of epoch 0 is Immich's "absent") is never removed.
 */
export function outsideMemberIds(input: {
  members: readonly MemberRef[];
  windowIds: ReadonlySet<string>;
  contextIds: ReadonlySet<string>;
  fetchFrom: Date;
  fetchTo: Date;
}): string[] {
  const from = input.fetchFrom.getTime();
  const to = input.fetchTo.getTime();
  return input.members
    .filter((member) => {
      if (input.windowIds.has(member.id)) return false;
      if (input.contextIds.has(member.id)) return true;
      const at = Date.parse(member.fileCreatedAt);
      if (!Number.isFinite(at) || at === 0) return false;
      return at < from || at > to;
    })
    .map((member) => member.id);
}

/** The window photos the album lacks, and how many it already holds. */
export function planAlbumSync(input: {
  windowAssetIds: readonly string[];
  members: readonly MemberRef[];
}): { toAdd: string[]; alreadyIn: number } {
  const held = new Set(input.members.map((member) => member.id));
  const toAdd = input.windowAssetIds.filter((id) => !held.has(id));
  return { toAdd, alreadyIn: input.windowAssetIds.length - toAdd.length };
}

export type AlbumTarget =
  | { kind: "linked"; linkId: string; immichAlbumId: string; marker: boolean }
  | { kind: "byName"; immichAlbumId: string; marker: boolean }
  | { kind: "create" };

/** Linked → by name → create (spec §K.3). */
export async function resolveAlbumTarget(input: {
  client: AlbumResyncClient;
  immichUserId: string;
  links: readonly ExistingAlbumLink[];
  tripName: string;
  albumName: string;
}): Promise<AlbumTarget> {
  const linked = pickLinkedAlbum(input.links, input.tripName);
  if (linked) {
    return {
      kind: "linked",
      linkId: linked.linkId,
      immichAlbumId: linked.immichAlbumId,
      marker: linked.travstatsMarker === true,
    };
  }
  const found = await input.client.findOwnedAlbumByName(input.albumName, input.immichUserId);
  if (!found) return { kind: "create" };
  const info = await input.client.getAlbumInfo(found.id);
  return { kind: "byName", immichAlbumId: found.id, marker: hasTravstatsMarker(info.description) };
}

/** Reads a linked album through Immich: is it the user's, and did TravStats write its description? */
export function albumDescriber(
  client: Pick<ImmichClient, "getAlbumInfo">,
  immichUserId: string
): AlbumDescriber {
  return async (immichAlbumId) => {
    const info = await client.getAlbumInfo(immichAlbumId);
    return {
      ownedByUser: info.ownerId === immichUserId,
      travstatsMarker: hasTravstatsMarker(info.description),
    };
  };
}

export interface AlbumPreviewInput {
  client: AlbumResyncClient;
  immichUserId: string;
  links: readonly ExistingAlbumLink[];
  tripName: string;
  albumName: string;
  /** Every in-window own photo and video: `CleanResult.albumAssetIds`. */
  windowAssetIds: readonly string[];
  /** Own, not hidden photos outside [S, E] within the fetch range: `CleanResult.context`. */
  contextIds: ReadonlySet<string>;
  fetchFrom: Date;
  fetchTo: Date;
}

export interface AlbumPreview {
  sync: AlbumSyncPreview;
  immichAlbumId: string | null;
  /** SERVER-ONLY: the members the commit may remove. */
  outside: string[];
}

/** What updating the album would do — shown in the review, remembered for the commit. */
export async function previewAlbumSync(input: AlbumPreviewInput): Promise<AlbumPreview> {
  const target = await resolveAlbumTarget(input);
  const members: MemberRef[] =
    target.kind === "create"
      ? []
      : (await input.client.listAlbumAssets(target.immichAlbumId)).map(({ id, fileCreatedAt }) => ({
          id,
          fileCreatedAt,
        }));
  const outside = outsideMemberIds({
    members,
    windowIds: new Set(input.windowAssetIds),
    contextIds: input.contextIds,
    fetchFrom: input.fetchFrom,
    fetchTo: input.fetchTo,
  });
  const plan = planAlbumSync({ windowAssetIds: input.windowAssetIds, members });
  const capability = await albumRemovalCapability(input.client);
  const allowed = capability.allowed === true;
  return {
    immichAlbumId: target.kind === "create" ? null : target.immichAlbumId,
    outside,
    sync: {
      target: target.kind,
      toAdd: plan.toAdd.length,
      alreadyIn: plan.alreadyIn,
      removable: {
        count: outside.length,
        defaultOn: target.kind === "create" ? true : target.marker,
        allowed,
        ...(allowed ? {} : { missingScope: ALBUM_REMOVE_SCOPE }),
      },
    },
  };
}

// ─── The write ───────────────────────────────────────────────────────────────

export type ResyncClient = AlbumResyncClient &
  Pick<
    ImmichClient,
    "createAlbum" | "addAssetsToAlbum" | "removeAssetsFromAlbum" | "setAlbumDescription"
  >;

export interface ResyncInput {
  userId: string;
  tripId: string;
  tripName: string;
  albumName: string;
  window: { startDay: Day; endDay: Day };
  /** The in-window photos the server collected (`StoredDraft.albumAssetIds`). */
  assetIds: readonly string[];
  /** The members the scan proved outside the dates (`StoredExisting.album.outsideIds`). */
  outsideIds: readonly string[];
  /** The album those members were read from. */
  scanAlbumId: string | null;
  /** The user's switch. The ids come from `outsideIds`, never from the request. */
  removeOutside: boolean;
  client: ResyncClient;
  immichUserId: string;
}

/**
 * Removal runs after the additions and only ever takes out ids the scan
 * computed AND that are still members. It never fails the re-sync: the photos
 * were added, and a missing scope is reported, not thrown.
 */
async function removeOutsideMembers(
  input: ResyncInput,
  albumId: string,
  memberIds: ReadonlySet<string>
): Promise<{ removed: number; skipped?: AlbumRemoveSkip }> {
  if (!input.removeOutside) return { removed: 0 };
  const ids = input.outsideIds.filter((id) => memberIds.has(id));
  if (ids.length === 0) return { removed: 0 };
  if (input.scanAlbumId !== albumId) return { removed: 0, skipped: "albumChanged" };
  const capability = await albumRemovalCapability(input.client);
  if (capability.allowed === false) return { removed: 0, skipped: "missingScope" };
  try {
    const result = await input.client.removeAssetsFromAlbum(albumId, ids);
    return { removed: result.removed };
  } catch (error) {
    if (error instanceof ImmichError && error.kind === "auth") {
      return { removed: 0, skipped: "missingScope" };
    }
    logger.warn(
      {
        operation: "tripBuilder.album.removeOutside",
        albumId,
        error: messageOf(error),
      },
      "Photos outside the trip dates could not be removed from the album"
    );
    return { removed: 0, skipped: "failed" };
  }
}

/** Only the album TravStats wrote gets its description refreshed, and never at the cost of the re-sync. */
async function refreshDescription(
  client: Pick<ImmichClient, "setAlbumDescription">,
  albumId: string,
  description: string
): Promise<void> {
  try {
    await client.setAlbumDescription(albumId, description);
  } catch (error) {
    logger.info(
      {
        operation: "tripBuilder.album.description",
        albumId,
        error: messageOf(error),
      },
      "The album description was not refreshed"
    );
  }
}

/**
 * Phase D for an existing trip (spec §K.3): update the trip's album — the linked
 * one, else one found by name, else a new one — add the window photos it lacks,
 * remove (when the user ticked it and the key may) the members the scan proved
 * outside the dates, refresh the description TravStats wrote, record the sync
 * and drop the asset cache. A failure is the outcome, never an exception.
 */
export async function resyncTripAlbum(input: ResyncInput): Promise<AlbumOutcome> {
  const { client } = input;
  try {
    if (input.assetIds.length === 0 && input.outsideIds.length === 0) {
      return { status: "skipped", skipReason: "noAssets" };
    }
    const links = await loadAlbumLinks(
      input.userId,
      input.tripId,
      albumDescriber(client, input.immichUserId)
    );
    const target = await resolveAlbumTarget({
      client,
      immichUserId: input.immichUserId,
      links,
      tripName: input.tripName,
      albumName: input.albumName,
    });
    const description = albumDescription(input.window.startDay, input.window.endDay);

    let albumId: string;
    let before: ImmichAlbumInfo | null = null;
    if (target.kind === "create") {
      albumId = (await client.createAlbum({ albumName: input.albumName, description })).id;
    } else {
      albumId = target.immichAlbumId;
      before = await client.getAlbumInfo(albumId);
    }

    const members = target.kind === "create" ? [] : await client.listAlbumAssets(albumId);
    const memberIds = new Set(members.map((member) => member.id));
    const toAdd = input.assetIds.filter((id) => !memberIds.has(id));
    const added =
      toAdd.length > 0
        ? await client.addAssetsToAlbum(albumId, toAdd)
        : { added: 0, duplicate: 0, refused: [] };
    const removal = await removeOutsideMembers(input, albumId, memberIds);

    if (
      target.kind !== "create" &&
      target.marker &&
      before !== null &&
      before.description !== description
    ) {
      await refreshDescription(client, albumId, description);
    }

    const fresh = await client.getAlbumInfo(albumId);
    await upsertAlbumLink(input.tripId, albumId, fresh);
    invalidateAlbumAssets(input.userId, albumId);

    return {
      status: "linked",
      immichAlbumId: albumId,
      albumName: fresh.albumName,
      reused: target.kind !== "create",
      added: added.added,
      alreadyIn: input.assetIds.length - toAdd.length + added.duplicate,
      refused: added.refused.length,
      removed: removal.removed,
      ...(removal.skipped ? { removeSkipped: removal.skipped } : {}),
    };
  } catch (error) {
    return failed(error);
  }
}
