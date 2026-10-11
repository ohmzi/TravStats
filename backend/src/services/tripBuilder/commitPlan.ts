/**
 * The synchronous half of a commit (spec 2026-10-09 §A): everything that can
 * be refused from the database and the draft alone, before any job starts.
 *
 * A validation error thrown inside a background job reaches the page as a
 * generic failure, so every refusal a user can fix is answered here as a 400 or
 * 409 with its own code. No Immich call is made: the handler must answer well
 * inside the browser's ten seconds.
 *
 * The draft is the allow-list. Flights, photo-journey findings, areas,
 * stopovers and stations are accepted only if the scan offered them; the
 * nights are re-derived and re-validated with the same mirrored code the
 * review page used.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { resolveTrip } from "../../routes/trips/resolveTrip";
import { stationsSchema } from "../../schemas/roadtrip";
import type { CommitArea, CommitBody } from "../../schemas/tripBuilder";
import { daysBetween } from "../../shared/time/localDate";
import {
  NIGHT_UNKNOWN,
  deriveStationRows,
  nightsOf,
  rowLegModes,
  validateNightPlan,
  type NightPlanArea,
  type NightPlanStation,
} from "../../shared/tour/builderNightPlan";
import { loadVisibleDomains } from "../domainVisibility";
import { extendPlanForExisting } from "./commitPlanExisting";
import type {
  CommitPlan,
  CommitTargetPlan,
  DraftArea,
  RoadtripPlan,
  StopoverPlan,
  StopPlan,
  StoredDraft,
  StoredStopover,
} from "./types";

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const toDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const mismatch = (field: string): AppError =>
  new AppError("The commit does not match the draft", 400, "DRAFT_MISMATCH", field);
const windowChanged = (): AppError =>
  new AppError("The trip's dates changed since the scan; scan again", 409, "WINDOW_CHANGED");

function assertWindow(draft: StoredDraft, body: CommitBody): void {
  const { window } = draft.dto;
  if (body.window.startDay !== window.startDay || body.window.endDay !== window.endDay) {
    throw windowChanged();
  }
  if (body.target.kind === "new") {
    const { startDate, endDate } = body.target.trip;
    if (startDate && dayOf(startDate) !== window.startDay) throw windowChanged();
    if (endDate && dayOf(endDate) !== window.endDay) throw windowChanged();
  }
}

function assertTarget(draft: StoredDraft, body: CommitBody): void {
  const scanned = draft.input.target;
  const same =
    scanned.kind === body.target.kind &&
    (scanned.kind === "new" ||
      (body.target.kind === "existing" && body.target.tripId === scanned.tripId));
  if (!same) throw mismatch("target");
}

function assertOffered(draft: StoredDraft, body: CommitBody): void {
  if (body.flightIds.some((id) => !draft.flightIds.has(id))) throw mismatch("flightIds");
  const journeys = new Set(draft.dto.photoJourneys.map((j) => j.id));
  if (body.photoJourneyIds.some((id) => !journeys.has(id))) throw mismatch("photoJourneyIds");
  if (body.album.create && draft.dto.album === null) throw mismatch("album");
  const stopovers = new Set(draft.stopovers.map((stopover) => stopover.key));
  if (body.stopovers.some((stopover) => !stopovers.has(stopover.key))) {
    throw mismatch("stopovers");
  }
}

/** The days a station may fall on: its area's span, widened by any station the scan offered there. */
function spanOf(draft: StoredDraft, area: DraftArea): { from: string; to: string } {
  let from = area.startDay;
  let to = area.endDay;
  for (const entry of draft.stationIndex.values()) {
    if (entry.areaKey !== area.key) continue;
    if (entry.firstDay < from) from = entry.firstDay;
    if (entry.lastDay > to) to = entry.lastDay;
  }
  return { from, to };
}

function assertAreas(draft: StoredDraft, areas: readonly CommitArea[]): Map<string, DraftArea> {
  const known = new Map(draft.dto.areas.map((a) => [a.key, a] as const));
  for (const area of areas) {
    const offered = known.get(area.key);
    if (!offered) throw mismatch("areas");
    // The album is the scan's offer to make (spec 2026-10-11 pitstops §4): as
    // with the stopover switches, a body can only write what the draft named.
    if (area.album && offered.pitstop === undefined) throw mismatch("areas");
    const span = spanOf(draft, offered);
    for (const station of area.stations) {
      const entry = draft.stationIndex.get(station.key);
      if (!entry || entry.areaKey !== area.key) throw mismatch("stations");
      if (station.firstDay < span.from || station.lastDay > span.to) throw mismatch("stations");
    }
  }
  return known;
}

async function assertFlightsOwned(userId: string, flightIds: readonly string[]): Promise<void> {
  if (flightIds.length === 0) return;
  const owned = await prisma.flight.count({ where: { id: { in: [...flightIds] }, userId } });
  if (owned !== flightIds.length) throw mismatch("flightIds");
}

