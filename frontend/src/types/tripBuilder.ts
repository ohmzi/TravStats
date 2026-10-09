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
}

export interface DraftLeg {
  fromKey: string;
  toKey: string;
  chordKm: number;
  routedKm: number | null;
  mode: BuilderLegMode;
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
  photoJourneys: DraftPhotoJourney[];
  album: DraftAlbum | null;
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
  photoJourneyIds: string[];
  album: { create: boolean; name: string };
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
  error?: { kind: AlbumErrorKind; missingScope?: string };
  missingScopes?: string[];
}

export interface CommitResult {
  tripId: string;
  created: boolean;
  roadtrips: Array<{ id: string; name: string; stations: number; nights: number }>;
  stopIds: string[];
  flightsAssigned: number;
  flightsMovedFrom: Array<{ tripId: string; name: string }>;
  routing: { routed: number; straight: number; ferry: number; providerAvailable: boolean };
  photoJourneysResolved: number;
  unknownNights: number;
  album: AlbumOutcome;
}

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
