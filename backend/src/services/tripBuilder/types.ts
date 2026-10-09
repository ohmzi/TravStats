/**
 * The trip builder's vocabulary (spec
 * docs/superpowers/specs/2026-10-09-immich-trip-builder-design.md, §C–§F).
 *
 * Every value one builder module hands another is named here, so each pure
 * module can be tested with hand-built values, and the orchestrator, the draft
 * store, the commit job and the router agree on one set of names.
 *
 * Two halves. The PLAN half (`PhotoPoint` … `AreaPlan`, `StoredDraft`,
 * `CommitPlan`) never leaves the server. The DTO half (`TripBuilderDraft` and
 * its parts, `CapabilitiesDto`, the job results) is what the API answers; it is
 * mirrored in `frontend/src/types/tripBuilder.ts` — change both together.
 *
 * No DTO field carries an Immich asset id: a thumbnail is addressed by its
 * INDEX into `StoredDraft.previewAssetIds`, and the draft is the grant.
 *
 * The photo side (`ScanWindow`, `ClockCase` … `FileNameLookup`, `CityCluster` …
 * `Segment`) lives in `photoTypes.ts`, only to keep each file under the 800-line
 * cap; this file re-exports it, so every name is imported from here.
 */
import type { CreateTripInput } from "../../schemas/trip";
import type { StationsInput } from "../../schemas/roadtrip";
import type { NightAssign } from "../../shared/tour/builderNightPlan";
import type { LegPair } from "../../shared/tour/legPlan";
import type { RoadtripVehicle } from "../../shared/tour/roadtrip";
import type { ImmichConnectionSource, ImmichErrorKind } from "../immich/types";
import type { Coord, LegMode } from "../tour/tourDistance";
import type { ExcludedCounts, PhotoPoint, RawSegment, ScanWindow, Segment } from "./photoTypes";

export {
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_SPECIALS,
  NIGHT_UNKNOWN,
  type NightAssign,
} from "../../shared/tour/builderNightPlan";

export type * from "./photoTypes";

// ─── Calendar words ──────────────────────────────────────────────────────────

/** `YYYY-MM-DD`: a calendar day on the clock of the place it happened. */
export type Day = string;
/** `YYYY-MM-DD HH:MM`: a wall clock to the minute, space-separated. */
export type LocalMinute = string;

// ─── Fixed vocabularies ──────────────────────────────────────────────────────

/** The seven steps a scan reports, in order: "Step n of 7 · <phase>". */
export const BUILD_PHASES = [
  "fetch",
  "clean",
  "flights",
  "movement",
  "names",
  "roads",
  "nights",
] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];
/** Called as each phase STARTS; `progressReporter` maps it onto the job's `{done, total}`. */
export type BuildReport = (phase: BuildPhase) => void;

export const STATION_KINDS = ["visit", "brief", "dayTrip", "home", "airport"] as const;
export type StationKind = (typeof STATION_KINDS)[number];

/** What the user may make of an area; `skip` is never a default. */
export const AREA_CHOICES = ["roadtrip", "stops", "skip"] as const;
export type AreaChoice = (typeof AREA_CHOICES)[number];
export type AreaKind = Exclude<AreaChoice, "skip">;

/** The two leg modes the builder chooses between. */
export const BUILDER_LEG_MODES = ["road", "ferry"] as const satisfies readonly LegMode[];
export type BuilderLegMode = (typeof BUILDER_LEG_MODES)[number];

/** Where a station's title came from, first match wins (§C.5, §C.9). */
export type TitleSource = "existing" | "immich" | "geocode" | "coords" | "airport" | "home";

/** Why a leg is, or may be, a ferry (§C.7). `chip` never changes the default. */
export type FerryEvidence = "router" | "seaPhotos" | "chip";

// ─── Request (validated by schemas/tripBuilder.ts) ───────────────────────────

export type ScanTarget = { kind: "new" } | { kind: "existing"; tripId: string };

