/**
 * A trip's own city albums (spec 2026-10-11 §5.4, spec 2026-10-11-pitstop §4):
 * each holds its stretch's pictures while they also stay in the trip's main
 * album, and each is named exactly like the trip it belongs to — the scan's
 * one naming pass mints that string once (owner ruling 2026-10-12).
 *
 * They write through the trip album's own machinery (`resyncTripAlbum`) with the
 * album picked BY NAME, so the trip-named main album can never be their target,
 * and they are add-only: a re-sync adds what is missing and removes nothing
 * (§6). The description keeps the exact `TravStats trip ·` marker. (The module
 * keeps its `stopoverAlbum.ts` path so no import and no jest.mock path moves;
 * it serves both album classes.)
 */
import { blockedOutcome, preflightAlbum } from "./albumWrite";
import { resyncTripAlbum, type ResyncClient } from "./albumResync";
import { TRAVSTATS_ALBUM_MARKER } from "./existingTypes";
import type { AlbumOutcome, Day } from "./types";

/**
 * One city album a commit wrote and what phase D made of it (spec 2026-10-11
 * §5.4, pitstops §4). It is declared here, beside the write it describes,
 * because `types.ts` — the module that carries it on `CommitResult` — sits at
 * the 800-line cap. `key` is the stopover's `<inFlightId>#<outFlightId>` or the
 * pitstop area's `<startDay>#<n>`.
 */
export interface PitstopAlbumOutcome {
  /** The stopover's or pitstop area's key; the success panel's own line and retry name it. */
  key: string;
  /** The album's name — its trip's own name; what its retry resolves by. */
  name: string;
  album: AlbumOutcome;
}

/** "TravStats trip · <the trip's name>": the marker prefix keeps the album findable and ours. */
export function pitstopAlbumDescription(name: string): string {
  return `${TRAVSTATS_ALBUM_MARKER} ${name}`;
}

export interface PitstopAlbumInput {
  userId: string;
  tripId: string;
  /** The trip's own name; only the main-album rule reads it, which this write never uses. */
  tripName: string;
  /** The trip's own name — the album's name. */
  name: string;
  /** The stretch's own day (`YYYY-MM-DD`): the window the album stands for. */
  day: Day;
  /** The stretch's whole picture set. SERVER-ONLY: no request ever carries an asset id. */
  assetIds: readonly string[];
  client: ResyncClient;
  immichUserId: string;
}

/**
 * Find the user's own album of this exact name or create it with the TravStats
 * marker, add the pictures it lacks (Immich hears a retry as `duplicate`, so
 * this is safe to run again) and link it — a further linked album, appended by
 * `sortIdx` (spec §5.4, pitstops §4). Add-only: nothing is ever removed.
 */
export async function writePitstopAlbum(input: PitstopAlbumInput): Promise<AlbumOutcome> {
  if (input.assetIds.length === 0) return { status: "skipped", skipReason: "noAssets" };
  return resyncTripAlbum({
    userId: input.userId,
    tripId: input.tripId,
    tripName: input.tripName,
    albumName: input.name,
    window: { startDay: input.day, endDay: input.day },
    description: pitstopAlbumDescription(input.name),
    assetIds: input.assetIds,
    outsideIds: [],
    scanAlbumId: null,
    removeOutside: false,
    named: true,
    client: input.client,
    immichUserId: input.immichUserId,
  });
}

/**
 * The success panel's retry for one of the trip's own city albums (spec
 * 2026-10-11 §5.4, pitstop §4). It needs the draft the commit wrote from: the
 * stretch's picture ids exist nowhere else (§2.3, pitstop §2), and its Immich
 * user is the one the ids belong to. The preflight's own check turns a changed
 * connection into this album's blocked line, never the trip's; the write is
 * add-only and by exact owned name.
 */
export async function retryPitstopAlbum(input: {
  userId: string;
  tripId: string;
  tripName: string;
  /** The album to retry: its name, its day and its members (a stopover's or a pitstop's). */
  album: { name: string; day: Day; assetIds: readonly string[] };
  expectedImmichUserId: string;
}): Promise<AlbumOutcome> {
  const preflight = await preflightAlbum(input.userId, input.expectedImmichUserId);
  if (!preflight.ok) return blockedOutcome(preflight.blocked);
  return writePitstopAlbum({
    userId: input.userId,
    tripId: input.tripId,
    tripName: input.tripName,
    name: input.album.name,
    day: input.album.day,
    assetIds: input.album.assetIds,
    client: preflight.client,
    immichUserId: preflight.immichUserId,
  });
}
