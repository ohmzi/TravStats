/**
 * The trip builder's wire vocabulary (spec 2026-10-09 §F, §G). Mirrors the DTO
 * half of `backend/src/services/tripBuilder/types.ts` and the request schemas
 * of `backend/src/schemas/tripBuilder.ts` — change them together.
 *
 * No field carries an Immich asset id: a thumbnail is
 * `tripBuilderApi.previewUrl(draftId, index, size)`, and the draft is the grant.
 */
import type { CreateTripInput } from "../lib/api/trips";
import type { NightAssign } from "../shared/tour/builderNightPlan";
import type { RoadtripVehicle } from "../shared/tour/roadtrip";
import type { ImmichConnectionSource } from "./immich";

export {
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_SPECIALS,
  NIGHT_UNKNOWN,
  type NightAssign,
} from "../shared/tour/builderNightPlan";

/** `YYYY-MM-DD`: a calendar day on the clock of the place it happened. */
export type Day = string;
/** `YYYY-MM-DD HH:MM`: a wall clock to the minute, space-separated. */
export type LocalMinute = string;

/** The seven steps a scan reports: "Step n of 7 · <phase>" is `progress.done` of these. */
export const TRIP_BUILDER_PHASES = [
  "fetch",
  "clean",
  "flights",
  "movement",
  "names",
  "roads",
  "nights",
] as const;
export type TripBuilderPhase = (typeof TRIP_BUILDER_PHASES)[number];

export type StationKind = "visit" | "brief" | "dayTrip" | "home" | "airport";
export type AreaChoice = "roadtrip" | "stops" | "skip";
export type AreaKind = Exclude<AreaChoice, "skip">;
export type BuilderLegMode = "road" | "ferry";
export type TitleSource = "existing" | "immich" | "geocode" | "coords" | "airport" | "home";
export type FerryEvidence = "router" | "seaPhotos" | "chip";

// ─── Re-sync of an existing trip (spec §K) ───────────────────────────────────

export const STATION_STATUSES = ["same", "changed", "new", "notSeen"] as const;
export type StationStatus = (typeof STATION_STATUSES)[number];

/** What a changed pill shows on its left: the stored dates and night. */
export interface StationBefore {
  startDate: Day | null;
  endDate: Day | null;
  slept: boolean;
  /** The night is a stay: the stay owns it, whatever the photos say. */
  stay: boolean;
}

export interface NotSeenDefault {
  defaultKeep: boolean;
  reason: "outsideWindow" | "notInPhotos";
}

export interface RoadtripDiff {
  updated: number;
  unchanged: number;
  added: number;
  removed: number;
  kept: number;
}

export interface AlbumSyncPreview {
  target: "linked" | "byName" | "create";
  toAdd: number;
  alreadyIn: number;
  removable: {
    count: number;
    defaultOn: boolean;
    allowed: boolean;
    missingScope?: string;
  };
}

export type PreviewSize = "thumbnail" | "preview";
export type ScanTarget = { kind: "new" } | { kind: "existing"; tripId: string };

// ─── The draft (GET /trip-builder/drafts/:id) ────────────────────────────────

export interface DraftStation {
  /** Stable across re-scans; what `reapplyEdits` matches edits by. */
  key: string;
  title: string;
  titleSource: TitleSource;
  kind: StationKind;
  /** `dayTrip` only: the key of the station the excursion left from. */
  excursionOf?: string;
  lat: number;
  lon: number;
  snappedKm: number | null;
  firstDay: Day;
  lastDay: Day;
  firstLocal: LocalMinute | null;
  lastLocal: LocalMinute | null;
  photoCount: number;
  /** Indexes for `tripBuilderApi.previewUrl`. */
  previewIdx: number[];
  notes: string | null;
  /** Re-sync only. */
  status?: StationStatus;
  existingId?: string;
  before?: StationBefore;
  notSeen?: NotSeenDefault;
}

export interface DraftLeg {
  fromKey: string;
  toKey: string;
  chordKm: number;
  routedKm: number | null;
  /**
   * The mode the review shows and the commit writes; on a matched pair that
   * updates a stored leg it starts on the stored mode, so an untouched leg
   * stays as the trip holds it.
   */
  mode: BuilderLegMode;
  /** Re-sync only: the mode the scan derived, on a leg that updates a stored one. */
  derivedMode?: BuilderLegMode;
  ferryEvidence: FerryEvidence | null;
}

export interface HomeEnd {
  offered: boolean;
  defaultOn: boolean;
  station?: DraftStation;
}

export interface AreaHome {
  start: HomeEnd;
  end: HomeEnd;
  unconfirmed: boolean;
}

