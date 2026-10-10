/**
 * Holding a re-sync commit to what the draft offered (spec 2026-10-09 §K.4).
 *
 * `prepareCommit` has validated the body as it would for any trip. For an
 * existing target this splits the roadtrips and stops that update stored rows
 * out of the plan and builds exactly what the transaction writes:
 * - matched stations keep their id, coordinates, stay and place; their title and
 *   notes are the body's (the draft showed the stored ones, so an edit is the user's);
 * - kept not-seen stations and route corrections are written back unchanged, in place;
 * - a stored station that is neither listed nor kept is removed, and nothing else is.
 *
 * Before any of that, the trip is read again and must hold exactly the stored
 * ids the draft offered (`TRIP_CHANGED` otherwise): deleting by omission is only
 * safe against a list nobody has added to since.
 */
import { AppError } from "../../middleware/errorHandler";
import type { CommitArea, CommitBody, CommitStation } from "../../schemas/tripBuilder";
import { toDbDate } from "../../shared/time/localDate";
import {
  deriveStationRows,
  rowLegModes,
  type NightPlanStation,
  type StationRow,
} from "../../shared/tour/builderNightPlan";
import type { Station } from "../roadtrip/replaceStations";
import type { LegMode } from "../tour/tourDistance";
import { loadExistingState } from "./existingState";
import type {
  ExistingCommitPlan,
  ExistingRoadtripWrite,
  ExistingStation,
  ExistingStopUpdate,
  ExistingTripState,
  RoadtripDiff,
  StoredExisting,
} from "./existingTypes";
import { groundSpan, interleaveKept, matchStatus, stopAsStation } from "./reconcile";
import type { CommitPlan, DraftArea, StoredDraft, StopPlan } from "./types";

const mismatch = (field: "areas" | "stations"): AppError =>
  new AppError("The commit does not match the draft", 400, "DRAFT_MISMATCH", field);

const tripChanged = (): AppError =>
  new AppError("The trip changed since the scan — scan again", 409, "TRIP_CHANGED");

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

const emptyDiff = (): RoadtripDiff => ({ updated: 0, unchanged: 0, added: 0, removed: 0, kept: 0 });

function nightOf(stored: ExistingStation): Station["night"] {
  switch (stored.night) {
    case "stay":
      return stored.lodgingStayId === null
        ? { kind: "free" }
        : { kind: "stay", lodgingStayId: stored.lodgingStayId };
    case "free":
      return { kind: "free" };
    case "pass":
      return { kind: "pass", placeId: stored.placeId };
    case "via":
      return { kind: "via" };
  }
}

/** A stored station written back exactly as it is. */
function storedToStation(stored: ExistingStation): Station {
  const dated = stored.night !== "via";
  return {
    id: stored.id,
    title: stored.title,
    lat: stored.lat,
    lon: stored.lon,
    startDate: dated && stored.startDate !== null ? toDbDate(stored.startDate) : null,
    endDate: dated && stored.endDate !== null ? toDbDate(stored.endDate) : null,
    notes: stored.notes,
    night: nightOf(stored),
  };
}

function notesOf(commit: CommitStation | undefined, stored: ExistingStation): string | null {
  return commit === undefined || commit.notes === undefined ? stored.notes : commit.notes;
}

/** A derived row, as the roadtrip will hold it. A stored stay keeps its night whatever the photos say. */
function derivedToStation(
  row: StationRow,
  stored: ExistingStation | undefined,
  commit: CommitStation | undefined
): Station {
  const night: Station["night"] =
    stored?.night === "stay" && stored.lodgingStayId !== null
      ? { kind: "stay", lodgingStayId: stored.lodgingStayId }
      : row.slept
        ? { kind: "free" }
        : { kind: "pass", placeId: stored?.placeId ?? null };
  return {
    id: stored?.id,
    title: row.title,
    lat: stored?.lat ?? row.lat,
    lon: stored?.lon ?? row.lon,
    startDate: toDbDate(row.startDate),
    endDate: toDbDate(row.endDate),
    notes: stored ? notesOf(commit, stored) : (row.notes ?? null),
    night,
  };
}

function draftLegMode(area: DraftArea, fromKey: string, toKey: string): string | undefined {
  return area.legs.find((leg) => leg.fromKey === fromKey && leg.toKey === toKey)?.mode;
}

