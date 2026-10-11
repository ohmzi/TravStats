/**
 * The stopover DTO the scan offers (spec 2026-10-11 §2.3, §6).
 *
 * `DraftStopover` was declared in `types.ts` until the re-sync status landed;
 * the interface is declared here, beside the status it now carries, because
 * `types.ts` sits at the 800-line cap and re-exports both names — every
 * consumer keeps importing them from `./types` (the same move `stopoverAlbum.ts`
 * made for `StopoverAlbumOutcome`).
 */
import type { Day, DraftLeg, DraftStation } from "./types";

/** A stopover the scan offers: a layover with an outing (spec 2026-10-11 §2.3). */
export interface DraftStopover {
  /** `${inFlightId}#${outFlightId}` — stable across scans, outside the area-key namespace. */
  key: string;
  city: string;
  /** "<City> <Year> Road Trip": the one name of the roadtrip and its album. */
  title: string;
  /** The stopover day (YYYY-MM-DD, on the place's own clock). */
  day: Day;
  airportIata: string | null;
  /** The whole layover's photo set: what the city album would take. */
  photoCount: number;
  /** The photos further than the threshold from the airport: the tour's own set. */
  outingCount: number;
  /** The tour's stops, the arrival airport first. */
  stations: DraftStation[];
  /** legs[i] joins stations[i] and stations[i + 1]. */
  legs: DraftLeg[];
  /**
   * Re-sync only: set ⇔ the review shows both switches ON and locked, marked
   * "already synced" — the roadtrip is already on the trip and v1 never
   * rebuilds it (spec §6).
   */
  stored?: StoredStopoverStatus;
}

/** Re-sync only: the stored roadtrip a scan matched a stopover to (spec 2026-10-11 §6). */
export interface StoredStopoverStatus {
  /** The stored roadtrip the review locks both switches to. */
  roadtripId: string;
  /** The stored roadtrip's name; the commit re-checks it. */
  name: string;
  /** The linked city album's member count; null: no album under the title is linked, or it was not read. */
  albumAssetCount: number | null;
}