export interface DraftArea {
  key: string;
  defaultAs: AreaKind;
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
  /** Re-sync only: the stored roadtrip this area updates in place. */
  roadtripId?: string;
  /** Re-sync only: stored stations the photos do not show. */
  notSeen?: DraftStation[];
}

export interface DraftFlight {
  id: string;
  label: string;
  depIata: string | null;
  arrIata: string | null;
  depLocal: string;
  arrLocal: string;
  precise: boolean;
  currentTrip: { id: string; name: string } | null;
  defaultAssign: boolean;
  locked: boolean;
  layover?: { photoCount: number; airportIata: string | null };
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

/** A stopover the scan offers (spec 2026-10-11 §2.3): a layover with an outing. */
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
  /** Re-sync only: the stored roadtrip this stopover matches (spec §6). */
  roadtripId?: string;
  /** Re-sync only: that roadtrip's stored photo count (spec §6). */
  storedPhotoCount?: number;
  /** Re-sync only: set ⇔ both switches are shown on and locked — this stopover is already synced. */
  stored?: StoredStopoverStatus;
}

export interface PassedThrough {
  title: string;
  firstLocal: LocalMinute;
  photoCount: number;
}

export interface DraftDay {
  day: Day;
  photos: number;
  located: number;
  stationKeys: string[];
  flightIds: string[];
  passedThrough: PassedThrough[];
}

export type NightReason =
  "flight" | "afterLanding" | "unknown" | "ferry" | "home" | "nightDrive" | "lastPhoto";

export interface NightEntry {
  assign: NightAssign;
  reason: NightReason;
  suggestedStationKeys: string[];
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
  existing: { immichAlbumId: string; assetCount: number; linkedTripName?: string } | null;
  assetCount: number;
  images: number;
  videos: number;
  allowed: boolean;
  blockedReason?: AlbumCapabilityReason;
  missingScopes: string[];
  /** Re-sync only. */
  sync?: AlbumSyncPreview;
}

export interface ExcludedCounts {
  partner: number;
  hiddenLivePart: number;
  misdated: number;
  inFlight: number;
  atSea: number;
  unlocated: number;
  dayGuessed: number;
}

export interface DraftStats {
  assets: number;
  images: number;
  videos: number;
  located: number;
  excluded: ExcludedCounts;
  truncated: boolean;
}

export type NoParams = Record<string, never>;

export type BuilderWarning =
  | { code: "truncated"; params: NoParams }
  /** More listed flights than the commit accepts; `count` were left out. */
  | { code: "truncatedFlights"; params: { count: number } }
  /** More areas than the commit accepts; `count` were left out. */
  | { code: "truncatedAreas"; params: { count: number } }
  /** More pending photo findings than the commit accepts; `count` were left out. */
  | { code: "truncatedJourneys"; params: { count: number } }
  | {
      code: "possibleUnrecordedFlight";
      params: {
        fromDay: Day;
        toDay: Day;
        nearestAirports: { from: string | null; to: string | null };
      };
    }
  | { code: "noRouting"; params: NoParams }
  | { code: "cannotSnap"; params: NoParams }
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
  expiresAt: string;
  window: { startDay: Day; endDay: Day; checkedFrom: Day; checkedTo: Day };
  options: { inspect: boolean; createAlbum: boolean };
  target: { kind: "new" } | { kind: "existing"; tripId: string; tripName: string };
  tripName: string;
  countries: string[];
  originLabel: string | null;
  destinationLabel: string | null;
  stats: DraftStats;
  flights: DraftFlight[];
  days: DraftDay[];
  nights: Record<Day, NightEntry>;
  areas: DraftArea[];
  /** The stopover roadtrips the scan's layovers offer (spec 2026-10-11 §2.3). */
  stopovers?: DraftStopover[];
  photoJourneys: DraftPhotoJourney[];
  album: DraftAlbum | null;
  /** Re-sync only: timeline stops the photos do not show. */
  notSeenStops?: DraftStation[];
  warnings: BuilderWarning[];
}

// ─── Capabilities (GET /trip-builder/capabilities) ───────────────────────────

