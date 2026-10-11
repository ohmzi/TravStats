/**
 * Phase B for an existing trip (spec 2026-10-09 §K.4): the in-place updates
 * `extendPlanForExisting` split out of the plan, written inside `writeCommit`'s
 * one transaction.
 *
 * A roadtrip goes through `replaceStationsInTx` with the stored ids, so legs —
 * keyed by their endpoint stops — keep their routed geometry; only the legs the
 * write creates come back in `createdLegs`, and phase C routes exactly those. A
 * leg whose mode the user changed is deleted first, so it comes back straight and
 * is routed again, and its new mode goes through `opts.legModes`: the one writer
 * applies a mode only to a leg the write created and fails the transaction for
 * any other, so a stale plan cannot leave a ferry carrying a road's geometry.
 * A roadtrip the review renamed gets its new name on the route row here, in the
 * same transaction, so the name and the stations cannot land apart.
 */
import type { DbTransaction } from "../../db";
import { toDbDate } from "../../shared/time/localDate";
import type { LegPair } from "../../shared/tour/legPlan";
import { replaceStationsInTx } from "../roadtrip/replaceStations";
import { nightsOf, STATION_SELECT } from "../roadtrip/roadtripSummary";
import { stationTimeColumns } from "../timeModel/tripColumns";
import type { ExistingCommitPlan, ExistingRoadtripWrite, RoadtripDiff } from "./existingTypes";
import type { PhaseBRoadtrip } from "./types";

async function writeMatchedRoadtrip(
  tx: DbTransaction,
  userId: string,
  write: ExistingRoadtripWrite
): Promise<PhaseBRoadtrip> {
  let createdLegs: LegPair[] = [];
  if (!write.noop) {
    for (const leg of write.resetLegs) {
      await tx.tripRouteLeg.deleteMany({
        where: { routeId: write.roadtripId, fromStopId: leg.fromStopId, toStopId: leg.toStopId },
      });
    }
    ({ createdLegs } = await replaceStationsInTx(tx, userId, write.roadtripId, write.stations, {
      legModes: write.legModes,
    }));
  }
  // The review showed the stored name, so a different one is the user's rename.
  if (write.rename) {
    await tx.tripRoute.update({
      where: { id: write.roadtripId },
      data: { name: write.name },
    });
  }

  const rows = await tx.tripStop.findMany({
    where: { routeId: write.roadtripId },
    orderBy: { routeOrderIdx: "asc" },
    select: STATION_SELECT,
  });
  const created = new Set(createdLegs.map((pair) => `${pair.fromStopId}>${pair.toStopId}`));
  const ferryLegs = write.legModes.filter(
    (mode, i) => mode === "ferry" && created.has(`${rows[i]?.id}>${rows[i + 1]?.id}`)
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