/** What a scan was asked for: `POST /trip-builder/scan` after validation. */
export interface ScanInput {
  name: string;
  startDay: Day;
  endDay: Day;
  inspect: boolean;
  createAlbum: boolean;
  target: ScanTarget;
}

// ─── Flights (loadFlights.ts, flightAnchors.ts) ──────────────────────────────

export interface FlightAnchor {
  id: string;
  /** "ZZ101 NVL→PCR": the flight number (else the airline), then the route. */
  label: string;
  depIata: string | null;
  arrIata: string | null;
  dep: Coord;
  arr: Coord;
  /** `flightEndZone(...)` (stats/departureClock.ts:42) of each end. */
  depZone: string | null;
  arrZone: string | null;
  depDay: Day;
  arrDay: Day;
  /** "HH:MM" on the airport's clock; null when the row has no time of day. */
  depClock: string | null;
  arrClock: string | null;
  /**
   * Both ends `TimeSemantics === "UTC"`, `precision !== "day"` and both times
   * present — stricter than the guard at photos/tripPhotoWindows.ts:183-211.
   */
  precise: boolean;
  /** `actualDeparture ?? departureTime` (and arrival) as epoch ms; non-null exactly when `precise`. */
  depMs: number | null;
  arrMs: number | null;
  hasActualDep: boolean;
  hasActualArr: boolean;
  tripId: string | null;
  tripName: string | null;
  /** Tickable in review: depDay ≤ E && arrDay ≥ S && depDay ≥ S − 1. */
  listed: boolean;
  /** Ticked when first shown: on no trip, or already on the target trip. */
  defaultAssign: boolean;
  /** Already on the target trip: shown ticked, cannot be unticked. */
  locked: boolean;
}

export type FlightSide = "before" | "after";
export type InFlightRule = "precise" | "delay" | "corridor" | "arrivalTolerance" | "departureGrace";

/** One photo against the flights (§C.4). */
export interface InFlightClass {
  inFlight: boolean;
  /** The flight the verdict was reached against; null when no flight rule applied. */
  flightId: string | null;
  rule: InFlightRule | null;
  /** A ground photo pinned to one side of `flightId` by tolerance or grace. */
  side: FlightSide | null;
}

/** Ground movement between two flights, or between a window end and a flight. */
export interface GroundArea {
  /** Movement photos (`isMovementPhoto`), by tMs. */
  photoIds: string[];
  /** At-sea photos on this side: ferry and night evidence only. */
  seaPhotoIds: string[];
  afterFlightId: string | null;
  beforeFlightId: string | null;
  startMs: number;
  endMs: number;
  startDay: Day;
  endDay: Day;
}

export interface Layover {
  inFlightId: string;
  outFlightId: string;
  airportIata: string | null;
  photoIds: string[];
}

export interface AreaSplit {
  areas: GroundArea[];
  layovers: Layover[];
}

/** A jump no flight explains: ≥ IMPLICIT_FLIGHT_MIN_KM at ≥ IMPLICIT_FLIGHT_MIN_KMH. */
export interface ImplicitGap {
  fromDay: Day;
  toDay: Day;
  from: Coord;
  to: Coord;
  km: number;
  kmh: number;
}

export interface AreaSegments {
  area: GroundArea;
  segments: RawSegment[];
}

export interface ImplicitSplit {
  parts: AreaSegments[];
  gaps: ImplicitGap[];
}

// ─── Stations, legs, home (stations.ts, ferry.ts, home.ts) ───────────────────

