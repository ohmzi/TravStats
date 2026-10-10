/**
 * Updating the album of an existing trip (spec 2026-10-09 §K.3).
 *
 * This file has two halves: the planning (target album, what to add, what lies
 * outside the dates), pure apart from its injected Immich client, and the write
 * (`resyncTripAlbum`, Task 155). Both only ever act on ids the SERVER
 * computed — the commit body carries no asset id.
 */
import type { ImmichClient } from "../immich/immichClient";
import { ALBUM_REMOVE_SCOPE, albumRemovalCapability } from "../immich/immichCapabilities";
import { hasTravstatsMarker, type AlbumSyncPreview, type ExistingAlbumLink } from "./existingTypes";
import type { AlbumDescriber } from "./existingState";

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
