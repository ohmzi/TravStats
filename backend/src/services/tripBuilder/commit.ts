/**
 * Phase B of a commit (spec 2026-10-09 §A, §D): every TravStats row of the
 * trip in ONE transaction. A throw anywhere rolls the trip, its flights, its
 * stops and its roadtrips back together, so the trip either exists completely
 * or not at all. Phases C and D live further down this file's neighbours and
 * only ever add to what B wrote.
 *
 * Companion rows (`prepareTripCreate`) are find-or-create and may be written
 * before the transaction; a rollback leaves them behind, where they are
 * reused. That is deliberate and harmless.
 */
import { prisma, type DbTransaction } from "../../db";
import { toDbDate } from "../../shared/time/localDate";
import { insertRoadtrip } from "../roadtrip/createRoadtrip";
import { replaceStationsInTx } from "../roadtrip/replaceStations";
import { editedTripDays, stationTimeColumns } from "../timeModel/tripColumns";
import { insertTrip, prepareTripCreate, type PreparedTripCreate } from "../trip/createTrip";
import { COMMIT_TX_TIMEOUT_MS } from "./thresholds";
import type { CommitPlan, PhaseBResult, PhaseBRoadtrip } from "./types";

async function writeTrip(
  tx: DbTransaction,
  plan: CommitPlan,
  prepared: PreparedTripCreate | null
): Promise<string> {
  if (prepared) return (await insertTrip(tx, prepared)).id;
  if (plan.target.kind !== "existing")
    throw new Error("A new-trip commit was prepared without a trip");
  const { tripId, applyWindow, countries } = plan.target;
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

export async function writeCommit(plan: CommitPlan): Promise<PhaseBResult> {
  const prepared =
    plan.target.kind === "new" ? await prepareTripCreate(plan.userId, plan.target.trip) : null;
  return prisma.$transaction(
    async (tx) => {
      const tripId = await writeTrip(tx, plan, prepared);
      const flights = await assignFlights(tx, plan, tripId);
      const stopIds = await writeStops(tx, plan, tripId);
      const roadtrips = await writeRoadtrips(tx, plan, tripId);
      return { tripId, created: plan.target.kind === "new", roadtrips, stopIds, ...flights };
    },
    { timeout: COMMIT_TX_TIMEOUT_MS }
  );
}