async function resolveTarget(
  userId: string,
  draft: StoredDraft,
  body: CommitBody
): Promise<CommitTargetPlan> {
  const { window } = draft.dto;
  if (body.target.kind === "new") {
    const trip = body.target.trip;
    return {
      kind: "new",
      trip: {
        ...trip,
        startDate: trip.startDate ?? toDate(window.startDay),
        endDate: trip.endDate ?? toDate(window.endDay),
        countries: trip.countries ?? draft.dto.countries,
        originLabel: trip.originLabel ?? draft.dto.originLabel ?? undefined,
        destinationLabel: trip.destinationLabel ?? draft.dto.destinationLabel ?? undefined,
      },
    };
  }
  const { id, name } = await resolveTrip(userId, body.target.tripId);
  const stored = await prisma.trip.findUniqueOrThrow({
    where: { id },
    select: { countries: true },
  });
  const wanted = body.target.countries ?? draft.dto.countries;
  return {
    kind: "existing",
    tripId: id,
    tripName: name,
    applyWindow: body.target.applyWindow,
    countries: [...new Set([...stored.countries, ...wanted])].sort(),
  };
}

function assertNightPlan(
  draft: StoredDraft,
  body: CommitBody,
  known: ReadonlyMap<string, DraftArea>
): void {
  const included = body.areas.filter((a) => a.as !== "skip");
  const stations: NightPlanStation[] = included.flatMap((a) =>
    a.stations.map((s) => ({
      key: s.key,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      firstDay: s.firstDay,
      lastDay: s.lastDay,
      notes: s.notes ?? null,
    }))
  );
  const areas: NightPlanArea[] = included.map((a) => {
    const offered = known.get(a.key) as DraftArea;
    return {
      key: a.key,
      startDay: offered.startDay,
      endDay: offered.endDay,
      stationKeys: a.stations.map((s) => s.key),
    };
  });
  const [first] = validateNightPlan(stations, body.nights, areas, body.window);
  if (!first) return;
  throw new AppError("The nights do not form a plan", 400, "NIGHT_PLAN_INVALID", undefined, {
    reason: first.code,
    ...(first.stationKey !== null && { stationKey: first.stationKey }),
    ...(first.day !== null && { day: first.day }),
  });
}

function roadtripPlan(area: CommitArea, index: number, nights: CommitBody["nights"]): RoadtripPlan {
  const rows = deriveStationRows(
    area.stations.map((s) => ({
      key: s.key,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      firstDay: s.firstDay,
      lastDay: s.lastDay,
      notes: s.notes ?? null,
    })),
    nights
  );
  const parsed = stationsSchema.safeParse({
    stations: rows.map((row) => ({
      title: row.title,
      lat: row.lat,
      lon: row.lon,
      startDate: row.startDate,
      endDate: row.endDate,
      notes: row.notes ?? null,
      night: row.slept ? { kind: "free" } : { kind: "pass" },
    })),
  });
  // An area that updates a stored roadtrip keeps its other stations, which are not rows here.
  if (!parsed.success || (parsed.data.stations.length < 2 && area.roadtripId === undefined)) {
    throw new AppError(
      "A roadtrip needs at least two valid stations",
      400,
      "STATIONS_INVALID",
      `areas.${index}`
    );
  }
  return {
    areaKey: area.key,
    name: area.name,
    vehicle: area.vehicle,
    stations: parsed.data.stations,
    legModes: rowLegModes(
      area.stations.map((s) => s.key),
      area.legModes,
      rows
    ),
    nights: rows
      .filter((r) => r.slept)
      .reduce((n, r) => n + daysBetween(r.startDate, r.endDate), 0),
  };
}

/**
 * The pitstop area's own album as the plan carries it (spec 2026-10-11
 * pitstops §4): the name the review showed, and the area's own photo set,
 * which only the stored draft holds — no request ever names an asset. An
 * `album` tick the scan offered no pitstop for is refused like every other
 * unoffered thing; `assertAreas` runs the same rule, and this is its twin for
 * the plan itself.
 */
function pitstopAlbum(
  draft: StoredDraft,
  offered: DraftArea,
  area: CommitArea
): RoadtripPlan["album"] {
  if (!area.album) return undefined;
  const record = draft.pitstops.find((pitstop) => pitstop.key === offered.key);
  if (offered.pitstop === undefined || record === undefined) throw mismatch("areas");
  return { name: offered.pitstop.albumName, assetIds: [...record.assetIds] };
}

/** Timeline stops of a `stops` area: home and airport stations dropped, a run of one title made one stop. */
function stopPlans(area: CommitArea): StopPlan[] {
  const stops: StopPlan[] = [];
  for (const s of area.stations.filter((st) => st.kind !== "home" && st.kind !== "airport")) {
    const last = stops[stops.length - 1];
    if (last && last.title === s.title) {
      last.endDay = s.lastDay;
      continue;
    }
    stops.push({
      areaKey: area.key,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      startDay: s.firstDay,
      endDay: s.lastDay,
      notes: s.notes ?? null,
    });
  }
  return stops;
}

