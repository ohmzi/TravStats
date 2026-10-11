/**
 * Holding a re-sync commit to what the draft offered (spec 2026-10-09 §K.4).
 *
 * `prepareCommit` has validated the body as it would for any trip. For an
 * existing target this splits the roadtrips and stops that update stored rows
 * out of the plan and builds exactly what the transaction writes:
 * - matched stations keep their id, coordinates, stay and place; their title and
 *   notes are the body's (the draft showed the stored ones, so an edit is the user's);
 * - the roadtrip's name is the body's too: the draft showed the stored one, so an
 *   edit is the user's rename, and an untouched name writes nothing;
 * - kept not-seen stations and route corrections are written back unchanged, in place;
 * - a stored station that is neither listed nor kept is removed, and nothing else is;
 * - a `stops` area writes the one stop the review showed (`derivedStopOf`): the
 *   anchor's title and place over the first to the last ground day, updating the
 *   stored stop when the anchor carries its id and created as a new stop when it
 *   does not. A matched anchor the body no longer names is refused, not removed:
 *   the review offers no delete for it (its row's Remove is off).
 *
 * Before any of that, the trip is read again and must hold exactly the stored
 * ids and name the draft offered (`TRIP_CHANGED` otherwise): deleting by
 * omission is only safe against a list nobody has added to since.
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
  ExistingStopoverWrite,
  ExistingStopUpdate,
  ExistingTripState,
  RoadtripDiff,
  StoredExisting,
} from "./existingTypes";
import { groundSpan, interleaveKept, matchStatus, stopAsStation } from "./reconcile";
import type { CommitPlan, DraftArea, StoredDraft, StopPlan } from "./types";

const mismatch = (field: "areas" | "stations"): AppError =>
  new AppError("The commit does not match the draft", 400, "DRAFT_MISMATCH", field);

/**
 * The re-sync's signature refusal: the draft knows a list that is no longer the
 * trip's, so only a new scan can mend it. Shared with `commitExisting`, which
 * re-checks the same sets inside the write's transaction.
 */
export const tripChanged = (): AppError =>
  new AppError("The trip changed since the scan — scan again", 409, "TRIP_CHANGED");

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
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