/** A review-page station; the plan modules use the same shape (`PlanStation`). */
export interface DraftStation {
  /**
   * Stable across re-scans: `round(lat/0.05)|round(lon/0.05)|firstDay` of the
   * unsnapped median and the first photo day (before any after-landing pull),
   * `~2`, `~3` … on a repeat. Made only by `stationKeyOf` + `claimKey`.
   */
  key: string;
  title: string;
  titleSource: TitleSource;
  kind: StationKind;
  /** `dayTrip` only: the key of the station the excursion left from. */
  excursionOf?: string;
  lat: number;
  lon: number;
  /** How far the median moved onto the road; null when it did not move. */
  snappedKm: number | null;
  firstDay: Day;
  lastDay: Day;
  /** First and last photo on its own clock; null for an added airport or home station. */
  firstLocal: LocalMinute | null;
  lastLocal: LocalMinute | null;
  photoCount: number;
  /** Indexes into the draft's preview list: ≤ PREVIEWS_PER_STATION, favourites first. */
  previewIdx: number[];
  /** "First photo HH:MM · last HH:MM · N photos", pre-filled; null for an added station. */
  notes: string | null;
}
export type PlanStation = DraftStation;

export interface StationSpan {
  firstMs: number;
  lastMs: number;
}

/** A transit-noise segment, shown as a chip instead of a station (§C.6). */
export interface PassedThrough {
  title: string;
  firstLocal: LocalMinute;
  photoCount: number;
}

export interface StationBuild {
  /** Travel order. */
  stations: PlanStation[];
  /**
   * Movement photo id → station key. A transit-noise photo maps to the next
   * kept station of its area, else the previous one; a home-only area maps to
   * `NIGHT_HOME`. An excursion's photos map to the excursion, which nights.ts
   * never takes as P.
   */
  photoStation: Map<string, string>;
  /** Station key → the cluster it stands for. */
  stationCluster: Map<string, string>;
  /** Station key → its first and last photo instant. */
  spanMs: Map<string, StationSpan>;
  /** Station key → up to PREVIEWS_PER_STATION asset ids. SERVER-ONLY. */
  previewPhotoIds: Map<string, string[]>;
  /** Day → its passed-through chips. */
  passedThrough: Map<Day, PassedThrough[]>;
}

export interface DraftLeg {
  fromKey: string;
  toKey: string;
  chordKm: number;
  /** The probe's road distance; null without a probe or a route. */
  routedKm: number | null;
  mode: BuilderLegMode;
  ferryEvidence: FerryEvidence | null;
}
export type PlanLeg = DraftLeg;

/** What `decideLegMode` weighs for one leg (§C.7). */
export interface LegEvidence {
  chordKm: number;
  /** `RouteProvider.probe` (custom OSRM only); null when not asked or no route. */
  probe: { distanceKm: number; ferryKm: number } | null;
  /** At-sea photos with t between the two stations. */
  seaPhotosBetween: number;
  /** The land-polygon chord test: a chip, never a default. */
  waterChip: boolean;
}

/** The home on a day: `periodAt(...)` plus its zone (§C.9). */
export interface HomeAtDay {
  /** `residence.name` as stored, e.g. "Kelmore, Westshire". */
  name: string;
  lat: number;
  lon: number;
  /** False for a period migrated from the old airport-only shape. */
  confirmed: boolean;
  zone: string | null;
  /** The period's airport codes, upper-case. */
  airports: ReadonlySet<string>;
}

export interface HomeEnd {
  /** This end of the area has no flight and a home exists on that day. */
  offered: boolean;
  /** `station` starts out in the area's `stations` (decision 6). */
  defaultOn: boolean;
  /** The station the switch adds or removes; absent when not offered. */
  station?: DraftStation;
}

export interface AreaHome {
  start: HomeEnd;
  end: HomeEnd;
  /** The residence is unconfirmed: chip "home location not confirmed". */
  unconfirmed: boolean;
}

// ─── Nights (nights.ts) ──────────────────────────────────────────────────────

export type NightReason =
  "flight" | "afterLanding" | "unknown" | "ferry" | "home" | "nightDrive" | "lastPhoto";

export interface NightEntry {
  assign: NightAssign;
  reason: NightReason;
  /** For an unknown night: the station on both sides, else the gap's neighbours (§C.8 rule 3). */
  suggestedStationKeys: string[];
}

