/**
 * The trip builder's draft-store and commit vocabulary (spec
 * docs/superpowers/specs/2026-10-09-immich-trip-builder-design.md, §A, §D, §F):
 * `StoredDraft`, the commit plan, the phase results and the job results.
 *
 * Split out of `types.ts` only to keep each file under the 800-line cap. It is
 * one vocabulary with that file, which re-exports every name below — import
 * them from `./types` like any other. The stored draft, the commit plan and the
 * phase results never leave the server; the job results (`ScanJobResult`,
 * `CommitJobResult`, `CommitResult`, `AlbumOutcome`) are what the jobs answer,
 * and are mirrored in `frontend/src/types/tripBuilder.ts` with the DTO half.
 */
import type { CreateTripInput } from "../../schemas/trip";
import type { StationsInput } from "../../schemas/roadtrip";
import type { LegPair } from "../../shared/tour/legPlan";
import type { RoadtripVehicle } from "../../shared/tour/roadtrip";
import type { ImmichConnectionSource, ImmichErrorKind } from "../immich/types";
import type { BuilderLegMode, Day, ScanInput, TripBuilderDraft } from "./types";

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
