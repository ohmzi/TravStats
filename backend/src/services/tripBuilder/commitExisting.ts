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
 * same transaction, so the name and the stations cannot land apart — and only
 * while the route still carries the name the plan read, so a rename made since
 * the scan refuses like any other moved write.
 *
 * Every write re-reads what it is about to touch and refuses (`TRIP_CHANGED`)
 * when the trip no longer holds what the plan offered: the plan is a snapshot
 * from the request, and the job reaches this transaction seconds later. What the
 * transaction itself writes is expected, not a change — its new stops, and the
 * timeline stops a roadtrip write releases back. A matched stopover is written
 * nowhere here: the guard only proves its roadtrip still holds what the scan
 * offered, before the album step adds members (add-only v1, spec 2026-10-11 §6).
 */
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { toDbDate } from "../../shared/time/localDate";
import type { LegPair } from "../../shared/tour/legPlan";
import { replaceStationsInTx } from "../roadtrip/replaceStations";
import { nightsOf, STATION_SELECT } from "../roadtrip/roadtripSummary";
import {
  propagateDeletes,
  propagateWrite,
  shareSnapshot,
  shareSnapshots,
} from "../sharing/propagate";
import { stationTimeColumns } from "../timeModel/tripColumns";
import { sameSet, tripChanged } from "./commitPlanExisting";
import { candidateStopsWhere } from "./existingState";
import type { ExistingCommitPlan, ExistingRoadtripWrite, RoadtripDiff } from "./existingTypes";
import type { PhaseBRoadtrip } from "./types";

async function writeMatchedRoadtrip(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  write: ExistingRoadtripWrite
): Promise<{ roadtrip: PhaseBRoadtrip; releasedStopIds: string[] }> {
  let createdLegs: LegPair[] = [];
  let releasedStopIds: string[] = [];
  // The plan is a snapshot taken in the request; the job then preflights Immich
  // (seconds) before reaching this transaction, and another tab can add a
  // station meanwhile. `replaceStationsInTx` deletes every route stop the plan's
  // list does not name, so re-read the route here and refuse unless it holds
  // exactly what the draft offered: nothing the plan never saw is deleted by
  // omission, silently or otherwise. The re-read also runs for an album-only
  // write (final review, finding Q3-5): such a write replaces nothing, but phase
  // D still adds to — or creates — the pitstop album after this transaction, on
  // a roadtrip the review never showed, so the same guard applies;
  // `guardMatchedStopovers` re-checks its roadtrip unconditionally for the same
  // reason.
  const guardsRoute = !write.noop || write.album !== undefined;
  const routeStops = guardsRoute
    ? await tx.tripStop.findMany({
        where: { routeId: write.roadtripId, viaPoint: false },
        select: { id: true },
      })
    : [];
  if (
    guardsRoute &&
    !sameSet(new Set(routeStops.map((stop) => stop.id)), new Set(write.offeredIds))
  ) {
    throw tripChanged();
  }
  if (!write.noop) {
    const written = new Set(write.stations.flatMap((s) => (s.id === undefined ? [] : [s.id])));
    const droppedIds = routeStops.filter((stop) => !written.has(stop.id)).map((stop) => stop.id);
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
    // A dropped station that was a timeline stop before it joined the roadtrip
    // keeps its `tripId`, and `replaceStationsInTx` hands it back to the timeline
    // rather than deleting it. Of those, whichever now reads as a candidate stop
    // is in the set `writeStops` re-checks last — this commit released it, so the
    // set must expect it instead of refusing the commit's own doing; the shared
    // WHERE is the one the candidates read uses, so the two cannot drift.
    releasedStopIds =
      droppedIds.length === 0
        ? []
        : (
            await tx.tripStop.findMany({
              where: { id: { in: droppedIds }, ...candidateStopsWhere(tripId) },
              select: { id: true },
            })
          ).map((stop) => stop.id);
  }
  // The review showed the stored name, so a different one is the user's rename.
  // The rename is re-checked like every other write — and it is the only one left
  // when `noop` skipped the guard above: the conditional update matches the route
  // only while it still carries the name the plan read, so a rename or a deletion
  // since the scan is TRIP_CHANGED, never a clobbered newer name or a Prisma
  // not-found the job would flatten into the generic failure.
  if (write.rename) {
    const renamed = await tx.tripRoute.updateMany({
      where: { id: write.roadtripId, name: write.expectedName },
      data: { name: write.name },
    });
    if (renamed.count === 0) throw tripChanged();
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
    roadtrip: {
      id: write.roadtripId,
      name: write.name,
      stations: rows.filter((row) => !row.viaPoint).length,
      nights: nightsOf(rows).nights,
      createdLegs,
      ferryLegs,
      diff: write.diff,
    },
    releasedStopIds,
  };
}

