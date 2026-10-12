/**
 * The trip builder's orchestrator (spec 2026-10-09 §C.12): one scan request in,
 * one in-memory draft out. It runs seven steps and reports each as it starts
 * (fetch, clean, flights, movement, names, roads, nights), then assembles the
 * DTO the review page reads and the server-only parts the commit needs
 * (thumbnail assets, album assets, the stations a commit may name).
 *
 * `buildDraftWith` takes every impure dependency as a parameter, so the
 * scenario tests run it over synthetic photos.
 */
import type { ReportProgress } from "../jobs/jobRegistry";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { getImmichConnection } from "../immich/immichResolver";
import { ImmichError, type ImmichErrorKind } from "../immich/types";
import { resolveBuilderDeps } from "./resolveDeps";
import { roadtripAreaNames } from "../../shared/tour/builderNightPlan";
import type { AirportData } from "../airportLookup";
import type { GeocodeParts } from "../geo/nominatim";
import type { ImmichClient, ImmichDateRange } from "../immich/immichClient";
import type { ImmichConnectionSource } from "../immich/types";
import type { Coord } from "../tour/tourDistance";
import { flagAtSea, flagMisdated, isMovementPhoto, markPhotos } from "./clean";
import { classifyInFlight, splitIntoAreas } from "./flightAnchors";
import { clockAssets } from "./clock";
import { collectWindow, type CollectDeps, type CollectedWindow } from "./collect";
import { decideAreaKind, draftCountries, draftLabels, mainCityOf, toDraftArea } from "./areas";
import {
  emptyMovement,
  isSeaPhoto,
  movementPhase,
  namesPhase,
  nightsPhase,
  roadsPhase,
  stopoversPhase,
  type StopoverPass,
} from "./areaPlans";
import { assembleWarnings, movementOutsideDates, type UnrecordedFlight } from "./draftWarnings";
import { applyExistingTarget, type ExistingDeps } from "./existingDraft";
import { indexPreviews } from "./stations";
import { namedPitstops, pitstopAreas, storedPitstops, type PitstopPass } from "./pitstops";
import { mergeAreaPlans, routeScopeOf } from "./routeScope";
import type { RoadAccess } from "./probe";
import {
  DRAFT_IDLE_TTL_MS,
  MAX_AREAS,
  MAX_COMMIT_FLIGHTS,
  MAX_PHOTO_JOURNEYS,
  MISDATED_LOOKUP_PAD_DAYS,
} from "./thresholds";
import {
  BUILD_PHASES,
  type AreaPlan,
  type AreaSplit,
  type Bbox,
  type BuildPhase,
  type BuildReport,
  type CountryAt,
  type Day,
  type DraftAlbum,
  type DraftArea,
  type DraftDay,
  type DraftFlight,
  type DraftPhotoJourney,
  type DraftStation,
  type ExcludedCounts,
  type ExistingTitle,
  type FileNameLookup,
  type FlightAnchor,
  type HomeAtDay,
  type ImplicitGap,
  type InFlightClass,
  type PhotoFlags,
  type PhotoPoint,
  type ScanInput,
  type ScanWindow,
  type StationIndexEntry,
  type StoredDraft,
  type StoredStopover,
  type TripBuilderDraft,
} from "./types";
import { windowDays } from "./window";

const DAY_MS = 86_400_000;

export interface OverlapTrip {
  id: string;
  name: string;
  startDay: Day;
  endDay: Day;
}

export interface AlbumDeps {
  gate: Pick<DraftAlbum, "allowed" | "blockedReason" | "missingScopes">;
  findOwned(name: string): Promise<{ immichAlbumId: string; assetCount: number } | null>;
  linkedTripName(immichAlbumId: string): Promise<string | null>;
}