/**
 * One toggled stopover as the write phase gets it (spec 2026-10-11 §5.2): the
 * derived rows go through `deriveStationRows` with NO nights — a stopover is
 * hours, its stations never enter the night plan — and then the same
 * `stationsSchema` the areas use. The album carries the stored draft's own
 * photo ids; the request never names an asset.
 */
function stopoverPlan(
  stopover: StoredStopover,
  toggled: CommitBody["stopovers"][number],
  index: number
): StopoverPlan {
  const rows = deriveStationRows(
    stopover.stations.map((s) => ({
      key: s.key,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      firstDay: s.firstDay,
      lastDay: s.lastDay,
      notes: s.notes ?? null,
    })),
    {}
  );
  const parsed = stationsSchema.safeParse({
    stations: rows.map((row) => ({
      title: row.title,
      lat: row.lat,
      lon: row.lon,
      startDate: row.startDate,
      endDate: row.endDate,
      notes: row.notes ?? null,
      // No nights: every row is a pass row, whatever the photos showed.
      night: { kind: "pass" },
    })),
  });
  if (!parsed.success || parsed.data.stations.length < 2) {
    throw new AppError(
      "A roadtrip needs at least two valid stations",
      400,
      "STATIONS_INVALID",
      `stopovers.${index}`
    );
  }
  return {
    key: stopover.key,
    name: stopover.title,
    day: stopover.day,
    stations: parsed.data.stations,
    // The scan's legs, in station-row order — the same conversion the areas use:
    // `rowLegModes` over the stopover's station keys and its legs' modes.
    legModes: rowLegModes(
      stopover.stations.map((s) => s.key),
      stopover.legs.map((leg) => leg.mode),
      rows
    ),
    album: toggled.album ? { name: stopover.title, assetIds: [...stopover.photoIds] } : null,
  };
}

/**
 * The toggled stopovers, in the body's order. `roadtrip: false` entries write
 * nothing: the review sends only toggled-on candidates (spec §5.1), and a
 * skipped switch is not a write.
 */
function stopoverPlans(draft: StoredDraft, body: CommitBody): StopoverPlan[] {
  const offered = new Map(draft.stopovers.map((stopover) => [stopover.key, stopover] as const));
  const plans: StopoverPlan[] = [];
  body.stopovers.forEach((toggled, index) => {
    if (!toggled.roadtrip) return;
    const stopover = offered.get(toggled.key);
    // `assertOffered` has refused a key the draft did not name; this is its plan-side twin.
    if (stopover === undefined) throw mismatch("stopovers");
    plans.push(stopoverPlan(stopover, toggled, index));
  });
  return plans;
}

export async function prepareCommit(
  userId: string,
  draft: StoredDraft,
  body: CommitBody
): Promise<CommitPlan> {
  assertWindow(draft, body);
  assertTarget(draft, body);
  assertOffered(draft, body);
  const known = assertAreas(draft, body.areas);
  const flightIds = [...new Set(body.flightIds)];
  await assertFlightsOwned(userId, flightIds);
  const target = await resolveTarget(userId, draft, body);

  // A stopover the scan already matched writes no roadtrip at all: the re-sync
  // moves it to `plan.existing.stopovers`, album-only (spec 2026-10-11 §6), so
  // only the stopovers that would really write one are held to the roadtrip
  // domain. An area is different — `as: "roadtrip"` writes one even when it
  // updates a stored roadtrip — and stays gated (finding S3-1).
  const matchedStopovers = new Set(
    [...(draft.existing?.stopovers ?? [])].map(([, offer]) => offer.key)
  );
  if (
    body.areas.some((a) => a.as === "roadtrip") ||
    body.stopovers.some((s) => s.roadtrip && !matchedStopovers.has(s.key))
  ) {
    if (!(await loadVisibleDomains(userId)).includes("roadtrip")) {
      throw new AppError("Roadtrips are hidden for this account", 409, "ROADTRIPS_HIDDEN");
    }
  }
  assertNightPlan(draft, body, known);

  const roadtrips = body.areas
    .map((area, index) => ({ area, index }))
    .filter(({ area }) => area.as === "roadtrip")
    .map(({ area, index }) => {
      const offered = known.get(area.key) as DraftArea;
      const album = pitstopAlbum(draft, offered, area);
      const planned = roadtripPlan(area, index, body.nights);
      return album === undefined ? planned : { ...planned, album };
    });
  const stops = body.areas.filter((a) => a.as === "stops").flatMap(stopPlans);
  const stopovers = stopoverPlans(draft, body);
  const unknownNights = nightsOf(body.window).filter((night) => {
    const answer = body.nights[night];
    return answer === undefined || answer === NIGHT_UNKNOWN;
  }).length;

  const plan: CommitPlan = {
    draftId: draft.id,
    userId,
    window: { ...body.window },
    target,
    flightIds,
    stops,
    roadtrips,
    stopovers,
    photoJourneyIds: [...new Set(body.photoJourneyIds)],
    album: { create: body.album.create, name: body.album.name },
    unknownNights,
  };
  return extendPlanForExisting(userId, draft, body, plan);
}