/** Rule 2 pulled a station's (and its area's) first day back to the landing night. */
export interface DayPull {
  areaKey: string;
  stationKey: string;
  firstDay: Day;
}

export interface NightAttribution {
  /** Every night S … E−1. */
  nights: Record<Day, NightEntry>;
  pulls: DayPull[];
}

/** One area as the plan modules see it once it has stations, legs and home ends. */
export interface AreaPlan extends StationBuild {
  /** `areaKeyOf(startDay, n)`: `<startDay>#<n>`. */
  key: string;
  area: GroundArea;
  segments: Segment[];
  /** legs[i] joins stations[i] and stations[i + 1]. */
  legs: PlanLeg[];
  home: AreaHome;
}

export interface NightInputs {
  window: ScanWindow;
  areas: readonly AreaPlan[];
  /** Movement and at-sea photos of the window. */
  photosById: ReadonlyMap<string, PhotoPoint>;
  anchors: readonly FlightAnchor[];
  homeAt: (day: Day) => HomeAtDay | null;
}

// ─── The draft DTO (GET /trip-builder/drafts/:id) ────────────────────────────

export interface DraftArea {
  key: string;
  defaultAs: AreaKind;
  /** Exactly the trip name, or "<Trip> · <mainCity>" (`roadtripAreaNames`). */
  suggestedName: string;
  mainCity: string | null;
  startDay: Day;
  endDay: Day;
  afterFlightId?: string;
  beforeFlightId?: string;
  home: AreaHome;
  stations: DraftStation[];
  /** legs[i] joins stations[i] and stations[i + 1]. */
  legs: DraftLeg[];
}

export interface DraftFlight {
  id: string;
  label: string;
  depIata: string | null;
  arrIata: string | null;
  /** "YYYY-MM-DD HH:MM", or "YYYY-MM-DD" for a row with no time of day. */
  depLocal: string;
  arrLocal: string;
  precise: boolean;
  /** The OTHER trip it is filed on ("currently in X"); null when on none or on the target. */
  currentTrip: { id: string; name: string } | null;
  defaultAssign: boolean;
  locked: boolean;
  /** Ground photos between this arrival and the next departure from the same airport. */
  layover?: { photoCount: number; airportIata: string | null };
}

export interface DraftDay {
  day: Day;
  photos: number;
  located: number;
  stationKeys: string[];
  flightIds: string[];
  passedThrough: PassedThrough[];
}

export interface DraftPhotoJourney {
  id: string;
  startDay: Day;
  endDay: Day;
  defaultTick: true;
}

export type AlbumCapabilityReason =
  "notConfigured" | "sharedConnection" | "missingScopes" | "unverified";

export interface DraftAlbum {
  name: string;
  /** An album the user owns under exactly this name. */
  existing: { immichAlbumId: string; assetCount: number; linkedTripName?: string } | null;
  assetCount: number;
  images: number;
  videos: number;
  allowed: boolean;
  blockedReason?: AlbumCapabilityReason;
  missingScopes: string[];
}

export interface DraftStats {
  /** In-window own photos and videos: what the album would get. */
  assets: number;
  images: number;
  videos: number;
  located: number;
  excluded: ExcludedCounts;
  truncated: boolean;
}

export type NoParams = Record<string, never>;

