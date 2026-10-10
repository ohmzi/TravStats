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
import { resolveTrip } from "../../routes/trips/resolveTrip";
import { now } from "../../shared/time/clock";
import { fromDbDate } from "../../shared/time/localDate";
import logger from "../../utils/logger";
import { loadHomePeriods } from "../home/homeStore";
import { ALBUM_SCOPES, scopesMissing } from "../immich/immichCapabilities";
import { invalidateAlbumAssets } from "../immich/immichAssetCache";
import { createImmichClient, type ImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";
import { ImmichError, type ImmichAlbum } from "../immich/types";
import { collectWindow } from "./collect";
import { loadFlights } from "./loadFlights";
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

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The page says "unreachable" for every preflight failure that is not an auth
 * answer, so this log is the operator's only trace of the cause: a warning
 * carrying the ImmichError's kind (an outage is `unreachable`; `protocol`,
 * `notFound` and `invalidUrl` are Immich answering oddly), or an error for a
 * fault in this server.
 */
function logPreflightFailure(error: unknown): void {
  if (error instanceof ImmichError) {
    logger.warn(
      {
        operation: "trip_builder.preflight_failed",
        kind: error.kind,
        status: error.status,
        error: error.message,
      },
      "The Immich preflight for the trip album did not complete"
    );
    return;
  }
  logger.error(
    { operation: "trip_builder.preflight_failed", error: messageOf(error) },
    "The Immich preflight for the trip album failed unexpectedly"
  );
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
    logPreflightFailure(error);
    return blocked("unreachable");
  }
}

/** A failed album step is an outcome, never an exception, and leaves a trace in the log for the operator. */
export function failed(error: unknown): AlbumOutcome {
  if (error instanceof ImmichError) {
    // Kind and status only: the message can name an album or an asset.
    logger.warn(
      { operation: "trip_builder.album_failed", kind: error.kind, status: error.status },
      "Immich did not take the trip album write"
    );
    const scope = error.detail?.missingScope;
    return {
      status: "failed",
      error: { kind: error.kind, ...(scope ? { missingScope: scope } : {}) },
    };
  }
  logger.error(
    { operation: "trip_builder.album_failed", error: messageOf(error) },
    "Writing the trip album failed"
  );
  return { status: "failed", error: { kind: "internal" } };
}

/**
 * Records the album on the trip's link row, as Immich reports it now: name,
 * count, cover and the time of this sync. A first link goes after the trip's
 * others (`link` mode); an existing one keeps its mode and position. The cover
 * is refreshed every time because the album proxy serves only assets that are
 * still in the album, so a stored cover that was removed would 404.
 */
export async function upsertAlbumLink(
  tripId: string,
  immichAlbumId: string,
  fresh: Pick<ImmichAlbum, "albumName" | "assetCount" | "thumbnailAssetId">
): Promise<void> {
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
    where: { tripId_immichAlbumId: { tripId, immichAlbumId } },
    create: {
      tripId,
      immichAlbumId,
      mode: "link",
      sortIdx: (last._max.sortIdx ?? -1) + 1,
      ...fields,
    },
    update: fields,
  });
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

    await upsertAlbumLink(tripId, album.id, fresh);
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

/** `AlbumOutcome` has no reason field, so a blocked preflight is told through `error` and `missingScopes`. */
function blockedOutcome(block: CommitBlocked): AlbumOutcome {
  switch (block.reason) {
    case "missingScopes":
      return {
        status: "blocked",
        missingScopes: block.missingScopes,
        error: {
          kind: "auth",
          ...(block.missingScopes[0] ? { missingScope: block.missingScopes[0] } : {}),
        },
      };
    case "unreachable":
      return { status: "blocked", error: { kind: "unreachable" } };
    default:
      return { status: "blocked", error: { kind: "notConfigured" } };
  }
}

/**
 * Retry a trip's album after it failed or was blocked. The asset list is
 * rebuilt from the trip's own days with the scan's fetch-and-clean step, so it
 * needs no draft and survives a restart. Safe to run again: the album is found
 * by its exact owned name and Immich reports assets already in it as duplicates.
 */
export async function retryTripAlbum(
  userId: string,
  tripId: string,
  name: string | undefined
): Promise<AlbumOutcome> {
  const trip = await resolveTrip(userId, tripId);
  const preflight = await preflightAlbum(userId, null);
  if (!preflight.ok) return blockedOutcome(preflight.blocked);
  try {
    const days = await prisma.trip.findFirstOrThrow({
      where: { id: tripId, userId },
      select: { startDay: true, endDay: true },
    });
    if (!days.startDay || !days.endDay) return { status: "skipped", skipReason: "noAssets" };
    const startDay = fromDbDate(days.startDay);
    const endDay = fromDbDate(days.endDay);
    const collected = await collectWindow(
      {
        immich: preflight.client,
        loadFlights: (window, target) => loadFlights(userId, window, target),
        homePeriods: await loadHomePeriods(userId),
      },
      { immichUserId: preflight.immichUserId, startDay, endDay, targetTripId: tripId }
    );
    return await writeTripAlbum({
      userId,
      tripId,
      albumName: name ?? trip.name,
      description: albumDescription(startDay, endDay),
      assetIds: collected.clean.albumAssetIds,
      client: preflight.client,
      immichUserId: preflight.immichUserId,
    });
  } catch (error) {
    return failed(error);
  }
}
