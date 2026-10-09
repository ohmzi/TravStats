/**
 * The trip builder's photo side (spec
 * docs/superpowers/specs/2026-10-09-immich-trip-builder-design.md, §C.1, §C.2,
 * §C.5, §C.6): the window the photos are fetched for, each photo once clocked
 * and cleaned, and the clusters and segments the photos form.
 *
 * Split out of `types.ts` only to keep each file under the 800-line cap. It is
 * one vocabulary with that file, which re-exports every name below — import
 * them from `./types` like any other. Only `ExcludedCounts` reaches the API
 * (in the draft's stats); the rest never leaves the server.
 */
import type { ImmichVisibility } from "../immich/types";
import type { Day, LocalMinute, TitleSource } from "./types";

// ─── Window (window.ts) ──────────────────────────────────────────────────────

export interface ScanWindow {
  /** S and E: a photo belongs to the trip when S ≤ day(p) ≤ E. */
  startDay: Day;
  endDay: Day;
  /** S − CONTEXT_PAD_DAYS and E + CONTEXT_PAD_DAYS: the span the empty state says was checked. */
  contextFromDay: Day;
  contextToDay: Day;
  /** Immich `takenAfter`: S 00:00Z − 3 d − 14 h. */
  fetchFrom: Date;
  /** Immich `takenBefore`: (E+1) 00:00Z + 3 d + 12 h. */
  fetchTo: Date;
}

// ─── Photos (clock.ts, clean.ts) ─────────────────────────────────────────────

/** Which Immich clock gave the instant (§C.1): A zone known, B file time, C naive wall clock. */
export type ClockCase = "A" | "B" | "C";
/** Which rule gave the zone, first match wins (§C.1). */
export type ZoneSource = "gps" | "exif" | "neighbour" | "area" | "home" | "utc";
export type MisdatedReason = "straggler" | "batch" | "filenameClock";

/** One flight-bounded stretch of time and its dominant GPS zone — zone rule 4 of §C.1. */
export interface ZoneSpan {
  fromMs: number;
  toMs: number;
  zone: string;
}

export interface ClockContext {
  /** The residence's zone on S (zone rule 5); null without a home. */
  homeZone: string | null;
  /** From `areaZoneSpans` (zone rule 4). */
  areaZones: readonly ZoneSpan[];
}

export interface PhotoFlags {
  clockCase: ClockCase;
  zoneSource: ZoneSource;
  /** The zone was borrowed (neighbour, area, home or utc), so the day is a guess. */
  dayGuessed: boolean;
  /** EXIF named a zone the GPS disagreed with; GPS won, and it is counted (§J). */
  exifZoneOverridden: boolean;
  /** GPS present and not 0,0 (GPS_ZERO_EPSILON). */
  located: boolean;
  /** Not the movement representative of its `duplicateId` (the first by tMs is). */
  duplicate: boolean;
  misdated: MisdatedReason | null;
  atSea: boolean;
  inFlight: boolean;
  /** Taken during a layover: never a station, never night evidence (§C.4). */
  layover: boolean;
}

/** One asset after the clock: the unit every later module reads. */
export interface PhotoPoint {
  id: string;
  type: "IMAGE" | "VIDEO";
  ownerId: string | null;
  visibility: ImmichVisibility | null;
  /** t(p), epoch ms: every duration, ordering and in-flight test uses this. */
  tMs: number;
  /** z(p): always a valid zone (`UTC` as the last resort; `flags.zoneSource` says which rule). */
  zone: string;
  /** local(p). */
  local: LocalMinute;
  /** day(p): the calendar day of `local`. */
  day: Day;
  /** The day of local(p) − NIGHT_BOUNDARY_H: 00:00–03:59 counts as the evening before. */
  nightDay: Day;
  lat: number | null;
  lon: number | null;
  /** Immich's own reverse geocode (GeoNames cities500); each may be null. */
  city: string | null;
  state: string | null;
  country: string | null;
  make: string | null;
  model: string | null;
  originalFileName: string;
  isFavorite: boolean;
  duplicateId: string | null;
  flags: PhotoFlags;
}

export interface ExcludedCounts {
  /** Every fetched asset whose `ownerId` is not the caller's Immich user. */
  partner: number;
  /** Own assets with `visibility: "hidden"` (Live Photo motion halves). */
  hiddenLivePart: number;
  /** In-window photos kept out of movement for each reason; they stay in the album. */
  misdated: number;
  inFlight: number;
  atSea: number;
  unlocated: number;
  /** In-window photos whose zone was borrowed. */
  dayGuessed: number;
}

export interface CleanResult {
  /** Own, not hidden, S ≤ day ≤ E, by tMs; `located` and `duplicate` flags set. */
  photos: PhotoPoint[];
  /** Own, not hidden, fetched but outside [S, E]: straggler neighbours, `movementOutsideDates`. */
  context: PhotoPoint[];
  /** The id of every photo in `photos`, IMAGE and VIDEO alike. SERVER-ONLY. */
  albumAssetIds: string[];
  /** `partner`, `hiddenLivePart`, `unlocated`, `dayGuessed` counted; the rest 0 until marked. */
  excluded: ExcludedCounts;
}

/** `CountryResolver.countryAt` (geo/countryFromCoordinates.ts:136), bound once per scan. */
export type CountryAt = (lat: number, lon: number) => string | null;
/** `searchByFileName`, clocked, over the fetch range ± MISDATED_LOOKUP_PAD_DAYS. Injected. */
export type FileNameLookup = (fragment: string) => Promise<readonly PhotoPoint[]>;

// ─── Clusters and segments (cityClusters.ts, nameClusters.ts, segments.ts) ───

export interface CityCluster {
  /** "c1", "c2" … in discovery order. */
  id: string;
  photoIds: string[];
  /** Per-axis median. */
  lat: number;
  lon: number;
  spreadKm: number;
  /** The majority Immich name among the members; null when none carried one. */
  immichCity: string | null;
  immichState: string | null;
  immichCountry: string | null;
}

export interface NamedCluster extends CityCluster {
  title: string;
  titleSource: TitleSource;
  /** Median within HOME_RADIUS_KM of the residence on S (§C.5). */
  isHome: boolean;
}

/** An existing roadtrip station of the user's, for title reuse within TITLE_REUSE_KM. */
export interface ExistingTitle {
  title: string;
  lat: number;
  lon: number;
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** A run of movement photos at one cluster with no gap over SEGMENT_CONTINUE_GAP_H. */
export interface RawSegment {
  /** "s1", "s2" … in time order within the area. */
  id: string;
  clusterId: string;
  photoIds: string[];
  startMs: number;
  endMs: number;
  firstDay: Day;
  lastDay: Day;
  firstLocal: LocalMinute;
  lastLocal: LocalMinute;
}

export type SegmentRole = "visit" | "brief" | "excursion" | "transit";

export interface Segment extends RawSegment {
  role: SegmentRole;
  /** `excursion` only: the cluster id A it left from and returned to. */
  excursionOf: string | null;
  /** Holds the last movement photo of at least one nightDay. */
  holdsNight: boolean;
}