export interface BuilderDeps extends CollectDeps {
  immich: Pick<ImmichClient, "searchWindowAssets" | "searchByFileName">;
  immichUserId: string;
  connSource: ImmichConnectionSource;
  countryAt: CountryAt;
  existingTitles(bbox: Bbox): Promise<ExistingTitle[]>;
  reverseGeocode(lat: number, lon: number): Promise<GeocodeParts | null>;
  airports(codes: readonly string[]): Promise<ReadonlyMap<string, AirportData>>;
  nearestAirportIata(c: Coord): Promise<string | null>;
  roads: RoadAccess;
  roadtripsVisible: boolean;
  overlappingTrips(window: ScanWindow, excludeTripId: string | null): Promise<OverlapTrip[]>;
  pendingPhotoJourneys(window: ScanWindow): Promise<DraftPhotoJourney[]>;
  targetTrip: { id: string; name: string; countries: string[]; roadtripNames: string[] } | null;
  /** The stored state and Immich client for an existing-trip scan; absent or null for a new trip. */
  existing?: ExistingDeps | null;
  album: AlbumDeps | null;
  newId(): string;
  nowMs(): number;
}

/** Maps "phase n of 7 started" onto the job's `{done, total}`. */
export function progressReporter(reportProgress: ReportProgress): BuildReport {
  return (phase: BuildPhase) =>
    reportProgress(BUILD_PHASES.indexOf(phase) + 1, BUILD_PHASES.length);
}

// ─── Clean and flights ───────────────────────────────────────────────────────

type FlagPatch = ReadonlyArray<readonly [string, Partial<PhotoFlags>]>;

function withFlags(photos: PhotoPoint[], patch: FlagPatch): PhotoPoint[] {
  const patches = new Map<string, Partial<PhotoFlags>>();
  for (const [id, flags] of patch) patches.set(id, { ...patches.get(id), ...flags });
  return patches.size === 0 ? photos : markPhotos(photos, patches);
}

/** `searchByFileName` over the fetch range ± the lookup pad, put on the same clocks. */
function clockedLookup(deps: BuilderDeps, collected: CollectedWindow): FileNameLookup {
  const pad = MISDATED_LOOKUP_PAD_DAYS * DAY_MS;
  const range: ImmichDateRange = {
    takenAfter: new Date(collected.window.fetchFrom.getTime() - pad),
    takenBefore: new Date(collected.window.fetchTo.getTime() + pad),
  };
  return async (fragment) =>
    clockAssets(await deps.immich.searchByFileName(fragment, range), collected.clock);
}

async function cleanPhase(
  deps: BuilderDeps,
  collected: CollectedWindow
): Promise<{ photos: PhotoPoint[]; excluded: ExcludedCounts }> {
  const { photos, context, excluded } = collected.clean;
  const misdated = await flagMisdated(photos, context, clockedLookup(deps, collected));
  const atSea = flagAtSea(
    photos.filter((p) => p.flags.located),
    deps.countryAt
  );
  const flagged = withFlags(photos, [
    ...[...misdated].map(([id, reason]) => [id, { misdated: reason }] as const),
    ...[...atSea].map((id) => [id, { atSea: true }] as const),
  ]);
  return { photos: flagged, excluded: { ...excluded, misdated: misdated.size, atSea: atSea.size } };
}

interface FlightPhase {
  photos: PhotoPoint[];
  split: AreaSplit;
  inFlight: number;
}

function flightPhase(photos: PhotoPoint[], anchors: readonly FlightAnchor[]): FlightPhase {
  const candidates = photos.filter(
    (p) => p.flags.located && !p.flags.duplicate && p.flags.misdated === null
  );
  const classes: ReadonlyMap<string, InFlightClass> = classifyInFlight(candidates, anchors);
  const flown = [...classes]
    .filter(([, verdict]) => verdict.inFlight)
    .map(([id]) => [id, { inFlight: true }] as const);
  const flagged = withFlags(photos, flown);
  const split = splitIntoAreas(
    flagged.filter((p) => isMovementPhoto(p) || isSeaPhoto(p)),
    anchors,
    classes
  );
  const layover = split.layovers.flatMap((l) =>
    l.photoIds.map((id) => [id, { layover: true }] as const)
  );
  return { photos: withFlags(flagged, layover), split, inFlight: flown.length };
}

// ─── DTO pieces ──────────────────────────────────────────────────────────────

