/**
 * Phase B of a commit (spec 2026-10-09 §A, §D): every TravStats row of the
 * trip in ONE transaction. A throw anywhere rolls the trip, its flights, its
 * stops and its roadtrips back together, so the trip either exists completely
 * or not at all. Phase C (routing, statuses, findings) and phase D (the
 * album) follow it further down this file, in `runCommitJob`, and only ever
 * add to what B wrote.
 *
 * Companion rows (`prepareTripCreate`) are find-or-create and may be written
 * before the transaction; a rollback leaves them behind, where they are
 * reused. That is deliberate and harmless.
 */
import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { now } from "../../shared/time/clock";
import { toDbDate } from "../../shared/time/localDate";
import logger from "../../utils/logger";
import { insertRoadtrip } from "../roadtrip/createRoadtrip";
import { replaceStationsInTx } from "../roadtrip/replaceStations";
import { editedTripDays, stationTimeColumns } from "../timeModel/tripColumns";
import { autoRouteNewLegs } from "../tour/routing/autoRouteLegs";
import { resolveRouteProvider } from "../tour/routing/resolveProvider";
import { insertTrip, prepareTripCreate, type PreparedTripCreate } from "../trip/createTrip";
import { recomputeTripStatus } from "../tripStatusService";
import { resyncTripAlbum } from "./albumResync";
import {
  albumDescription,
  blockedOutcome,
  preflightAlbum,
  writeTripAlbum,
  type AlbumPreflight,
} from "./albumWrite";
import { writePitstopAlbum, type PitstopAlbumOutcome } from "./stopoverAlbum";
import { journeyBounds } from "./builderQueries";
import { writeExistingTarget } from "./commitExisting";
import { abortCommit, finishCommit } from "./draftStore";
import type { RoadtripDiff } from "./existingTypes";
import { COMMIT_TX_TIMEOUT_MS, ROUTE_BUDGET_MS, ROUTE_CHUNK_LEGS } from "./thresholds";
import type {
  CommitJobResult,
  CommitPlan,
  CommitResult,
  Day,
  PhaseBResult,
  PhaseBRoadtrip,
  StoredDraft,
} from "./types";

async function writeTrip(
  tx: DbTransaction,
  plan: CommitPlan,
  prepared: PreparedTripCreate | null
): Promise<string> {
  if (prepared) return (await insertTrip(tx, prepared)).id;
  if (plan.target.kind !== "existing")
    throw new Error("A new-trip commit was prepared without a trip");
  const { tripId, applyWindow, countries } = plan.target;
  // A route-scoped commit writes the roadtrip alone: this phase leaves the
  // journey row untouched, its `updatedAt` included (owner request 2026-10-12).
  // Phase C's recompute of the journey's derived status is the one place a
  // scoped run reflects the trip back onto the journey.
  //
  // The trip's OWN days, though, follow the window the review chose (owner
  // 2026-10-13, the second ask): the journey flow's `applyWindow` rule one
  // level down, its start to the window's start and its end to the window's
  // end. Written only when the dates moved (as there), so a re-sync of a
  // trip nobody re-dated stores exactly what it stored before.
  if (plan.target.routeId !== undefined) {
    if (applyWindow) {
      await tx.tripRoute.update({
        where: { id: plan.target.routeId },
        data: {
          startDay: toDbDate(plan.window.startDay),
          endDay: toDbDate(plan.window.endDay),
        },
      });
    }
    return tripId;
  }
  const stored = await tx.trip.findFirstOrThrow({
    where: { id: tripId, userId: plan.userId },
    select: { startDate: true, endDate: true, startDay: true, endDay: true },
  });
  // The same rule PATCH /trips/:id follows: a day sent back unchanged keeps
  // its stored anchor and zone, a changed one becomes a typed day.
  const days = applyWindow
    ? editedTripDays(
        { startDate: toDbDate(plan.window.startDay), endDate: toDbDate(plan.window.endDay) },
        stored
      )
    : {};
  await tx.trip.update({ where: { id: tripId }, data: { ...days, countries } });
  return tripId;
}