export interface CapabilitiesDto {
  immich: {
    configured: boolean;
    source: ImmichConnectionSource | null;
    inspect: { ok: boolean | null; missingScopes: string[] };
    album: { canCreate: boolean | null; reason: AlbumCapabilityReason | null };
  };
  roadtrips: boolean;
  routing: { available: boolean; canProbe: boolean };
  home: { known: boolean; confirmed: boolean };
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface ScanBody {
  name: string;
  startDay: Day;
  endDay: Day;
  inspect: boolean;
  createAlbum: boolean;
  target: ScanTarget;
}

export interface CommitStation {
  key: string;
  title: string;
  lat: number;
  lon: number;
  kind: StationKind;
  firstDay: Day;
  lastDay: Day;
  notes?: string | null;
  /** Re-sync only: the stored station this one updates. */
  existingId?: string;
}

export interface CommitArea {
  key: string;
  as: AreaChoice;
  name: string;
  vehicle: RoadtripVehicle;
  homeStart: boolean;
  homeEnd: boolean;
  stations: CommitStation[];
  /** legModes[i] joins stations[i] and stations[i + 1]. */
  legModes: BuilderLegMode[];
  /** Re-sync only. */
  roadtripId?: string;
  keepNotSeen?: string[];
  removeNotSeen?: string[];
}

export type CommitTarget =
  | { kind: "new"; trip: CreateTripInput }
  | { kind: "existing"; tripId: string; applyWindow: boolean; countries?: string[] };

export interface CommitBody {
  /** One per review session (`useRef` + sessionStorage); a retry re-sends the same key. */
  commitKey: string;
  window: { startDay: Day; endDay: Day };
  target: CommitTarget;
  flightIds: string[];
  nights: Record<Day, NightAssign>;
  /** Every area, `skip` ones included. */
  areas: CommitArea[];
  /** Only the stopovers the user turned on (§5.1); empty when the scan offered none. */
  stopovers: Array<{ key: string; roadtrip: boolean; album: boolean }>;
  photoJourneyIds: string[];
  /** Re-sync only: timeline stops the photos do not show. */
  stops?: { keep: string[]; remove: string[] };
  album: { create: boolean; name: string; removeOutside?: boolean };
}

// ─── Job results (GET /jobs/:id → result) ────────────────────────────────────

export interface ScanJobResult {
  draftId: string;
}

export type AlbumErrorKind =
  "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl" | "notConfigured" | "internal";

export interface AlbumOutcome {
  status: "linked" | "skipped" | "failed" | "blocked";
  skipReason?: "notRequested" | "noAssets";
  immichAlbumId?: string;
  albumName?: string;
  reused?: boolean;
  added?: number;
  alreadyIn?: number;
  refused?: number;
  removed?: number;
  removeSkipped?: "missingScope" | "albumChanged" | "failed";
  error?: { kind: AlbumErrorKind; missingScope?: string };
  missingScopes?: string[];
}

export interface CommitResult {
  tripId: string;
  created: boolean;
  roadtrips: Array<{
    id: string;
    name: string;
    stations: number;
    nights: number;
    diff?: RoadtripDiff;
  }>;
  stopIds: string[];
  flightsAssigned: number;
  flightsMovedFrom: Array<{ tripId: string; name: string }>;
  routing: { routed: number; straight: number; ferry: number; providerAvailable: boolean };
  photoJourneysResolved: number;
  unknownNights: number;
  stops?: RoadtripDiff;
  album: AlbumOutcome;
  /** Success panel (spec §5.4): one entry per stopover the commit gave its own album. */
  stopoverAlbums?: StopoverAlbumOutcome[];
}

/** One stopover album a commit wrote, and what became of it. */
export interface StopoverAlbumOutcome {
  /** The stopover key, `<inFlightId>#<outFlightId>`. */
  key: string;
  /** The album's name, `<City> <Year> Road Trip`; what its retry posts back. */
  name: string;
  album: AlbumOutcome;
}

/** Which album a success-panel retry names: the trip's own, or a stopover's by key (spec §5.4). */
export type AlbumRetryTarget = "trip" | `stopover:${string}`;
/** The retry target of a stopover album, from its stopover key. */
export const stopoverRetry = (key: string): AlbumRetryTarget => `stopover:${key}`;

export type PreflightBlockReason =
  "sharedConnection" | "connectionChanged" | "missingScopes" | "unreachable";

export interface CommitBlocked {
  status: "blocked";
  reason: PreflightBlockReason;
  missingScopes: string[];
}

export type CommitJobResult = ({ status: "committed" } & CommitResult) | CommitBlocked;

/** sessionStorage `tb:job:<jobId>`: what the launcher hands the review page. */
export interface LauncherHandoff {
  form: CreateTripInput;
  target: ScanTarget;
  /** Where "← Back" returns, e.g. "/trips" or "/trips/<id>". */
  returnTo: string;
  /**
   * The scan request itself. A scan that fails before any draft exists has
   * nothing to rebuild it from, so the review page keeps this and offers
   * "Scan again" (spec §G).
   */
  scan?: ScanBody;
}