function toDraftFlight(
  anchor: FlightAnchor,
  targetTripId: string | null,
  layover?: DraftFlight["layover"]
): DraftFlight {
  return {
    id: anchor.id,
    label: anchor.label,
    depIata: anchor.depIata,
    arrIata: anchor.arrIata,
    depLocal: anchor.depClock ? `${anchor.depDay} ${anchor.depClock}` : anchor.depDay,
    arrLocal: anchor.arrClock ? `${anchor.arrDay} ${anchor.arrClock}` : anchor.arrDay,
    precise: anchor.precise,
    currentTrip:
      anchor.tripId !== null && anchor.tripId !== targetTripId
        ? { id: anchor.tripId, name: anchor.tripName ?? "" }
        : null,
    defaultAssign: anchor.defaultAssign,
    locked: anchor.locked,
    ...(layover ? { layover } : {}),
  };
}

function toDraftDays(
  window: ScanWindow,
  photos: readonly PhotoPoint[],
  areas: readonly DraftArea[],
  flights: readonly FlightAnchor[],
  kept: readonly AreaPlan[]
): DraftDay[] {
  const stations = areas.flatMap((area) => area.stations);
  return windowDays(window).map((day) => {
    const taken = photos.filter((p) => p.day === day);
    return {
      day,
      photos: taken.length,
      located: taken.filter((p) => p.flags.located).length,
      stationKeys: stations.filter((s) => s.firstDay <= day && day <= s.lastDay).map((s) => s.key),
      flightIds: flights.filter((f) => f.depDay <= day && day <= f.arrDay).map((f) => f.id),
      passedThrough: kept.flatMap((plan) => plan.passedThrough.get(day) ?? []),
    };
  });
}

function stationIndexOf(areas: readonly DraftArea[]): Map<string, StationIndexEntry> {
  const index = new Map<string, StationIndexEntry>();
  for (const area of areas) {
    const offered = [area.home.start.station, area.home.end.station].filter(
      (s): s is DraftStation => s !== undefined
    );
    for (const station of [...area.stations, ...offered]) {
      index.set(station.key, {
        areaKey: area.key,
        firstDay: station.firstDay,
        lastDay: station.lastDay,
      });
    }
  }
  return index;
}

function withPreviews(plan: AreaPlan, previewIdx: ReadonlyMap<string, number[]>): AreaPlan {
  return {
    ...plan,
    stations: plan.stations.map((s) => ({ ...s, previewIdx: previewIdx.get(s.key) ?? [] })),
  };
}

async function draftAlbumOf(
  deps: BuilderDeps,
  input: ScanInput,
  photos: readonly PhotoPoint[]
): Promise<DraftAlbum | null> {
  if (!input.createAlbum || !deps.album) return null;
  let owned: { immichAlbumId: string; assetCount: number } | null = null;
  try {
    owned = await deps.album.findOwned(input.name);
  } catch {
    // The commit looks the album up again by its exact name before writing.
    owned = null;
  }
  const linked = owned ? await deps.album.linkedTripName(owned.immichAlbumId) : null;
  const images = photos.filter((p) => p.type === "IMAGE").length;
  return {
    name: input.name,
    existing: owned ? { ...owned, ...(linked ? { linkedTripName: linked } : {}) } : null,
    assetCount: photos.length,
    images,
    videos: photos.length - images,
    ...deps.album.gate,
  };
}

async function unrecordedFlightsOf(
  deps: BuilderDeps,
  gaps: readonly ImplicitGap[]
): Promise<UnrecordedFlight[]> {
  const found: UnrecordedFlight[] = [];
  for (const gap of gaps) {
    found.push({
      fromDay: gap.fromDay,
      toDay: gap.toDay,
      nearestAirports: {
        from: await deps.nearestAirportIata(gap.from),
        to: await deps.nearestAirportIata(gap.to),
      },
    });
  }
  return found;
}

const homeTitleOf = (home: HomeAtDay | null): string | null =>
  home ? home.name.split(",")[0].trim() || null : null;

/**
 * The first `max` entries of a scan-ordered list (flights by departure, areas
 * and findings by day), and how many were left out. The commit refuses a body
 * over its maxima (`schemas/tripBuilder.ts`), and the review page sends what
 * the draft offered — every flight it default-assigned, every finding it
 * ticked, every area — so the draft must not offer more than the commit
 * accepts (final review, finding B4-1). The cut is reported as a draft warning.
 */
