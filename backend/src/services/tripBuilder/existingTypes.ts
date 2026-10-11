/**
 * The vocabulary of re-syncing an existing trip (spec 2026-10-09 §K).
 *
 * A re-sync derives the itinerary a new trip would get, then reconciles it with
 * what the trip already holds, so the review shows a diff and the commit updates
 * rows in place instead of rebuilding them. Type-only apart from the few small
 * helpers below; `types.ts` re-uses these in the DTO.
 *
 * The DTO half is mirrored in `frontend/src/types/tripBuilder.ts` — change both
 * together.
 */
import type { StationsInput } from "../../schemas/roadtrip";
import type { StationState } from "../../shared/tour/roadtrip";
import type { LegMode } from "../tour/tourDistance";
import type { Day } from "./types";

export const STATION_STATUSES = ["same", "changed", "new", "notSeen"] as const;
export type StationStatus = (typeof STATION_STATUSES)[number];

/** Why a stored station has no derived match: outside the (new) window, or just not in the photos. */
export const NOT_SEEN_REASONS = ["outsideWindow", "notInPhotos"] as const;
export type NotSeenReason = (typeof NOT_SEEN_REASONS)[number];

/** The prefix TravStats writes into the description of an album it creates (`albumDescription`). */
export const TRAVSTATS_ALBUM_MARKER = "TravStats trip ·";

export function hasTravstatsMarker(description: string | null | undefined): boolean {
  return typeof description === "string" && description.startsWith(TRAVSTATS_ALBUM_MARKER);
}

/** What a stored station's night is, derived from its three columns (`stationState`). */
export type StoredNight = StationState;

/** A night counts as slept when a stay or a free night is recorded. */
export function isSleptNight(night: StoredNight): boolean {
  return night === "stay" || night === "free";
}

/** What a changed pill shows on its left: the stored dates and night. */
export interface StationBefore {
  startDate: Day | null;
  endDate: Day | null;
  slept: boolean;
  /** The night is a stay: the stay owns it, whatever the photos say. */
  stay: boolean;
}

/** The default a not-seen station is shown with, and the chip that explains it. */
export interface NotSeenDefault {
  defaultKeep: boolean;
  reason: NotSeenReason;
}

/** Counts the success panel shows for one roadtrip, or for the timeline stops. */
export interface RoadtripDiff {
  updated: number;
  unchanged: number;
  added: number;
  removed: number;
  kept: number;
}

export type AlbumTargetKind = "linked" | "byName" | "create";
export type AlbumRemoveSkip = "missingScope" | "albumChanged" | "failed";

/** What the album section shows for an existing trip. Never carries an asset id. */
export interface AlbumSyncPreview {
  target: AlbumTargetKind;
  /** In-window photos the album does not hold yet. */
  toAdd: number;
  alreadyIn: number;
  removable: {
    /** Members the server proved lie outside the trip dates. */
    count: number;
    /** On when TravStats created the album (description marker). */
    defaultOn: boolean;
    /** The key holds albumAsset.delete. */
    allowed: boolean;
    missingScope?: string;
  };
}

// ─── What the trip holds now (existingState.ts) ──────────────────────────────

export interface ExistingStation {
  id: string;
  title: string;
  lat: number;
  lon: number;
  startDate: Day | null;
  endDate: Day | null;
  night: StoredNight;
  lodgingStayId: string | null;
  placeId: string | null;
  notes: string | null;
}

export interface StoredLeg {
  fromStopId: string;
  toStopId: string;
  /** road | ferry | rail | foot | bike — as stored. */
  mode: string;
  /** straight | drawn | routed | track — as stored. */
  source: string;
}

export interface ExistingRoadtrip {
  id: string;
  name: string;
  /** In route order; route corrections (`night: "via"`) included. */
  stations: ExistingStation[];
  legs: StoredLeg[];
}

/** A timeline stop the re-sync may touch: no domain, no wrapped entry, not in a roadtrip. */
export interface ExistingStop {
  id: string;
  title: string;
  lat: number;
  lon: number;
  startDay: Day | null;
  endDay: Day | null;
  notes: string | null;
}

export interface ExistingAlbumLink {
  linkId: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  /** null: Immich could not say. */
  ownedByUser: boolean | null;
  travstatsMarker: boolean | null;
}

export interface ExistingTripState {
  tripId: string;
  tripName: string;
  startDay: Day | null;
  endDay: Day | null;
  countries: string[];
  roadtrips: ExistingRoadtrip[];
  stops: ExistingStop[];
  flightIds: string[];
  albums: ExistingAlbumLink[];
}

// ─── What the draft offered (StoredDraft.existing, server-only) ──────────────

export interface StoredRoadtripOffer {
  areaKey: string;
  /** The stored roadtrip's name when the draft was made; a rename since fails the commit. */
  name: string;
  /** Stored stations the draft matched to a derived one. */
  matchedIds: ReadonlySet<string>;
  /** Stored stations the draft offered as not seen. */
  notSeenIds: ReadonlySet<string>;
}

export interface StoredExisting {
  tripId: string;
  /** roadtrip id → what was offered; unmatched roadtrips of the trip are not listed (not touched). */
  roadtrips: ReadonlyMap<string, StoredRoadtripOffer>;
  stops: { matchedIds: ReadonlySet<string>; notSeenIds: ReadonlySet<string> };
  /** The album the scan looked at and the member ids it proved outside the dates. SERVER-ONLY. */
  album: { immichAlbumId: string | null; outsideIds: readonly string[] } | null;
}

// ─── What the commit writes for an existing trip (CommitPlan.existing) ───────

export interface ExistingRoadtripWrite {
  areaKey: string;
  roadtripId: string;
  /** The reviewed name: the stored one, or the rename the write applies when `rename`. */
  name: string;
  /** The reviewed name differs from the stored roadtrip's: the write renames the route. */
  rename: boolean;
  /** The complete ordered station list: matched and kept stations carry their id, new ones do not. */
  stations: StationsInput["stations"];
  /**
   * Every stored station the draft offered — matched and not seen, route corrections
   * excluded. The write re-reads the route inside its transaction and refuses
   * (TRIP_CHANGED) unless it holds exactly these: `replaceStationsInTx` deletes by
   * omission, so a station added since the plan would be destroyed with no error.
   */
  offeredIds: readonly string[];
  /** legModes[i] joins stations[i] and stations[i + 1]; undefined: leave the leg as it is. */
  legModes: Array<LegMode | undefined>;
  /** Stored legs whose mode the user changed: deleted, so they come back straight and are routed again. */
  resetLegs: Array<{ fromStopId: string; toStopId: string }>;
  /** The station list and its legs are what is stored: no station write. A rename is its own flag. */
  noop: boolean;
  diff: RoadtripDiff;
}

export interface ExistingStopUpdate {
  areaKey: string;
  stopId: string;
  title: string;
  notes: string | null;
  startDay: Day;
  endDay: Day;
}

export interface ExistingCommitPlan {
  tripId: string;
  /**
   * The timeline stop ids the draft offered (the candidates `loadExistingState`
   * read). The write re-reads them inside its transaction and refuses
   * (TRIP_CHANGED) if the set moved: a stop added, moved into a roadtrip or
   * removed since the plan would otherwise be updated blind or answer 500.
   */
  offeredStopIds: readonly string[];
  roadtrips: ExistingRoadtripWrite[];
  stopUpdates: ExistingStopUpdate[];
  stopRemoveIds: string[];
  stopsDiff: RoadtripDiff;
  album: { removeOutside: boolean };
}