function buildRoadtripWrite(
  area: CommitArea,
  roadtripId: string,
  draft: StoredDraft,
  body: CommitBody,
  state: ExistingTripState,
  offered: StoredExisting
): ExistingRoadtripWrite {
  const offer = offered.roadtrips.get(roadtripId);
  const draftArea = draft.dto.areas.find((a) => a.key === area.key);
  if (!offer || offer.areaKey !== area.key || !draftArea) throw mismatch("areas");
  const current = state.roadtrips.find((r) => r.id === roadtripId);
  if (!current) throw tripChanged();

  // The roadtrip must hold exactly the stations the draft saw.
  const currentIds = new Set(current.stations.filter((s) => s.night !== "via").map((s) => s.id));
  if (!sameSet(currentIds, new Set([...offer.matchedIds, ...offer.notSeenIds])))
    throw tripChanged();
  // Every not-seen station was decided, once.
  if (!sameSet(new Set([...area.keepNotSeen, ...area.removeNotSeen]), offer.notSeenIds)) {
    throw mismatch("stations");
  }
  // A station may only name the stored station the draft matched it to.
  for (const commit of area.stations) {
    if (commit.existingId === undefined) continue;
    const given = draftArea.stations.find((s) => s.key === commit.key)?.existingId;
    if (given !== commit.existingId || !offer.matchedIds.has(commit.existingId))
      throw mismatch("stations");
  }

  const nightStations: NightPlanStation[] = area.stations.map((s) => ({
    key: s.key,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    firstDay: s.firstDay,
    lastDay: s.lastDay,
    notes: s.notes ?? null,
  }));
  const rows = deriveStationRows(nightStations, body.nights);
  const commitByKey = new Map(area.stations.map((s) => [s.key, s] as const));
  const storedById = new Map(current.stations.map((s) => [s.id, s] as const));
  // Only the first row of a station carries its stored id; later runs (`key@2`) are new rows.
  const derivedIds = rows.map((row) => commitByKey.get(row.key)?.existingId);
  const final = interleaveKept(derivedIds, current.stations, new Set(area.keepNotSeen));

  const stations: Station[] = [];
  const finalIds: Array<string | null> = [];
  const diff = emptyDiff();
  for (const entry of final) {
    if (entry.kind === "kept") {
      stations.push(storedToStation(entry.stored));
      finalIds.push(entry.stored.id);
      if (entry.stored.night !== "via") diff.kept += 1;
      continue;
    }
    const row = rows[entry.index];
    const id = derivedIds[entry.index];
    const stored = id === undefined ? undefined : storedById.get(id);
    const commit = commitByKey.get(row.stationKey);
    stations.push(derivedToStation(row, stored, commit));
    finalIds.push(stored?.id ?? null);
    if (stored === undefined) {
      diff.added += 1;
    } else if (
      matchStatus(row, stored) === "changed" ||
      stored.title !== row.title ||
      stored.notes !== notesOf(commit, stored)
    ) {
      diff.updated += 1;
    } else {
      diff.unchanged += 1;
    }
  }
  diff.removed = [...currentIds].filter((id) => !finalIds.includes(id)).length;

  // `prepareCommit` cannot ask this of an area that updates a stored roadtrip, because its kept
  // stations are not rows there. The final list is the one place that sees them all.
  if (stations.filter((s) => s.night.kind !== "via").length < 2) {
    throw new AppError(
      "A roadtrip needs at least two valid stations",
      400,
      "STATIONS_INVALID",
      `areas.${body.areas.indexOf(area)}`
    );
  }

  // Leg modes: positional on the final list. A stored leg keeps its mode unless the user changed
  // it from what the draft showed (then it is reset, so it comes back straight and is routed again);
  // a new leg takes the mode of the derived pair it joins, if it joins one.
  const rowModes = rowLegModes(
    area.stations.map((s) => s.key),
    area.legModes,
    rows
  );
  const legModes: Array<LegMode | undefined> = [];
  const resetLegs: ExistingRoadtripWrite["resetLegs"] = [];
  for (let i = 0; i + 1 < final.length; i++) {
    const a = final[i];
    const b = final[i + 1];
    const adjacent = a.kind === "derived" && b.kind === "derived" && b.index === a.index + 1;
    const desired = adjacent ? rowModes[a.index] : undefined;
    const fromId = finalIds[i];
    const toId = finalIds[i + 1];
    const pair = fromId !== null && toId !== null ? { fromStopId: fromId, toStopId: toId } : null;
    const storedLeg =
      pair === null
        ? undefined
        : current.legs.find(
            (l) => l.fromStopId === pair.fromStopId && l.toStopId === pair.toStopId
          );
    if (pair === null || storedLeg === undefined) {
      legModes.push(desired);
      continue;
    }
    const shown =
      a.kind === "derived" && b.kind === "derived"
        ? draftLegMode(draftArea, rows[a.index].stationKey, rows[b.index].stationKey)
        : undefined;
    if (desired !== undefined && desired !== (shown ?? storedLeg.mode)) {
      legModes.push(desired);
      resetLegs.push(pair);
    } else {
      legModes.push(undefined);
    }
  }

  const orderUnchanged =
    finalIds.length === current.stations.length &&
    finalIds.every((id, i) => id === current.stations[i].id);
  const noop =
    diff.updated === 0 &&
    diff.added === 0 &&
    diff.removed === 0 &&
    orderUnchanged &&
    resetLegs.length === 0 &&
    legModes.every((m) => m === undefined);

  return {
    areaKey: area.key,
    roadtripId,
    name: current.name,
    stations,
    legModes,
    resetLegs,
    noop,
    diff,
  };
}

