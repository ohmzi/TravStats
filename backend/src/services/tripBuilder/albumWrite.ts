/**
 * The Immich album a trip gets (spec 2026-10-09 §A, §D): an Immich preflight
 * that writes nothing, and the write itself. Both answer, never throw: the
 * album is a step that can fail or be blocked on its own while the trip it
 * belongs to is already saved, and the page offers a retry.
 *
 * Only the user's own key writes. A shared (admin or ENV) key would put the
 * album in the operator's account.
 */
import { prisma } from "../../db";
import { now } from "../../shared/time/clock";
import logger from "../../utils/logger";
import { ALBUM_SCOPES, scopesMissing } from "../immich/immichCapabilities";
import { invalidateAlbumAssets } from "../immich/immichAssetCache";
import { createImmichClient, type ImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";
import { ImmichError } from "../immich/types";
import { PREFLIGHT_TIMEOUT_MS } from "./thresholds";
import type { AlbumOutcome, CommitBlocked, Day, PreflightBlockReason } from "./types";

export type AlbumPreflight =
  { ok: true; client: ImmichClient; immichUserId: string } | { ok: false; blocked: CommitBlocked };

export interface AlbumWriteInput {
  userId: string;
  tripId: string;
  albumName: string;
  description: string;
  assetIds: readonly string[];
  client: ImmichClient;
  immichUserId: string;
}

/** "TravStats trip · S – E": also the marker that this album was made by TravStats. */
export function albumDescription(startDay: Day, endDay: Day): string {
  return `TravStats trip · ${startDay} – ${endDay}`;
}

function blocked(reason: PreflightBlockReason, missingScopes: string[] = []): AlbumPreflight {
  return { ok: false, blocked: { status: "blocked", reason, missingScopes } };
}

/**
 * Re-resolves the connection and checks it can still write an album, with
 * four-second calls and no writes. `expectedImmichUserId` is the Immich user
 * the draft was scanned as; null skips that check (the retry has no draft).
 * The returned client has the ordinary timeout, for the writes that follow.
 */
export async function preflightAlbum(
  userId: string,
  expectedImmichUserId: string | null
): Promise<AlbumPreflight> {
  try {
    const conn = await getImmichConnection(userId);
    if (!conn) return blocked("connectionChanged");
    if (conn.source !== "user") return blocked("sharedConnection");
    const probe = createImmichClient(conn, { timeoutMs: PREFLIGHT_TIMEOUT_MS });
    const me = await probe.whoami();
    if (expectedImmichUserId !== null && me.id !== expectedImmichUserId) {
      return blocked("connectionChanged");
    }
    const key = await probe.getMyApiKey();
    const missing = key === null ? [] : scopesMissing(key.permissions, ALBUM_SCOPES);
    if (missing.length > 0) return blocked("missingScopes", missing);
    return { ok: true, client: createImmichClient(conn), immichUserId: me.id };
  } catch (error) {
    if (error instanceof ImmichError && error.kind === "auth") {
      const scope = error.detail?.missingScope;
      return scope ? blocked("missingScopes", [scope]) : blocked("connectionChanged");
    }
    return blocked("unreachable");
  }
}

function failed(error: unknown): AlbumOutcome {
  if (error instanceof ImmichError) {
    const scope = error.detail?.missingScope;
    return {
      status: "failed",
      error: { kind: error.kind, ...(scope ? { missingScope: scope } : {}) },
    };
  }
  logger.error(
    {
      operation: "trip_builder.album_failed",
      error: error instanceof Error ? error.message : String(error),
    },
    "Writing the trip album failed"
  );
  return { status: "failed", error: { kind: "internal" } };
}

/**
 * Find the user's own album of this exact name or create it empty, add the
 * assets (Immich reports `duplicate` for those already in, so a retry is
 * safe), read the album back and upsert the link row. Creating the album with
 * no assets matters: Immich drops ids it cannot share from a create silently.
 */
export async function writeTripAlbum(input: AlbumWriteInput): Promise<AlbumOutcome> {
  if (input.assetIds.length === 0) return { status: "skipped", skipReason: "noAssets" };
  try {
    const { client, userId, tripId } = input;
    const existing = await client.findOwnedAlbumByName(input.albumName, input.immichUserId);
    const album =
      existing ??
      (await client.createAlbum({ albumName: input.albumName, description: input.description }));
    const result = await client.addAssetsToAlbum(album.id, input.assetIds);
    const fresh = await client.getAlbum(album.id);

    const last = await prisma.tripImmichAlbum.aggregate({
      where: { tripId },
      _max: { sortIdx: true },
    });
    const fields = {
      albumName: fresh.albumName,
      assetCount: fresh.assetCount,
      thumbnailAssetId: fresh.thumbnailAssetId,
      lastSyncedAt: now(),
    };
    await prisma.tripImmichAlbum.upsert({
      where: { tripId_immichAlbumId: { tripId, immichAlbumId: album.id } },
      create: {
        tripId,
        immichAlbumId: album.id,
        mode: "link",
        sortIdx: (last._max.sortIdx ?? -1) + 1,
        ...fields,
      },
      update: fields,
    });
    invalidateAlbumAssets(userId, album.id);
    return {
      status: "linked",
      immichAlbumId: album.id,
      albumName: fresh.albumName,
      reused: existing !== null,
      added: result.added,
      alreadyIn: result.duplicate,
      refused: result.refused.length,
    };
  } catch (error) {
    return failed(error);
  }
}