function capFirst<T>(items: T[], max: number): { kept: T[]; dropped: number } {
  return items.length <= max
    ? { kept: items, dropped: 0 }
    : { kept: items.slice(0, max), dropped: items.length - max };
}

// ─── The scan ────────────────────────────────────────────────────────────────

export async function buildDraftWith(
  deps: BuilderDeps,
  userId: string,
  input: ScanInput,
  report: BuildReport
): Promise<StoredDraft> {
  const targetTripId = input.target.kind === "existing" ? input.target.tripId : null;
  // A trip-side Re-sync (owner request 2026-10-12): the scan is scoped to ONE
  // roadtrip of the journey. Its window is the trip's own dates (the caller
  // sends them), everything the window holds is that trip's, and none of the
  // journey-level machinery below may re-mint the row it updates.
  const scope = routeScopeOf(input);
  const scopedRoute =
    scope === null
      ? null
      : (deps.existing?.state.roadtrips.find((route) => route.id === scope.routeId) ?? null);

  report("fetch");
  const collected = await collectWindow(deps, {
    immichUserId: deps.immichUserId,
    startDay: input.startDay,
    endDay: input.endDay,
    targetTripId,
  });
  const { window, anchors } = collected;

  report("clean");
  let photos = collected.clean.photos;
  let excluded = collected.clean.excluded;
  if (input.inspect) ({ photos, excluded } = await cleanPhase(deps, collected));

  report("flights");
  let split: AreaSplit = { areas: [], layovers: [] };
  if (input.inspect) {
    const flown = flightPhase(photos, anchors);
    photos = flown.photos;
    split = flown.split;
    excluded = { ...excluded, inFlight: flown.inFlight };
  }

  report("movement");
  const movement = input.inspect ? movementPhase(photos, split) : emptyMovement(photos);
  report("names");
  // One key set for the whole scan: an area station and a stopover station can never take one key.
  const taken = new Set<string>();
  const built = await namesPhase(deps, collected, movement, taken);
  report("roads");
  const roaded = await roadsPhase(deps, movement, built);
  // Every layover that passed the outing test gets its tour, and a flights-bounded
  // area whose own photos did leaves the areas for a stopover (spec §2 branch (b)).
  // A route-scoped scan offers none: a stopover writes a NEW roadtrip into the
  // journey, which is exactly what a trip-scoped run must never do.
  const stopoverPass: StopoverPass =
    scope !== null
      ? { plans: [], reclassifiedAreaKeys: new Set(), airports: new Map() }
      : await stopoversPhase(deps, collected, split, movement, roaded.plans, taken);
  const stopoverPlans = stopoverPass.plans;
  report("nights");
  // The nights are attributed against the capped plans, so no night can name a
  // station of an area the draft no longer shows (finding B4-1).
  const planCap =
    scope !== null
      ? { kept: roaded.plans, dropped: 0 }
      : capFirst(
          roaded.plans.filter((plan) => !stopoverPass.reclassifiedAreaKeys.has(plan.key)),
          MAX_AREAS
        );
  const night = nightsPhase(collected, movement, planCap.kept);
  // A route-scoped scan's window is the trip's own: every area in it is that
  // trip's, so they become the ONE area the target roadtrip updates, its
  // stations in travel order.
  const keptPlans =
    scope === null || night.kept.length === 0 ? night.kept : [mergeAreaPlans(night.kept)];

  // The stopover stations' thumbnails join the same numbered space as the area stations'.
  const previews = indexPreviews([
    ...keptPlans,
    ...stopoverPlans.map((plan) => ({
      stations: plan.stopover.stations,
      previewPhotoIds: plan.previewPhotoIds,
    })),
  ]);
  const stopovers = stopoverPlans.map((plan) => ({
    ...plan.stopover,
    stations: plan.stopover.stations.map((station) => ({
      ...station,
      previewIdx: previews.previewIdx.get(station.key) ?? [],
    })),
  }));
  const mainCities = new Map(
    keptPlans.map((plan) => [plan.key, mainCityOf(plan.stations, night.nights)] as const)
  );
  // A multi-day same-airport stay is its own album (spec 2026-10-11 pitstops
  // §2): the election reads the night plan, so this runs after the nights. Its
  // city comes from the shared airport — the stopover pass's own catalogue
  // fetch, not a second one — and every name below reads that city (owner
  // ruling 2026-10-12: a pitstop is named after its airport). A route-scoped
  // scan elects none: the trip keeps its own album, never a second one.
  const pitstopPass: PitstopPass =
    scope !== null
      ? { keys: new Set(), cities: new Map() }
      : pitstopAreas({
          areas: keptPlans,
          nights: night.nights,
          anchors: collected.anchors,
          photosById: movement.photosById,
          mainCities,
          airports: stopoverPass.airports,
        });
  // The kind each area opens as. A pitstop opens as Roadtrip with its own album
  // (spec §3): the review seed reads this `defaultAs`, the commit sends its
  // `as`, and the re-sync reconciles the area as a roadtrip on the same value —
  // one default, no layer compensates (final review, finding Q1). An account
  // with roadtrips switched off keeps the ordinary kind even for a pitstop:
  // the commit refuses a roadtrip for it, and the `roadtripsHidden` warning
  // below is what disables the review's switches.
  const kinds = new Map(
    keptPlans.map(
      (plan) =>
        [
          plan.key,
          // A route-scoped area IS the stored roadtrip: its kind is that row's,
          // never a fresh election's ("its kind is not re-minted").
          scope !== null
            ? "roadtrip"
            : pitstopPass.keys.has(plan.key) && deps.roadtripsVisible
              ? "roadtrip"
              : decideAreaKind(plan, deps.roadtripsVisible),
        ] as const
    )
  );
  // The city a trip is named after: the pitstop's own — the shared airport's,
  // the string its album inherits — else the area's photo-majority main city
  // (owner ruling 2026-10-12).
  const cityOf = (key: string): string | null =>
    pitstopPass.cities.get(key) ?? mainCities.get(key) ?? null;
  // ─── One naming pass for every trip of the journey (owner ruling 2026-10-12)
  // A trip is a roadtrip-kind area or a stopover candidate, and both kinds take
  // ONE name rule (`roadtripAreaNames`): "<Journey name> · <City>", the
  // journey's own name when the journey holds exactly one trip, with the
  // clash suffixes (` (d MMM)`, numbering) over the whole set. The count and
  // the clash pool therefore span both kinds — an only-area journey and an
  // only-stopover journey take the journey name the same way — and in travel
  // order, so the earliest same-city trip keeps the plain base. Everything
  // named below (the area rows, the stopover rows, the pitstop albums) reads
  // this one result: no second string is ever minted.
  const nameInputs = [
    ...keptPlans
      .filter((plan) => kinds.get(plan.key) === "roadtrip")
      .map((plan) => ({
        key: plan.key,
        mainCity: cityOf(plan.key),
        startDay: plan.area.startDay,
      })),
    ...stopovers.map((stopover) => ({
      key: stopover.key,
      mainCity: stopover.city,
      startDay: stopover.day,
    })),
  ].sort((a, b) => (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : 0));
  const names = roadtripAreaNames(
    nameInputs,
    input.name,
    new Set(deps.targetTrip?.roadtripNames ?? [])
  );
  const namedStopovers: StoredStopover[] = stopovers.map((stopover) => ({
    ...stopover,
    title: names[stopover.key] ?? input.name,
  }));
  const pitstops = namedPitstops(pitstopPass.keys, names, input.name);
  const areas = keptPlans.map((plan) => {
    const area = toDraftArea(
      withPreviews(plan, previews.previewIdx),
      kinds.get(plan.key) ?? "stops",
      names[plan.key] ?? input.name,
      cityOf(plan.key)
    );
    const pitstop = pitstops.get(plan.key);
    return pitstop === undefined ? area : { ...area, pitstop };
  });

  const listedCap = capFirst(
    anchors.filter((a) => a.listed),
    MAX_COMMIT_FLIGHTS
  );
  const listed = listedCap.kept;
  const stationsOfNote = areas
    .flatMap((a) => a.stations)
    .filter((s) => s.kind !== "home" && s.kind !== "airport");
  const countries = draftCountries({
    stations: stationsOfNote,
    tickedFlights: listed.filter((a) => a.defaultAssign),
    countryAt: deps.countryAt,
    existing: deps.targetTrip?.countries ?? [],
  });
  const labels =
    areas.length > 0
      ? draftLabels(
          // The label reads the area's PHOTO-MAJORITY main city, never the
          // airport city a pitstop's row and album are named from: the owner's
          // ruling names trips and albums, and a label is neither (review of
          // 1cee95ab9, finding 1). `mainCities` is that un-overridden value.
          areas.map((area) => ({ ...area, mainCity: mainCities.get(area.key) ?? null })),
          homeTitleOf(collected.homeAt(window.startDay))
        )
      : { originLabel: null, destinationLabel: null };

  const images = photos.filter((p) => p.type === "IMAGE").length;
  const stats = {
    assets: photos.length,
    images,
    videos: photos.length - images,
    located: photos.filter((p) => p.flags.located).length,
    excluded,
    truncated: collected.truncated,
  };
  const album = await draftAlbumOf(deps, input, photos);
  // A route-scoped run resolves no photo findings: it writes the trip alone.
  const journeyCap =
    scope !== null
      ? { kept: [] as DraftPhotoJourney[], dropped: 0 }
      : capFirst(await deps.pendingPhotoJourneys(window), MAX_PHOTO_JOURNEYS);
  const photoJourneys = journeyCap.kept;
  const first = areas[0]?.stations[0];
  const last = areas[areas.length - 1]?.stations.slice(-1)[0];
  const warnings = assembleWarnings({
    inspect: input.inspect,
    window,
    stats,
    truncatedLists: {
      flights: listedCap.dropped,
      areas: planCap.dropped,
      journeys: journeyCap.dropped,
    },
    unrecordedFlights: await unrecordedFlightsOf(deps, movement.gaps),
    roads: { available: deps.roads.available, canProbe: deps.roads.canProbe },
    hasLegs: keptPlans.some((plan) => plan.legs.length > 0),
    noRoadData: roaded.noRoadData,
    roadtripsHidden:
      !deps.roadtripsVisible &&
      // A route-scoped area IS a roadtrip the account cannot make.
      (scope !== null ||
        keptPlans.some((plan) => decideAreaKind(plan, true) === "roadtrip") ||
        // An offered stopover is a roadtrip the account cannot make too (finding
        // S3-1a): the review disables its switch from this warning, so a scan whose
        // areas are all single-city stops (or absent) must carry it as well.
        stopovers.length > 0 ||
        // A pitstop's album switch is a roadtrip's too: for this account its
        // area kind falls back to the scan's own `stops` (spec 2026-10-11
        // pitstops §3), and the review needs this warning to explain — and
        // disable — the switch it cannot offer.
        pitstops.size > 0),
    overlapping: await deps.overlappingTrips(window, targetTripId),
    flights: listed,
    outsideMovement:
      input.inspect && first && last
        ? movementOutsideDates({
            context: collected.clean.context,
            window,
            firstStation: first,
            lastStation: last,
            homeAt: collected.homeAt,
          })
        : [],
    pendingJourneyIds: photoJourneys.map((j) => j.id),
    albumLinkedElsewhere: album?.existing?.linkedTripName ?? null,
    homeUnconfirmed: areas.some((a) => a.home.unconfirmed),
  });

  const layovers = new Map(
    split.layovers.map(
      (l) => [l.inFlightId, { photoCount: l.photoIds.length, airportIata: l.airportIata }] as const
    )
  );

  const createdAt = deps.nowMs();
  const id = deps.newId();
  const dto: TripBuilderDraft = {
    id,
    expiresAt: new Date(createdAt + DRAFT_IDLE_TTL_MS).toISOString(),
    window: {
      startDay: window.startDay,
      endDay: window.endDay,
      checkedFrom: window.contextFromDay,
      checkedTo: window.contextToDay,
    },
    options: { inspect: input.inspect, createAlbum: input.createAlbum },
    target:
      deps.targetTrip && input.target.kind === "existing"
        ? {
            kind: "existing",
            tripId: deps.targetTrip.id,
            tripName: deps.targetTrip.name,
            ...(scope === null
              ? {}
              : { routeId: scope.routeId, routeName: scopedRoute?.name ?? input.name }),
          }
        : { kind: "new" },
    tripName: input.name,
    countries,
    originLabel: labels.originLabel,
    destinationLabel: labels.destinationLabel,
    stats,
    flights: listed.map((anchor) => toDraftFlight(anchor, targetTripId, layovers.get(anchor.id))),
    days: input.inspect ? toDraftDays(window, photos, areas, listed, keptPlans) : [],
    nights: night.nights,
    areas,
    stopovers: namedStopovers.map((stopover) => ({
      key: stopover.key,
      city: stopover.city,
      title: stopover.title,
      day: stopover.day,
      airportIata: stopover.airportIata,
      photoCount: stopover.photoIds.length,
      outingCount: stopover.stations.reduce((count, station) => count + station.photoCount, 0),
      stations: stopover.stations,
      legs: stopover.legs,
    })),
    photoJourneys,
    album,
    warnings,
  };

  // The pitstop areas' own album records (spec 2026-10-11 pitstops §4): the
  // album takes the area's photos, which no DTO may carry. Computed before the
  // re-sync annotation so the review's "now" count is the same list's length —
  // the movement and at-sea photos, not the stations' sum (final review,
  // finding Q3-1).
  const storedPitstopRecords = storedPitstops(keptPlans, pitstops);
  const applied = await applyExistingTarget(
    deps.existing,
    {
      windowAssetIds: collected.clean.albumAssetIds,
      contextIds: new Set(collected.clean.context.map((p) => p.id)),
      fetchFrom: collected.window.fetchFrom,
      fetchTo: collected.window.fetchTo,
    },
    dto,
    new Map(storedPitstopRecords.map((pitstop) => [pitstop.key, pitstop.assetIds.length] as const)),
    scope
  );

  return {
    id,
    ownerId: userId,
    createdAt,
    touchedAt: createdAt,
    status: "ready",
    input,
    immichUserId: deps.immichUserId,
    connSource: deps.connSource,
    dto: applied.dto,
    existing: applied.existing,
    previewAssetIds: previews.previewAssetIds,
    albumAssetIds: photos.map((p) => p.id),
    flightIds: new Set(listed.map((a) => a.id)),
    stationIndex: stationIndexOf(areas),
    stopovers: namedStopovers,
    // The pitstop areas' own album lists (spec 2026-10-11 pitstops §4): the
    // album takes the area's photos, which no DTO may carry.
    pitstops: storedPitstopRecords,
  };
}

export { resolveBuilderDeps };

/** `jobErrorOf` reads a lowercase message as the job's error code, so each Immich kind has a stable one. */
const IMMICH_JOB_CODES: Record<ImmichErrorKind, string> = {
  unreachable: "immich_unreachable",
  auth: "immich_auth",
  notFound: "immich_not_found",
  protocol: "immich_protocol",
  invalidUrl: "immich_invalid_url",
};

/** The scan job's entry point: resolve the user's connection, then build the draft. */
export async function buildTripDraft(
  userId: string,
  input: ScanInput,
  report: BuildReport
): Promise<StoredDraft> {
  const conn = await getImmichConnection(userId);
  if (!conn) throw new AppError("Immich is not configured", 409);
  try {
    const deps = await resolveBuilderDeps(userId, input, conn);
    return await buildDraftWith(deps, userId, input, report);
  } catch (error) {
    if (error instanceof ImmichError) {
      // The job keeps only the code; this is the one place the failing call, status and scope survive.
      logger.warn({
        message: "trip_builder_immich_failure",
        context: { kind: error.kind, status: error.status, detail: error.message },
      });
      throw new AppError(IMMICH_JOB_CODES[error.kind], 502);
    }
    throw error;
  }
}
