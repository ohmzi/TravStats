/**
 * A stopover's own album (spec 2026-10-11 §5.4): a second, independently named
 * album on the trip — "<City> <Year> Road Trip" — holding the whole layover's
 * pictures while they also stay in the trip's main album.
 *
 * It writes through the trip album's own machinery (`resyncTripAlbum`) with the
 * album picked BY NAME, so the trip-named main album can never be its target,
 * and it is add-only: a re-sync adds what is missing and removes nothing (§6).
 * The description keeps the exact `TravStats trip ·` marker.
 */
import { blockedOutcome, preflightAlbum } from "./albumWrite";
import { resyncTripAlbum, type ResyncClient } from "./albumResync";
import { TRAVSTATS_ALBUM_MARKER } from "./existingTypes";
import type { AlbumOutcome, Day, StoredStopover } from "./types";

/**
 * One stopover's own album and what phase D made of it (spec 2026-10-11 §5.4).
 * It is declared here, beside the write it describes, because `types.ts` — the
 * module that carries it on `CommitResult` — sits at the 800-line cap.
 */
export interface StopoverAlbumOutcome {
  /** The stopover's key, `<inFlightId>#<outFlightId>`. */
  key: string;
  /** The album's name, `<City> <Year> Road Trip`; what its retry posts back. */
  name: string;
  album: AlbumOutcome;
}

/** "TravStats trip · <City> <Year> Road Trip": the marker prefix keeps the album findable and ours. */
export function stopoverAlbumDescription(name: string): string {
  return `${TRAVSTATS_ALBUM_MARKER} ${name}`;
}

export interface StopoverAlbumInput {
  userId: string;
  tripId: string;
  /** The trip's own name; only the main-album rule reads it, which this write never uses. */
  tripName: string;
  /** `<City> <Year> Road Trip` — the album's name (owner ruling: one name for both). */
  name: string;
  /** The stopover day (`YYYY-MM-DD`, trip zone): the window the album stands for. */
  day: Day;
  /** The whole layover's pictures. SERVER-ONLY: no request ever carries an asset id. */
  assetIds: readonly string[];
  client: ResyncClient;
  immichUserId: string;
}

/**
 * Find the user's own album of this exact name or create it with the TravStats
 * marker, add the pictures it lacks (Immich hears a retry as `duplicate`, so
 * this is safe to run again) and link it — a second linked album, appended by
 * `sortIdx` (spec §5.4).
 */
export async function writeStopoverAlbum(input: StopoverAlbumInput): Promise<AlbumOutcome> {
  if (input.assetIds.length === 0) return { status: "skipped", skipReason: "noAssets" };
  return resyncTripAlbum({
    userId: input.userId,
    tripId: input.tripId,
    tripName: input.tripName,
    albumName: input.name,
    window: { startDay: input.day, endDay: input.day },
    description: stopoverAlbumDescription(input.name),
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
 * The success panel's retry for one stopover's own album (spec §5.4). It needs
 * the draft the commit wrote from: the layover's picture ids exist nowhere else
 * (§2.3), and its Immich user is the one the ids belong to. The preflight's own
 * check turns a changed connection into this album's blocked line, never the
 * trip's; the write is add-only and by exact owned name.
 */
export async function retryStopoverAlbum(input: {
  userId: string;
  tripId: string;
  tripName: string;
  stopover: StoredStopover;
  expectedImmichUserId: string;
}): Promise<AlbumOutcome> {
  const preflight = await preflightAlbum(input.userId, input.expectedImmichUserId);
  if (!preflight.ok) return blockedOutcome(preflight.blocked);
  return writeStopoverAlbum({
    userId: input.userId,
    tripId: input.tripId,
    tripName: input.tripName,
    name: input.stopover.title,
    day: input.stopover.day,
    assetIds: input.stopover.photoIds,
    client: preflight.client,
    immichUserId: preflight.immichUserId,
  });
}