/**
 * The mode the draft's own leg carried: for a pair both of whose stations are
 * stored, `annotateDraftForExisting` put the STORED leg's mode there, so this is
 * what the review showed and what an untouched commit must keep.
 */
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
  // The review showed the stored name; a rename since makes that field stale.
  if (offer.name !== current.name) throw tripChanged();

  // The roadtrip must hold exactly the stations the draft saw. The same set
  // travels with the write, so the transaction re-checks it before deleting.
  const offeredIds = new Set([...offer.matchedIds, ...offer.notSeenIds]);
  const currentIds = new Set(current.stations.filter((s) => s.night !== "via").map((s) => s.id));
  if (!sameSet(currentIds, offeredIds)) throw tripChanged();
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
  // it from what the draft showed — and for a pair both of whose stations are stored the draft
  // showed the STORED leg's mode (annotateDraftForExisting), so an untouched leg is left in place
  // and a changed one is reset, to come back straight and be routed again; a new leg takes the
  // mode of the derived pair it joins, if it joins one.
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
  // The station list and its legs are what is stored: no station write, and the name is
  // checked on its own below.
  const noop =
    diff.updated === 0 &&
    diff.added === 0 &&
    diff.removed === 0 &&
    orderUnchanged &&
    resetLegs.length === 0 &&
    legModes.every((m) => m === undefined);

  // The reviewed name is the body's, as every other field of the area is. A rename is
  // an update of its own — the panel and the review must see it — and it is written
  // even though the stations are a no-op.
  const rename = area.name !== current.name;
  if (rename) diff.updated += 1;

  return {
    areaKey: area.key,
    roadtripId,
    name: area.name,
    // The equality check above proves the offer is also what the route holds now.
    expectedName: offer.name,
    rename,
    stations,
    offeredIds: [...offeredIds],
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
    const draftArea = draft.dto.areas.find((a) => a.key === area.key);
    if (anchor === undefined || anchor.existingId === undefined) {
      // The scan matched the area's anchor to a stored stop: the draft's first
      // ground station carries that id. The review draws the area as that one
      // stop and its Remove is off for the anchor, so a body that no longer
      // carries the id is the delete the review does not offer. Refuse it — the
      // alternative, treating it as a removal, would let any body that merely
      // lost the field delete the owner's stop; the old silent skip left the
      // stop while adding the area's rows as a second stop for the same place.
      const offeredAnchor = draftArea?.stations.find(
        (s) => s.kind !== "home" && s.kind !== "airport"
      );
      if (
        offeredAnchor?.existingId !== undefined &&
        offered.stops.matchedIds.has(offeredAnchor.existingId)
      ) {
        throw mismatch("stations");
      }
      // An unmatched area the scan drew as stops is shown with the same one-stop
      // view (`derivedStopOf`): the anchor's title and place over the first to
      // the last ground day. That is the stop written, as a new one — left as
      // `stopPlans` the commit would write one stop per run of equal titles,
      // timeline rows the review never showed and reported as intended output.
      if (anchor !== undefined && draftArea?.defaultAs === "stops") {
        const { startDate: startDay, endDate: endDay } = groundSpan(ground);
        const derived: StopPlan = {
          areaKey: area.key,
          title: anchor.title,
          lat: anchor.lat,
          lon: anchor.lon,
          startDay,
          endDay,
          notes: anchor.notes ?? null,
        };
        const first = remaining.findIndex((p) => p.areaKey === area.key);
        remaining = remaining.filter((p) => p.areaKey !== area.key);
        if (first === -1) remaining.push(derived);
        else remaining.splice(first, 0, derived);
      }
      continue;
    }
    const given = draftArea?.stations.find((s) => s.key === anchor.key)?.existingId;
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
  // A matched pitstop area writes no roadtrip of the new-write path and no
  // station — its §K diff governs the roadtrip — but its own album still takes
  // the area's pictures (spec 2026-10-11 pitstops §5): `prepareCommit` built it
  // onto the plan entry, which leaves `plan.roadtrips` here, so the album moves
  // onto the write it becomes.
  const albumOf = new Map(
    plan.roadtrips
      .filter((roadtrip) => roadtrip.album !== undefined)
      .map((roadtrip) => [roadtrip.areaKey, roadtrip.album] as const)
  );
  for (const area of body.areas) {
    if (area.as !== "roadtrip" || area.roadtripId === undefined) continue;
    const write = buildRoadtripWrite(area, area.roadtripId, draft, body, state, offered);
    const album = albumOf.get(area.key);
    writes.push(album === undefined ? write : { ...write, album });
    handled.add(area.key);
  }
  const stops = buildStopWrites(draft, body, state, offered, plan);

  // Matched stopovers (spec 2026-10-11 §6): add-only v1, so each leaves the
  // new-write path for an album-only entry. The stored roadtrip must still hold
  // exactly what the scan offered — the same guard `buildRoadtripWrite` runs for
  // an area — because the review's "already synced" was computed from it.
  const stopoverOfferByKey = new Map(
    [...offered.stopovers].map(([roadtripId, offer]) => [offer.key, { roadtripId, offer }] as const)
  );
  const matchedStopovers: ExistingStopoverWrite[] = [];
  const matchedStopoverKeys = new Set<string>();
  for (const stopover of plan.stopovers ?? []) {
    const matched = stopoverOfferByKey.get(stopover.key);
    if (matched === undefined) continue;
    const current = state.roadtrips.find((r) => r.id === matched.roadtripId);
    if (current === undefined || current.name !== matched.offer.name) throw tripChanged();
    const currentIds = new Set(
      current.stations.filter((station) => station.night !== "via").map((station) => station.id)
    );
    if (!sameSet(currentIds, new Set(matched.offer.stationIds))) throw tripChanged();
    matchedStopoverKeys.add(stopover.key);
    matchedStopovers.push({
      key: stopover.key,
      roadtripId: matched.roadtripId,
      name: matched.offer.name,
      // The station write phase B would do for a new stopover is exactly what a
      // matched one must never get; only the album remains. Nothing else of the
      // entry is carried: no stations, no night plan, no rename.
      offeredIds: [...matched.offer.stationIds],
      album:
        stopover.album === null
          ? null
          : { name: stopover.album.name, assetIds: stopover.album.assetIds },
    });
  }

  const existing: ExistingCommitPlan = {
    tripId: offered.tripId,
    offeredStopIds: [...offered.stops.matchedIds, ...offered.stops.notSeenIds],
    roadtrips: writes,
    stopovers: matchedStopovers,
    stopUpdates: stops.updates,
    stopRemoveIds: stops.removeIds,
    stopsDiff: stops.diff,
    album: { removeOutside: body.album.removeOutside === true },
  };
  return {
    ...plan,
    roadtrips: plan.roadtrips.filter((r) => !handled.has(r.areaKey)),
    stopovers: (plan.stopovers ?? []).filter((stopover) => !matchedStopoverKeys.has(stopover.key)),
    stops: stops.remaining,
    existing,
  };
}