async function writeStops(
  tx: DbTransaction,
  userId: string,
  plan: ExistingCommitPlan,
  addedStopIds: readonly string[],
  releasedStopIds: readonly string[]
): Promise<void> {
  // The same re-read as `writeMatchedRoadtrip`'s, for the timeline stops: the
  // plan's set is a snapshot, and an update or removal must never touch a row it
  // did not see — nor die as a Prisma not-found under the generic failure. The
  // stops `writeCommit` added for this commit are part of the trip now, and so
  // are the stops the roadtrip writes released back to the timeline: both are
  // expected. Any other difference means the trip moved since the scan.
  const candidates = await tx.tripStop.findMany({
    where: candidateStopsWhere(plan.tripId),
    select: { id: true },
  });
  const expected = new Set([...plan.offeredStopIds, ...addedStopIds, ...releasedStopIds]);
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
    // A timeline stop is shareable: its edit reaches every member's copy.
    const before = await shareSnapshot(tx, "stop", update.stopId);
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
    await propagateWrite(tx, userId, "stop", update.stopId, before);
  }
  if (plan.stopRemoveIds.length > 0) {
    // A removal is a delete notice to the members holding a copy, which stays.
    const gone = await shareSnapshots(tx, "stop", plan.stopRemoveIds);
    await tx.tripStop.deleteMany({
      where: { id: { in: plan.stopRemoveIds }, tripId: plan.tripId, routeId: null },
    });
    await propagateDeletes(tx, userId, [...gone.values()]);
  }
}

/**
 * A matched stopover is add-only (spec 2026-10-11 §6): no station is rebuilt,
 * renamed or deleted, and phase D only adds the city album's new members. This
 * re-read is the same offered-ids guard `writeMatchedRoadtrip` runs before
 * replacing stations: the plan is a snapshot from the request, so a route that
 * was renamed, had a station added or was deleted since the scan must refuse
 * (TRIP_CHANGED) instead of committing an "already synced" the review never
 * showed. It writes nothing itself.
 */
async function guardMatchedStopovers(tx: DbTransaction, plan: ExistingCommitPlan): Promise<void> {
  for (const stopover of plan.stopovers) {
    const route = await tx.tripRoute.findFirst({
      where: { id: stopover.roadtripId, tripId: plan.tripId },
      select: { name: true },
    });
    const stops = await tx.tripStop.findMany({
      where: { routeId: stopover.roadtripId, viaPoint: false },
      select: { id: true },
    });
    if (
      route?.name !== stopover.name ||
      !sameSet(new Set(stops.map((stop) => stop.id)), new Set(stopover.offeredIds))
    ) {
      throw tripChanged();
    }
  }
}

export async function writeExistingTarget(
  tx: DbTransaction,
  userId: string,
  plan: ExistingCommitPlan,
  /** The timeline stops `writeStops` in `writeCommit` created for this commit. */
  addedStopIds: readonly string[]
): Promise<{ roadtrips: PhaseBRoadtrip[]; stopsDiff?: RoadtripDiff }> {
  await guardMatchedStopovers(tx, plan);
  const roadtrips: PhaseBRoadtrip[] = [];
  const releasedStopIds: string[] = [];
  for (const write of plan.roadtrips) {
    const written = await writeMatchedRoadtrip(tx, userId, plan.tripId, write);
    roadtrips.push(written.roadtrip);
    releasedStopIds.push(...written.releasedStopIds);
  }
  // A route-scoped re-sync has no stop writes at all: the journey's timeline
  // stops are not its business, so neither the candidates guard nor an update
  // runs — and the success panel shows no stops line.
  if (plan.scoped === true) return { roadtrips };
  await writeStops(tx, userId, plan, addedStopIds, releasedStopIds);
  return { roadtrips, stopsDiff: plan.stopsDiff };
}