/** Every warning a draft can carry (§C.12); `params` is typed per code. */
export type BuilderWarning =
  | { code: "truncated"; params: NoParams }
  | {
      code: "possibleUnrecordedFlight";
      params: {
        fromDay: Day;
        toDay: Day;
        nearestAirports: { from: string | null; to: string | null };
      };
    }
  | { code: "noRouting"; params: NoParams }
  /** Routing exists but is not the custom OSRM: no probe, no snap, ferries by deck photos only. */
  | { code: "cannotSnap"; params: NoParams }
  /** Station keys with no route, or a snap beyond SNAP_MAX_KM. */
  | { code: "noRoadData"; params: { stations: string[] } }
  | { code: "roadtripsHidden"; params: NoParams }
  | {
      code: "overlappingTrip";
      params: { name: string; startDay: Day; endDay: Day; suspiciouslyLong: boolean };
    }
  | {
      code: "flightOutsideDates";
      params: { flightId: string; suggestStartDay?: Day; suggestEndDay?: Day };
    }
  | { code: "movementOutsideDates"; params: { day: Day; km: number } }
  | { code: "pendingPhotoJourneys"; params: { ids: string[] } }
  | { code: "albumLinkedElsewhere"; params: { tripName: string } }
  | { code: "homeUnconfirmed"; params: NoParams }
  | {
      code: "emptyWindow";
      params: { checkedFrom: Day; checkedTo: Day; partner: number; trashedNote: boolean };
    }
  | { code: "noLocatedPhotos"; params: NoParams };
export type WarningCode = BuilderWarning["code"];

export interface TripBuilderDraft {
  id: string;
  /** ISO instant: min(touchedAt + idle TTL, createdAt + max TTL), recomputed on every read. */
  expiresAt: string;
  window: { startDay: Day; endDay: Day; checkedFrom: Day; checkedTo: Day };
  options: { inspect: boolean; createAlbum: boolean };
  target: { kind: "new" } | { kind: "existing"; tripId: string; tripName: string };
  tripName: string;
  countries: string[];
  originLabel: string | null;
  destinationLabel: string | null;
  stats: DraftStats;
  /** Listed flights only (`FlightAnchor.listed`). */
  flights: DraftFlight[];
  /** Every day S … E; empty without `inspect`. */
  days: DraftDay[];
  /** Every night S … E−1; empty without `inspect`. */
  nights: Record<Day, NightEntry>;
  areas: DraftArea[];
  photoJourneys: DraftPhotoJourney[];
  /** Null unless `createAlbum`. */
  album: DraftAlbum | null;
  warnings: BuilderWarning[];
}

// ─── Capabilities (GET /trip-builder/capabilities) ───────────────────────────

export interface CapabilitiesDto {
  immich: {
    configured: boolean;
    source: ImmichConnectionSource | null;
    /** asset.read + user.read + asset.view; `ok: null` when `/api-keys/me` could not answer. */
    inspect: { ok: boolean | null; missingScopes: string[] };
    /** album.read + album.create + albumAsset.create, and only on the user's own connection. */
    album: { canCreate: boolean | null; reason: AlbumCapabilityReason | null };
  };
  /** `loadVisibleDomains(userId)` includes `roadtrip`. */
  roadtrips: boolean;
  routing: { available: boolean; canProbe: boolean };
  home: { known: boolean; confirmed: boolean };
}

// ─── Draft store (draftStore.ts) ─────────────────────────────────────────────

export type DraftStatus = "ready" | "committing" | "committed";

export interface StationIndexEntry {
  areaKey: string;
  firstDay: Day;
  lastDay: Day;
}

export interface StoredDraft {
  id: string;
  ownerId: string;
  /** Epoch ms from `now()` (shared/time/clock.ts:21). */
  createdAt: number;
  touchedAt: number;
  status: DraftStatus;
  commitKey?: string;
  commitJobId?: string;
  /** Set by `finishCommit` right after phase B. */
  result?: CommitResult;
  input: ScanInput;
  immichUserId: string;
  connSource: ImmichConnectionSource;
  dto: TripBuilderDraft;
  /** ≤ MAX_PREVIEWS, addressed by index. SERVER-ONLY. */
  previewAssetIds: string[];
  /** SERVER-ONLY. */
  albumAssetIds: string[];
  /** The listed flights: the only ones a commit may assign. */
  flightIds: ReadonlySet<string>;
  /** Every station the draft offered, offered home stations included → its area and days. */
  stationIndex: ReadonlyMap<string, StationIndexEntry>;
}

export type BeginCommit =
  | { kind: "start" }
  | { kind: "inProgress"; jobId: string }
  | { kind: "committed"; result: CommitResult }
  | { kind: "busy" }
  | { kind: "missing" };