function buildStopWrites(
  draft: StoredDraft,
  body: CommitBody,
  state: ExistingTripState,
  offered: StoredExisting,
  plan: CommitPlan
): {
  updates: ExistingStopUpdate[];
  removeIds: string[];
  diff: RoadtripDiff;
  remaining: StopPlan[];
} {
  const candidates = new Set(state.stops.map((s) => s.id));
  if (!sameSet(candidates, new Set([...offered.stops.matchedIds, ...offered.stops.notSeenIds]))) {
    throw tripChanged();
  }
  if (!sameSet(new Set([...body.stops.keep, ...body.stops.remove]), offered.stops.notSeenIds)) {
    throw mismatch("stations");
  }

  const updates: ExistingStopUpdate[] = [];
  const diff = emptyDiff();
  let remaining = [...plan.stops];
  for (const area of body.areas) {
    if (area.as !== "stops") continue;
    const ground = area.stations.filter((s) => s.kind !== "home" && s.kind !== "airport");
    const anchor = ground[0];
    if (area.stations.some((s) => s !== anchor && s.existingId !== undefined))
      throw mismatch("stations");
    if (anchor === undefined || anchor.existingId === undefined) continue;
    const given = draft.dto.areas
      .find((a) => a.key === area.key)
      ?.stations.find((s) => s.key === anchor.key)?.existingId;
    if (given !== anchor.existingId || !offered.stops.matchedIds.has(anchor.existingId)) {
      throw mismatch("stations");
    }
    const stop = state.stops.find((s) => s.id === anchor.existingId);
    if (!stop) throw tripChanged();
    // The review showed this area as the one stop `derivedStopOf` makes of it, so that is the stop
    // written: the anchor's title over the first to the last ground day. The area's other title
    // runs are part of it, not stops of their own.
    const { startDate: startDay, endDate: endDay } = groundSpan(ground);
    remaining = remaining.filter((p) => p.areaKey !== area.key);
    const notes = anchor.notes === undefined ? stop.notes : anchor.notes;
    const changed =
      matchStatus({ startDate: startDay, endDate: endDay, slept: false }, stopAsStation(stop)) ===
        "changed" ||
      stop.title !== anchor.title ||
      stop.notes !== notes;
    if (changed) {
      updates.push({
        areaKey: area.key,
        stopId: stop.id,
        title: anchor.title,
        notes,
        startDay,
        endDay,
      });
      diff.updated += 1;
    } else {
      diff.unchanged += 1;
    }
  }
  diff.added = remaining.length;
  diff.removed = body.stops.remove.length;
  diff.kept = body.stops.keep.length;
  return { updates, removeIds: [...body.stops.remove], diff, remaining };
}

/**
 * The commit plan for an existing trip: the base plan with the in-place updates
 * split out into `existing`. A `new` target comes back untouched.
 */
export async function extendPlanForExisting(
  userId: string,
  draft: StoredDraft,
  body: CommitBody,
  plan: CommitPlan
): Promise<CommitPlan> {
  if (body.target.kind !== "existing" || plan.target.kind !== "existing") return plan;
  const offered = draft.existing;
  if (!offered || offered.tripId !== body.target.tripId) throw mismatch("areas");
  const state = await loadExistingState(userId, offered.tripId);

  // An area may only name the roadtrip the draft matched it to — skipped areas included.
  for (const area of body.areas) {
    const draftArea = draft.dto.areas.find((a) => a.key === area.key);
    if (draftArea?.roadtripId !== area.roadtripId) throw mismatch("areas");
  }

  const writes: ExistingRoadtripWrite[] = [];
  const handled = new Set<string>();
  for (const area of body.areas) {
    if (area.as !== "roadtrip" || area.roadtripId === undefined) continue;
    writes.push(buildRoadtripWrite(area, area.roadtripId, draft, body, state, offered));
    handled.add(area.key);
  }
  const stops = buildStopWrites(draft, body, state, offered, plan);

  const existing: ExistingCommitPlan = {
    tripId: offered.tripId,
    roadtrips: writes,
    stopUpdates: stops.updates,
    stopRemoveIds: stops.removeIds,
    stopsDiff: stops.diff,
    album: { removeOutside: body.album.removeOutside === true },
  };
  return {
    ...plan,
    roadtrips: plan.roadtrips.filter((r) => !handled.has(r.areaKey)),
    stops: stops.remaining,
    existing,
  };
}
