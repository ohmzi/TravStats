/**
 * The stopover vocabulary (spec 2026-10-11 §2.3, §5.2, §6): the DTO the scan
 * offers, the stored record the draft keeps, and the plan entry the commit
 * writes. `DraftStopover` was declared in `types.ts` until the re-sync status
 * landed, and `StoredStopover`/`StopoverPlan` followed it here when the pitstop
 * feature pushed `types.ts` to the 800-line cap; `types.ts` re-exports all
 * three, so every consumer keeps importing them from `./types`.
 */
import type { Day, DraftLeg, DraftStation } from "./types";
import type { StationsInput } from "../../schemas/roadtrip";
import type { BuilderLegMode, PlanLeg, PlanStation } from "./types";

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

/**
 * One stopover candidate as the scan derived it (spec 2026-10-11 §2.3). The
 * whole layover's photo ids are kept server-side: they are dropped after the
 * scan today, and the city-album write needs them.
 */
export interface StoredStopover {
  key: string;
  title: string;
  city: string;
  day: Day;
  inFlightId: string;
  outFlightId: string;
  airportIata: string | null;
  /** The whole layover's photo set: the album list (spec §2.2). SERVER-ONLY. */
  photoIds: string[];
  /** The tour's stops, the arrival airport first (spec §2.2). */
  stations: PlanStation[];
  /** legs[i] joins stations[i] and stations[i + 1]. */
  legs: PlanLeg[];
}

/**
 * One toggled stopover as the write phase sees it (spec 2026-10-11 §5.2): a
 * roadtrip with no nights — its stations never enter `body.areas` or the night
 * plan — and, when its album switch is on, the album to link beside the trip's.
 */
export interface StopoverPlan {
  /** The draft stopover's key, `<inFlightId>#<outFlightId>`. */
  key: string;
  /** `<City> <Year> Road Trip`: the roadtrip's and its album's one name (owner ruling). */
  name: string;
  /** The stopover day (`YYYY-MM-DD`, trip zone). */
  day: Day;
  /** The stored roadtrip a re-sync matched to this stopover (spec §6); set, it is never rebuilt (add-only). */
  roadtripId?: string;
  /** `stationsSchema`-parsed `deriveStationRows`, no night assigned (every row a `pass`). */
  stations: StationsInput["stations"];
  /** legModes[i] joins stations[i] and stations[i+1] (§2.2: mode evidence, road unless it says otherwise). */
  legModes: BuilderLegMode[];
  /** The whole layover's asset ids, SERVER-ONLY; null when the album toggle is off. */
  album: { name: string; assetIds: string[] } | null;
}