// ─── Commit (commitPlan.ts, commit.ts, albumWrite.ts) ────────────────────────

export type AlbumErrorKind = ImmichErrorKind | "notConfigured" | "internal";

/** Phase D's answer and the album-retry job's result. Never thrown. */
export interface AlbumOutcome {
  status: "linked" | "skipped" | "failed" | "blocked";
  skipReason?: "notRequested" | "noAssets";
  immichAlbumId?: string;
  albumName?: string;
  /** An album the user already owned under this exact name was reused. */
  reused?: boolean;
  added?: number;
  alreadyIn?: number;
  refused?: number;
  error?: { kind: AlbumErrorKind; missingScope?: string };
  missingScopes?: string[];
}

export interface CommitRoadtripSummary {
  id: string;
  name: string;
  stations: number;
  nights: number;
}

export interface CommitResult {
  tripId: string;
  /** False for the `existing` target. */
  created: boolean;
  roadtrips: CommitRoadtripSummary[];
  stopIds: string[];
  flightsAssigned: number;
  /** Trips a ticked flight was moved off; their status was recomputed. */
  flightsMovedFrom: Array<{ tripId: string; name: string }>;
  routing: { routed: number; straight: number; ferry: number; providerAvailable: boolean };
  photoJourneysResolved: number;
  unknownNights: number;
  album: AlbumOutcome;
}

/** Why phase P stopped before any write (§A). */
export type PreflightBlockReason =
  "sharedConnection" | "connectionChanged" | "missingScopes" | "unreachable";

export interface CommitBlocked {
  status: "blocked";
  reason: PreflightBlockReason;
  missingScopes: string[];
}

/** The `tripBuilder.commit` job's result; `blocked` is a success that wrote nothing. */
export type CommitJobResult = ({ status: "committed" } & CommitResult) | CommitBlocked;

/** The `tripBuilder.scan` job's result. */
export interface ScanJobResult {
  draftId: string;
}

/** One timeline stop of a `stops` area; consecutive stations of one title make one stop. */
export interface StopPlan {
  areaKey: string;
  title: string;
  lat: number;
  lon: number;
  startDay: Day;
  endDay: Day;
  notes: string | null;
}

export interface RoadtripPlan {
  areaKey: string;
  name: string;
  vehicle: RoadtripVehicle;
  /** `stationsSchema`-parsed `deriveStationRows`: slept → `{kind:"free"}`, else `{kind:"pass"}`. */
  stations: StationsInput["stations"];
  /** `rowLegModes`: legModes[i] joins stations[i] and stations[i + 1]. */
  legModes: BuilderLegMode[];
  nights: number;
}

export type CommitTargetPlan =
  | { kind: "new"; trip: CreateTripInput }
  | {
      kind: "existing";
      tripId: string;
      tripName: string;
      applyWindow: boolean;
      countries: string[];
    };

/** What the sync commit handler validated; the job writes exactly this. */
export interface CommitPlan {
  draftId: string;
  userId: string;
  window: { startDay: Day; endDay: Day };
  /** `new`: the form with the window, countries and labels already merged in. */
  target: CommitTargetPlan;
  flightIds: string[];
  stops: StopPlan[];
  roadtrips: RoadtripPlan[];
  photoJourneyIds: string[];
  album: { create: boolean; name: string };
  unknownNights: number;
}

export interface PhaseBRoadtrip extends CommitRoadtripSummary {
  /** Legs the transaction created, for phase C to route; ferry legs are skipped there. */
  createdLegs: LegPair[];
  ferryLegs: number;
}

/** What phase B's one transaction wrote. */
export interface PhaseBResult {
  tripId: string;
  created: boolean;
  roadtrips: PhaseBRoadtrip[];
  stopIds: string[];
  flightsAssigned: number;
  flightsMovedFrom: Array<{ tripId: string; name: string }>;
}
