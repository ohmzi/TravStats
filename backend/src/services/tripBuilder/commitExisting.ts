/**
 * Phase B for an existing trip (spec 2026-10-09 §K.4): the in-place updates
 * `extendPlanForExisting` split out of the plan, written inside `writeCommit`'s
 * one transaction.
 *
 * A roadtrip goes through `replaceStationsInTx` with the stored ids, so legs —
 * keyed by their endpoint stops — keep their routed geometry; only the legs the
 * write creates come back in `createdLegs`, and phase C routes exactly those. A
 * leg whose mode the user changed is deleted first, so it comes back straight and
 * is routed again. Leg modes are written here, by the final order, because the
 * public write only knows the route's default mode.
 */
import type { DbTransaction } from "../../db";
import { toDbDate } from "../../shared/time/localDate";
import type { LegPair } from "../../shared/tour/legPlan";
import { replaceStationsInTx } from "../roadtrip/replaceStations";
import { nightsOf, STATION_SELECT } from "../roadtrip/roadtripSummary";
import { stationTimeColumns } from "../timeModel/tripColumns";
import type { LegMode } from "../tour/tourDistance";
import type { ExistingCommitPlan, ExistingRoadtripWrite, RoadtripDiff } from "./existingTypes";
import type { PhaseBRoadtrip } from "./types";

async function applyLegModes(
  tx: DbTransaction,
  routeId: string,
  orderedIds: readonly string[],
  modes: ReadonlyArray<LegMode | undefined>
): Promise<void> {
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    if (mode === undefined || orderedIds[i + 1] === undefined) continue;
    await tx.tripRouteLeg.updateMany({
      where: { routeId, fromStopId: orderedIds[i], toStopId: orderedIds[i + 1] },
      data: { mode },
    });
  }
}

async function writeMatchedRoadtrip(
  tx: DbTransaction,
  userId: string,
  write: ExistingRoadtripWrite
): Promise<PhaseBRoadtrip> {
  let createdLegs: LegPair[] = [];
  let orderedIds: string[] = [];
  if (!write.noop) {
    for (const leg of write.resetLegs) {
      await tx.tripRouteLeg.deleteMany({
        where: { routeId: write.roadtripId, fromStopId: leg.fromStopId, toStopId: leg.toStopId },
      });
    }
    ({ createdLegs } = await replaceStationsInTx(tx, userId, write.roadtripId, write.stations));
    const ordered = await tx.tripStop.findMany({
      where: { routeId: write.roadtripId },
      orderBy: { routeOrderIdx: "asc" },
      select: { id: true },
    });
    orderedIds = ordered.map((row) => row.id);
    await applyLegModes(tx, write.roadtripId, orderedIds, write.legModes);
  }

  const rows = await tx.tripStop.findMany({
    where: { routeId: write.roadtripId },
    orderBy: { routeOrderIdx: "asc" },
    select: STATION_SELECT,
  });
  const created = new Set(createdLegs.map((pair) => `${pair.fromStopId}>${pair.toStopId}`));
  const ferryLegs = write.legModes.filter(
    (mode, i) => mode === "ferry" && created.has(`${orderedIds[i]}>${orderedIds[i + 1]}`)
  ).length;
  return {
    id: write.roadtripId,
    name: write.name,
    stations: rows.filter((row) => !row.viaPoint).length,
    nights: nightsOf(rows).nights,
    createdLegs,
    ferryLegs,
    diff: write.diff,
  };
}

async function writeStops(tx: DbTransaction, plan: ExistingCommitPlan): Promise<void> {
  for (const update of plan.stopUpdates) {
    // Coordinates stay as they are; a stop that moved into a roadtrip since the scan fails the commit.
    const stop = await tx.tripStop.findFirstOrThrow({
      where: { id: update.stopId, tripId: plan.tripId, routeId: null },
      select: { lat: true, lon: true },
    });
    const startDate = toDbDate(update.startDay);
    const endDate = toDbDate(update.endDay);
    await tx.tripStop.update({
      where: { id: update.stopId },
      data: {
        title: update.title,
        notes: update.notes,
        startDate,
        endDate,
        ...stationTimeColumns({ startDate, endDate, lat: stop.lat, lon: stop.lon }),
      },
    });
  }
  if (plan.stopRemoveIds.length > 0) {
    await tx.tripStop.deleteMany({
      where: { id: { in: plan.stopRemoveIds }, tripId: plan.tripId, routeId: null },
    });
  }
}

export async function writeExistingTarget(
  tx: DbTransaction,
  userId: string,
  plan: ExistingCommitPlan
): Promise<{ roadtrips: PhaseBRoadtrip[]; stopsDiff: RoadtripDiff }> {
  const roadtrips: PhaseBRoadtrip[] = [];
  for (const write of plan.roadtrips) {
    roadtrips.push(await writeMatchedRoadtrip(tx, userId, write));
  }
  await writeStops(tx, plan);
  return { roadtrips, stopsDiff: plan.stopsDiff };
}