async function assignFlights(
  tx: DbTransaction,
  plan: CommitPlan,
  tripId: string
): Promise<Pick<PhaseBResult, "flightsAssigned" | "flightsMovedFrom">> {
  if (plan.flightIds.length === 0) return { flightsAssigned: 0, flightsMovedFrom: [] };
  const rows = await tx.flight.findMany({
    where: { id: { in: plan.flightIds }, userId: plan.userId },
    select: { id: true, tripId: true },
  });
  const toMove = rows.filter((row) => row.tripId !== tripId);
  if (toMove.length > 0) {
    await tx.flight.updateMany({
      where: { id: { in: toMove.map((row) => row.id) }, userId: plan.userId },
      data: { tripId },
    });
  }
  const previous = [...new Set(toMove.flatMap((row) => (row.tripId === null ? [] : [row.tripId])))];
  const trips =
    previous.length === 0
      ? []
      : await tx.trip.findMany({
          where: { id: { in: previous }, userId: plan.userId },
          select: { id: true, name: true },
        });
  return {
    flightsAssigned: toMove.length,
    flightsMovedFrom: trips.map((trip) => ({ tripId: trip.id, name: trip.name })),
  };
}

async function writeStops(tx: DbTransaction, plan: CommitPlan, tripId: string): Promise<string[]> {
  if (plan.stops.length === 0) return [];
  const last = await tx.tripStop.aggregate({ where: { tripId }, _max: { orderIdx: true } });
  let orderIdx = (last._max.orderIdx ?? -1) + 1;
  const ids: string[] = [];
  for (const stop of plan.stops) {
    const startDate = toDbDate(stop.startDay);
    const endDate = toDbDate(stop.endDay);
    const row = await tx.tripStop.create({
      data: {
        tripId,
        title: stop.title,
        lat: stop.lat,
        lon: stop.lon,
        startDate,
        endDate,
        ...stationTimeColumns({ startDate, endDate, lat: stop.lat, lon: stop.lon }),
        notes: stop.notes,
        orderIdx: orderIdx++,
        domain: null,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

async function writeRoadtrips(
  tx: DbTransaction,
  plan: CommitPlan,
  tripId: string
): Promise<PhaseBRoadtrip[]> {
  const written: PhaseBRoadtrip[] = [];
  for (const roadtrip of plan.roadtrips) {
    const route = await insertRoadtrip(tx, plan.userId, {
      tripId,
      name: roadtrip.name,
      mode: "road",
      vehicle: roadtrip.vehicle,
    });
    const { createdLegs } = await replaceStationsInTx(
      tx,
      plan.userId,
      route.id,
      roadtrip.stations,
      {
        legModes: roadtrip.legModes,
      }
    );
    const ferryLegs = await tx.tripRouteLeg.count({ where: { routeId: route.id, mode: "ferry" } });
    written.push({
      id: route.id,
      name: roadtrip.name,
      stations: roadtrip.stations.length,
      nights: roadtrip.nights,
      createdLegs,
      ferryLegs,
    });
  }
  return written;
}

/**
 * The stopover roadtrips (spec 2026-10-11 §5.3): per toggled stopover
 * `insertRoadtrip` with the stopover's one name, `mode: "road"`, `vehicle: "car"`,
 * then `replaceStationsInTx` with its station rows. No night is ever assigned
 * (§2.2), so no row the write makes is slept — the night machinery never sees a
 * stopover. A stopover a re-sync already matched (`roadtripId`) is never
 * rebuilt (§6, add-only): nothing is written for it.
 *
 * The legs go back with the summary for phase C to route, like the areas'.
 */
async function writeStopoverRoadtrips(
  tx: DbTransaction,
  plan: CommitPlan,
  tripId: string
): Promise<PhaseBRoadtrip[]> {
  const written: PhaseBRoadtrip[] = [];
  for (const stopover of plan.stopovers ?? []) {
    if (stopover.roadtripId !== undefined) continue;
    const route = await insertRoadtrip(tx, plan.userId, {
      tripId,
      name: stopover.name,
      mode: "road",
      vehicle: "car",
    });
    const { createdLegs } = await replaceStationsInTx(
      tx,
      plan.userId,
      route.id,
      stopover.stations,
      { legModes: stopover.legModes }
    );
    const ferryLegs = await tx.tripRouteLeg.count({ where: { routeId: route.id, mode: "ferry" } });
    written.push({
      id: route.id,
      name: stopover.name,
      stations: stopover.stations.length,
      nights: 0,
      createdLegs,
      ferryLegs,
    });
  }
  return written;
}

/**
 * A matched stopover's own day: the draft's stopover carries it, and the key
 * always names one (`extendPlanForExisting` matches by draft key); the window's
 * first day is only a fallback for hand-built plans, and the day is inert for a
 * city album — it passes an explicit description.
 */
function matchedStopoverDay(draft: StoredDraft, key: string, plan: CommitPlan): Day {
  return draft.stopovers.find((stopover) => stopover.key === key)?.day ?? plan.window.startDay;
}

/**
 * A pitstop area's own day (spec 2026-10-11 pitstops §4): the stored record
 * carries it, and the plan's area key always names one; like a stopover's, the
 * day is inert — the write passes an explicit description.
 */
function storedPitstopDay(draft: StoredDraft, areaKey: string, plan: CommitPlan): Day {
  return draft.pitstops.find((pitstop) => pitstop.key === areaKey)?.day ?? plan.window.startDay;
}

/** One city album phase D writes: what its line says and what the write needs. */
interface PitstopAlbumWanted {
  key: string;
  name: string;
  day: Day;
  assetIds: readonly string[];
}

/** The stopovers' own albums of the plan (spec 2026-10-11 §5.4, §6): a toggled one, or a matched one whose roadtrip is never rebuilt. */
function stopoversWanted(plan: CommitPlan, draft: StoredDraft): PitstopAlbumWanted[] {
  return [
    ...(plan.stopovers ?? []).flatMap((stopover) =>
      stopover.album === null ? [] : [{ key: stopover.key, ...stopover.album, day: stopover.day }]
    ),
    ...(plan.existing?.stopovers ?? []).flatMap((stopover) =>
      stopover.album === null
        ? []
        : [
            {
              key: stopover.key,
              ...stopover.album,
              day: matchedStopoverDay(draft, stopover.key, plan),
            },
          ]
    ),
  ];
}

/** The pitstop areas' own albums of the plan (spec 2026-10-11 pitstops §4, §5): an unmatched area, or a matched one whose album rides its existing write. */
function pitstopsWanted(plan: CommitPlan, draft: StoredDraft): PitstopAlbumWanted[] {
  const ofWrite = (areaKey: string, album: { name: string; assetIds: string[] }) => ({
    key: areaKey,
    ...album,
    day: storedPitstopDay(draft, areaKey, plan),
  });
  return [
    ...plan.roadtrips.flatMap((roadtrip) =>
      roadtrip.album === undefined ? [] : [ofWrite(roadtrip.areaKey, roadtrip.album)]
    ),
    ...(plan.existing?.roadtrips ?? []).flatMap((roadtrip) =>
      roadtrip.album === undefined ? [] : [ofWrite(roadtrip.areaKey, roadtrip.album)]
    ),
  ];
}

/**
 * Phase D for the trip's own city albums (spec 2026-10-11 §5.4, pitstops §4):
 * one line per toggled album, add-only, each able to fail or block on its own.
 * The trip is already saved, so a blocked preflight here becomes the album's
 * own line and never the trip's failure. `held` is the preflight the trip album
 * took, if it took one; without it the city albums share one fresh preflight.
 */
async function writePitstopAlbums(
  plan: CommitPlan,
  draft: StoredDraft,
  tripId: string,
  held: Extract<AlbumPreflight, { ok: true }> | null
): Promise<{ stopovers: PitstopAlbumOutcome[]; pitstops: PitstopAlbumOutcome[] }> {
  const stopovers = stopoversWanted(plan, draft);
  const pitstops = pitstopsWanted(plan, draft);
  const all = [...stopovers, ...pitstops];
  if (all.length === 0) return { stopovers: [], pitstops: [] };
  let open = held;
  if (open === null) {
    const preflight = await preflightAlbum(plan.userId, draft.immichUserId);
    if (!preflight.ok) {
      const album = blockedOutcome(preflight.blocked);
      const line = (wanted: PitstopAlbumWanted): PitstopAlbumOutcome => ({
        key: wanted.key,
        name: wanted.name,
        album,
      });
      return { stopovers: stopovers.map(line), pitstops: pitstops.map(line) };
    }
    open = preflight;
  }
  const tripName = plan.target.kind === "existing" ? plan.target.tripName : plan.target.trip.name;
  const lines: PitstopAlbumOutcome[] = [];
  for (const wanted of all) {
    lines.push({
      key: wanted.key,
      name: wanted.name,
      album: await writePitstopAlbum({
        userId: plan.userId,
        tripId,
        tripName,
        name: wanted.name,
        day: wanted.day,
        assetIds: wanted.assetIds,
        client: open.client,
        immichUserId: open.immichUserId,
      }),
    });
  }
  return { stopovers: lines.slice(0, stopovers.length), pitstops: lines.slice(stopovers.length) };
}

export async function writeCommit(plan: CommitPlan): Promise<PhaseBResult> {
  const prepared =
    plan.target.kind === "new" ? await prepareTripCreate(plan.userId, plan.target.trip) : null;
  return prisma.$transaction(
    async (tx) => {
      const tripId = await writeTrip(tx, plan, prepared);
      const flights = await assignFlights(tx, plan, tripId);
      const stopIds = await writeStops(tx, plan, tripId);
      const roadtrips = await writeRoadtrips(tx, plan, tripId);
      roadtrips.push(...(await writeStopoverRoadtrips(tx, plan, tripId)));
      let stopsDiff: RoadtripDiff | undefined;
      if (plan.existing) {
        const updated = await writeExistingTarget(tx, plan.userId, plan.existing, stopIds);
        roadtrips.push(...updated.roadtrips);
        stopsDiff = updated.stopsDiff;
      }
      return {
        tripId,
        created: plan.target.kind === "new",
        roadtrips,
        stopIds,
        stopsDiff,
        ...flights,
      };
    },
    { timeout: COMMIT_TX_TIMEOUT_MS }
  );
}

/** How many legs phase B created, and how many of those are ferries. */
function legTotals(written: PhaseBResult): { created: number; ferry: number } {
  return {
    created: written.roadtrips.reduce((n, r) => n + r.createdLegs.length, 0),
    ferry: written.roadtrips.reduce((n, r) => n + r.ferryLegs, 0),
  };
}

/**
 * Phase C, routing: the legs phase B created are routed along the road in
 * chunks of 25 until the two-minute budget is spent. A leg stored as `ferry`
 * is never sent to a road router (`autoRouteNewLegs` skips it by its stored
 * mode), so a crossing keeps its straight chord. Whatever is not routed stays
 * a straight line, and the counts say how many.
 */
export async function routeCommittedLegs(
  userId: string,
  written: PhaseBResult
): Promise<CommitResult["routing"]> {
  const { created, ferry } = legTotals(written);
  const provider = await resolveRouteProvider(userId);
  if (provider === null || created === 0) {
    return {
      routed: 0,
      straight: Math.max(0, created - ferry),
      ferry,
      providerAvailable: provider !== null,
    };
  }
  const deadline = now().getTime() + ROUTE_BUDGET_MS;
  let routed = 0;
  for (const roadtrip of written.roadtrips) {
    for (let i = 0; i < roadtrip.createdLegs.length; i += ROUTE_CHUNK_LEGS) {
      if (now().getTime() >= deadline) break;
      routed += await autoRouteNewLegs(
        userId,
        roadtrip.id,
        roadtrip.createdLegs.slice(i, i + ROUTE_CHUNK_LEGS)
      );
    }
  }
  return {
    routed,
    straight: Math.max(0, created - ferry - routed),
    ferry,
    providerAvailable: true,
  };
}

/**
 * The ticked photo-journey findings the new trip explains become `accepted`.
 * The window is applied again here, in the WHERE clause: a finding the draft
 * never offered, or another user's, is never touched.
 */
export async function resolvePhotoJourneys(
  userId: string,
  tripId: string,
  ids: readonly string[],
  window: CommitPlan["window"]
): Promise<number> {
  if (ids.length === 0) return 0;
  const { from, to } = journeyBounds(window);
  const { count } = await prisma.photoJourney.updateMany({
    where: {
      id: { in: [...ids] },
      userId,
      status: "pending",
      startDate: { gte: from },
      endDate: { lt: to },
    },
    data: { status: "accepted", createdTripId: tripId, resolvedAt: now() },
  });
  return count;
}

/**
 * What the draft remembers right after phase B. Later phases only add to it.
 * Read afterwards for the trip id alone: that is what answers a second commit.
 *
 * Its routing is the answer if routing never gets to run: every road leg is
 * still a straight line, no router was reached, and the page says so.
 */
function resultAfterB(plan: CommitPlan, written: PhaseBResult): CommitResult {
  const { created, ferry } = legTotals(written);
  return {
    tripId: written.tripId,
    created: written.created,
    roadtrips: written.roadtrips.map(({ id, name, stations, nights, diff }) => ({
      id,
      name,
      stations,
      nights,
      ...(diff ? { diff } : {}),
    })),
    stopIds: written.stopIds,
    ...(written.stopsDiff ? { stops: written.stopsDiff } : {}),
    flightsAssigned: written.flightsAssigned,
    flightsMovedFrom: written.flightsMovedFrom,
    routing: { routed: 0, straight: Math.max(0, created - ferry), ferry, providerAvailable: false },
    photoJourneysResolved: 0,
    unknownNights: plan.unknownNights,
    album: { status: "skipped", skipReason: "notRequested" },
  };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Phase C. Each step is wrapped on its own: one failing must not skip the others. */
async function afterCommit(
  plan: CommitPlan,
  written: PhaseBResult,
  result: CommitResult
): Promise<void> {
  try {
    result.routing = await routeCommittedLegs(plan.userId, written);
  } catch (error) {
    logger.warn(
      { operation: "trip_builder.route_failed", error: errorText(error) },
      "Routing the new legs failed"
    );
  }
  const tripIds = new Set([written.tripId, ...written.flightsMovedFrom.map((trip) => trip.tripId)]);
  for (const tripId of tripIds) {
    try {
      await recomputeTripStatus(tripId);
    } catch (error) {
      logger.warn(
        { operation: "trip_builder.restatus_failed", tripId, error: errorText(error) },
        "Recomputing a trip status failed"
      );
    }
  }
  try {
    result.photoJourneysResolved = await resolvePhotoJourneys(
      plan.userId,
      written.tripId,
      plan.photoJourneyIds,
      plan.window
    );
  } catch (error) {
    logger.warn(
      { operation: "trip_builder.findings_failed", error: errorText(error) },
      "Resolving photo findings failed"
    );
  }
}

/**
 * The commit job. P preflights Immich without writing; B writes every
 * TravStats row in one transaction; `finishCommit` marks the draft committed
 * the moment B is safe, so nothing later can make the trip be created twice;
 * C and D (routing, statuses, findings, the album) only add to the result.
 *
 * `blocked` is a SUCCESS that wrote nothing: the page offers to fix the key or
 * to save the trip without its album. A failure inside B that named a code
 * that implies a fix (`TRIP_CHANGED`: scan again) is re-thrown as it is; every
 * other one is the generic `COMMIT_FAILED`.
 */
export async function runCommitJob(draft: StoredDraft, plan: CommitPlan): Promise<CommitJobResult> {
  let album: Extract<AlbumPreflight, { ok: true }> | null = null;
  if (plan.album.create) {
    const preflight = await preflightAlbum(plan.userId, draft.immichUserId);
    if (!preflight.ok) {
      abortCommit(draft.id);
      return preflight.blocked;
    }
    album = preflight;
  }

  let written: PhaseBResult;
  try {
    written = await writeCommit(plan);
  } catch (error) {
    abortCommit(draft.id);
    logger.error(
      { operation: "trip_builder.commit_failed", draftId: draft.id, error: errorText(error) },
      "Commit rolled back"
    );
    // A throw from the write's own re-checks names its cause; TRIP_CHANGED in
    // particular tells the page a new scan is the way forward, so it must not be
    // flattened into the generic failure.
    if (error instanceof AppError && error.code === "TRIP_CHANGED") throw error;
    throw new AppError("Commit failed", 500, "COMMIT_FAILED");
  }

  const result = resultAfterB(plan, written);
  finishCommit(draft.id, result);

  await afterCommit(plan, written, result);

  if (album) {
    try {
      const albumInput = {
        userId: plan.userId,
        tripId: written.tripId,
        albumName: plan.album.name,
        description: albumDescription(plan.window.startDay, plan.window.endDay),
        assetIds: draft.albumAssetIds,
        client: album.client,
        immichUserId: album.immichUserId,
      };
      result.album =
        plan.target.kind === "existing" && draft.existing
          ? await resyncTripAlbum({
              ...albumInput,
              tripName: plan.target.tripName,
              window: plan.window,
              // A route-scoped run updates the trip's own album, matched by its
              // stored name, and only ever ADDS the window's photos: the album
              // never loses members here (owner request 2026-10-12).
              ...(plan.target.routeId === undefined ? {} : { named: true }),
              outsideIds: draft.existing.album?.outsideIds ?? [],
              scanAlbumId: draft.existing.album?.immichAlbumId ?? null,
              removeOutside:
                plan.target.routeId === undefined && plan.existing?.album.removeOutside === true,
            })
          : await writeTripAlbum(albumInput);
    } catch (error) {
      logger.error(
        { operation: "trip_builder.album_threw", error: errorText(error) },
        "The album step threw"
      );
      result.album = { status: "failed", error: { kind: "internal" } };
    }
  }
  // Phase D, the city albums (spec 2026-10-11 §5.4, pitstops §4): the stopovers'
  // own albums and the pitstop areas' — a line each, add-only, and a preflight
  // that never blocks the trip — the trip is saved.
  const pitstopAlbums = await writePitstopAlbums(plan, draft, written.tripId, album);
  if (pitstopAlbums.stopovers.length > 0) result.stopoverAlbums = pitstopAlbums.stopovers;
  if (pitstopAlbums.pitstops.length > 0) result.pitstopAlbums = pitstopAlbums.pitstops;
  return { status: "committed", ...result };
}
