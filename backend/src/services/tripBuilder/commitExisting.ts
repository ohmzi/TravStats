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
 *
 * Every write re-reads what it is about to touch and refuses (`TRIP_CHANGED`)
 * when the trip no longer holds what the plan offered: the plan is a snapshot
 * from the request, and the job reaches this transaction seconds later.
 */
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { toDbDate } from "../../shared/time/localDate";
import type { LegPair } from "../../shared/tour/legPlan";
import { replaceStationsInTx } from "../roadtrip/replaceStations";
import { nightsOf, STATION_SELECT } from "../roadtrip/roadtripSummary";
import { stationTimeColumns } from "../timeModel/tripColumns";
import { sameSet, tripChanged } from "./commitPlanExisting";
import { candidateStopsWhere } from "./existingState";
import type { ExistingCommitPlan, ExistingRoadtripWrite, RoadtripDiff } from "./existingTypes";
import type { PhaseBRoadtrip } from "./types";

async function writeMatchedRoadtrip(
  tx: DbTransaction,
  userId: string,
  write: ExistingRoadtripWrite
): Promise<PhaseBRoadtrip> {
  let createdLegs: LegPair[] = [];
  if (!write.noop) {
    // The plan is a snapshot taken in the request; the job then preflights Immich
    // (seconds) before reaching this transaction, and another tab can add a
    // station meanwhile. `replaceStationsInTx` deletes every route stop the plan's
    // list does not name, so re-read the route here and refuse unless it holds
    // exactly what the draft offered: nothing the plan never saw is deleted by
    // omission, silently or otherwise.
    const routeStops = await tx.tripStop.findMany({
      where: { routeId: write.roadtripId, viaPoint: false },
      select: { id: true },
    });
    if (!sameSet(new Set(routeStops.map((stop) => stop.id)), new Set(write.offeredIds))) {
      throw tripChanged();
    }
    for (const leg of write.resetLegs) {
      await tx.tripRouteLeg.deleteMany({
        where: { routeId: write.roadtripId, fromStopId: leg.fromStopId, toStopId: leg.toStopId },
      });
    }
    try {
      ({ createdLegs } = await replaceStationsInTx(tx, userId, write.roadtripId, write.stations, {
        legModes: write.legModes,
      }));
    } catch (error) {
      // The only mode conflict `replaceStationsInTx` raises is a mode asked of a
      // leg it keeps: the plan expected to create that leg, so the trip moved
      // under it since the scan. That is a stale scan, not a wrong body.
      if (error instanceof AppError && error.code === "LEG_MODE_CONFLICT") throw tripChanged();
      throw error;
    }
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

async function writeStops(
  tx: DbTransaction,
  plan: ExistingCommitPlan,
  addedStopIds: readonly string[]
): Promise<void> {
  // The same re-read as `writeMatchedRoadtrip`'s, for the timeline stops: the
  // plan's set is a snapshot, and an update or removal must never touch a row it
  // did not see — nor die as a Prisma not-found under the generic failure. The
  // stops `writeCommit` added for this commit are part of the trip now, so they
  // are expected as well; any other difference means the trip moved since the
  // scan.
  const candidates = await tx.tripStop.findMany({
    where: candidateStopsWhere(plan.tripId),
    select: { id: true },
  });
  const expected = new Set([...plan.offeredStopIds, ...addedStopIds]);
  if (!sameSet(new Set(candidates.map((stop) => stop.id)), expected)) {
    throw tripChanged();
  }
  for (const update of plan.stopUpdates) {
    // Coordinates stay as they are; the set check above proves the stop is still
    // a candidate, and this read guards the race inside the transaction.
    const stop = await tx.tripStop.findFirst({
      where: { id: update.stopId, tripId: plan.tripId, routeId: null },
      select: { lat: true, lon: true },
    });
    if (!stop) throw tripChanged();
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
  plan: ExistingCommitPlan,
  /** The timeline stops `writeStops` in `writeCommit` created for this commit. */
  addedStopIds: readonly string[]
): Promise<{ roadtrips: PhaseBRoadtrip[]; stopsDiff: RoadtripDiff }> {
  const roadtrips: PhaseBRoadtrip[] = [];
  for (const write of plan.roadtrips) {
    roadtrips.push(await writeMatchedRoadtrip(tx, userId, write));
  }
  await writeStops(tx, plan, addedStopIds);
  return { roadtrips, stopsDiff: plan.stopsDiff };
}
