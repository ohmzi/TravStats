/**
 * Which place each night of the trip was spent in (spec 2026-10-09 §C.8).
 *
 * `attributeNights` answers every night N of the window, S … E−1, with the
 * FIRST rule that matches, so the order of the `??` chain in that function is
 * the specification. A night runs from the evening of day N to 03:59 the
 * morning after (the 04:00 `nightDay` boundary of §C.1). "P" is the night's
 * last photo, a movement photo or an at-sea one.
 *
 * The station a photo belongs to comes from its area's `photoStation`, which
 * already maps transit noise to a kept station and a home-only area to `home`.
 * A day trip never holds a night: the station it left from does.
 *
 * Pure. The photos, areas, flights and home come in already built.
 */
import { localDay, toLocal } from "../../shared/time/instant";
import { isValidZone } from "../../shared/time/zonedParts";
import {
  addDays,
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_UNKNOWN,
  nightsOf,
} from "../../shared/tour/builderNightPlan";
import { distanceKm } from "../photoJourneys/cluster";
import { isSleptNight, type StoredNight } from "./existingTypes";
import {
  HOME_RADIUS_KM,
  NIGHT_BOUNDARY_H,
  NIGHT_DRIVE_FIRST_BEFORE,
  NIGHT_DRIVE_LAST_AFTER,
  NIGHT_DRIVE_MIN_KM,
} from "./thresholds";
import type {
  AreaPlan,
  Day,
  DayPull,
  FlightAnchor,
  NightAttribution,
  NightEntry,
  NightInputs,
  NightReason,
  PhotoPoint,
  PlanStation,
} from "./types";

/** Everything the rules read, built once per call. */
interface NightContext {
  readonly input: NightInputs;
  /** The movement photos of every area, by time. */
  readonly movement: readonly PhotoPoint[];
  /** The last photo of each night, movement or at sea. */
  readonly lastByNight: ReadonlyMap<Day, PhotoPoint>;
  /** The first movement photo of each night. */
  readonly firstMovementByNight: ReadonlyMap<Day, PhotoPoint>;
  readonly areaOfPhoto: ReadonlyMap<string, AreaPlan>;
  readonly stations: ReadonlyMap<string, { station: PlanStation; area: AreaPlan }>;
  /** Where a rule pulled a station's first day back to the night it was reached. */
  readonly pulls: DayPull[];
}

type NightRule = (ctx: NightContext, night: Day) => NightEntry | null;

function byTime(a: PhotoPoint, b: PhotoPoint): number {
  return a.tMs - b.tMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function buildContext(input: NightInputs): NightContext {
  const areaOfPhoto = new Map<string, AreaPlan>();
  const stations = new Map<string, { station: PlanStation; area: AreaPlan }>();
  const movement: PhotoPoint[] = [];
  const everything: PhotoPoint[] = [];
  for (const area of input.areas) {
    for (const station of area.stations) stations.set(station.key, { station, area });
    const take = (ids: readonly string[], isMovement: boolean): void => {
      for (const id of ids) {
        const photo = input.photosById.get(id);
        if (photo === undefined) continue;
        areaOfPhoto.set(id, area);
        everything.push(photo);
        if (isMovement) movement.push(photo);
      }
    };
    take(area.area.photoIds, true);
    take(area.area.seaPhotoIds, false);
  }
  movement.sort(byTime);
  everything.sort(byTime);

  const lastByNight = new Map<Day, PhotoPoint>();
  for (const photo of everything) lastByNight.set(photo.nightDay, photo);
  const firstMovementByNight = new Map<Day, PhotoPoint>();
  for (const photo of movement) {
    if (!firstMovementByNight.has(photo.nightDay)) firstMovementByNight.set(photo.nightDay, photo);
  }
  return { input, movement, lastByNight, firstMovementByNight, areaOfPhoto, stations, pulls: [] };
}

function entry(
  assign: string,
  reason: NightReason,
  suggestedStationKeys: string[] = []
): NightEntry {
  return { assign, reason, suggestedStationKeys };
}

/** The station that holds a night spent at `key`: a day trip is held by the station it left. */
function holdingKey(ctx: NightContext, key: string): string {
  const station = ctx.stations.get(key)?.station;
  const origin = station?.kind === "dayTrip" ? station.excursionOf : undefined;
  return origin !== undefined && ctx.stations.has(origin) ? origin : key;
}

/** Where a night ending in `photo` is spent: a station key, `home`, or null if no station owns it. */
function placeOf(ctx: NightContext, photo: PhotoPoint): string | null {
  const key = ctx.areaOfPhoto.get(photo.id)?.photoStation.get(photo.id);
  if (key === undefined) return null;
  return key === NIGHT_HOME ? NIGHT_HOME : holdingKey(ctx, key);
}

/** Whether `station` may be given `night`: the same two bounds `validateNightPlan` enforces. */
function fitsNight(station: PlanStation, area: AreaPlan, night: Day): boolean {
  return (
    night >= addDays(station.firstDay, -1) &&
    night <= addDays(station.lastDay, 1) &&
    night >= addDays(area.area.startDay, -1) &&
    night <= area.area.endDay
  );
}

/**
 * The stations on both sides of a night nobody photographed: the same one when
 * it spans the gap, else the station before and the station after, keeping
 * only those the night may be given to. A suggestion, never a default.
 */
function gapNeighbours(ctx: NightContext, night: Day): string[] {
  let before: PhotoPoint | null = null;
  let after: PhotoPoint | null = null;
  for (const photo of ctx.movement) {
    if (photo.nightDay < night) before = photo;
    else if (photo.nightDay > night && after === null) after = photo;
  }
  const keys = new Set<string>();
  for (const photo of [before, after]) {
    const place = photo === null ? null : placeOf(ctx, photo);
    const found = place === null ? undefined : ctx.stations.get(place);
    if (found !== undefined && fitsNight(found.station, found.area, night)) {
      keys.add(found.station.key);
    }
  }
  return [...keys];
}

function unknownEntry(ctx: NightContext, night: Day): NightEntry {
  return entry(NIGHT_UNKNOWN, "unknown", gapNeighbours(ctx, night));
}

interface FlightEnds {
  depDay: Day;
  arrDay: Day;
  /** The arrival's `HH:MM` on the arrival airport's clock; null when the flight has none. */
  arrClock: string | null;
}

/**
 * A flight's local departure and arrival days. A flight with exact instants
 * (`precise`) is read from those instants on the airports' clocks, so a delay
 * past midnight moves its day; any other is read as recorded.
 */
function flightEnds(anchor: FlightAnchor): FlightEnds {
  if (
    anchor.precise &&
    anchor.depMs !== null &&
    anchor.arrMs !== null &&
    isValidZone(anchor.depZone) &&
    isValidZone(anchor.arrZone)
  ) {
    const arrival = toLocal(new Date(anchor.arrMs), anchor.arrZone).local;
    return {
      depDay: localDay(new Date(anchor.depMs), anchor.depZone),
      arrDay: arrival.slice(0, 10),
      arrClock: arrival.slice(11, 16),
    };
  }
  return { depDay: anchor.depDay, arrDay: anchor.arrDay, arrClock: anchor.arrClock };
}

/** 1. A flight took off on or before the night's day and landed after it: airborne at midnight. */
const ruleFlight: NightRule = (ctx, night) => {
  const airborne = ctx.input.anchors.some((anchor) => {
    const { depDay, arrDay } = flightEnds(anchor);
    return depDay <= night && night < arrDay;
  });
  return airborne ? entry(NIGHT_FLIGHT, "flight") : null;
};

/** "HH:MM", or the end of a `YYYY-MM-DD HH:MM` clock, as minutes after midnight. */
function minutesOf(clock: string): number {
  const hhmm = clock.slice(-5);
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** The flight that landed last in `night` (04:00 boundary), by the clock at its destination. */
function latestLanding(anchors: readonly FlightAnchor[], night: Day): FlightAnchor | null {
  let latest: { anchor: FlightAnchor; at: string } | null = null;
  for (const anchor of anchors) {
    const { arrDay, arrClock } = flightEnds(anchor);
    const afterMidnight = arrClock !== null && minutesOf(arrClock) < NIGHT_BOUNDARY_H * 60;
    if ((afterMidnight ? addDays(arrDay, -1) : arrDay) !== night) continue;
    // A landing with no clock is taken to be the day's last.
    const at = `${arrDay} ${arrClock ?? "23:59"}`;
    if (latest === null || at > latest.at) latest = { anchor, at };
  }
  return latest === null ? null : latest.anchor;
}

/**
 * 2. A flight landed in this night after P, or there is no P: the night is
 * spent where it landed. That is home when the airport is within 30 km of the
 * residence, else the first station of the area the flight opens (its first
 * day is pulled back to this night), else unknown. A photo taken after the
 * landing, in that area, is the night's own evidence and this rule steps aside.
 */
const ruleAfterLanding: NightRule = (ctx, night) => {
  const landing = latestLanding(ctx.input.anchors, night);
  if (landing === null) return null;
  const arrivalArea = ctx.input.areas.find((a) => a.area.afterFlightId === landing.id);
  const last = ctx.lastByNight.get(night);
  if (arrivalArea !== undefined && last !== undefined) {
    if (ctx.areaOfPhoto.get(last.id) === arrivalArea) return null;
  }

  const home = ctx.input.homeAt(night);
  if (home !== null && distanceKm(landing.arr, home) <= HOME_RADIUS_KM) {
    return entry(NIGHT_HOME, "afterLanding");
  }
  // An airport or home station at the area's start is not where the traveller slept.
  const first = arrivalArea?.stations.find((s) => s.kind === "visit" || s.kind === "brief");
  if (arrivalArea !== undefined && first !== undefined) {
    if (first.firstDay > night) {
      ctx.pulls.push({ areaKey: arrivalArea.key, stationKey: first.key, firstDay: night });
    }
    return entry(first.key, "afterLanding");
  }
  return unknownEntry(ctx, night);
};

/** 3. No photo at all on this night: unknown, with the stations either side as suggestions. */
const ruleUnknown: NightRule = (ctx, night) =>
  ctx.lastByNight.has(night) ? null : unknownEntry(ctx, night);

/**
 * Whether a night at `place` is a night at home: `home` itself, a station the
 * area marked home, or one whose median lies within 30 km of the residence.
 */
function isHomePlace(ctx: NightContext, place: string, night: Day): boolean {
  if (place === NIGHT_HOME) return true;
  const station = ctx.stations.get(place)?.station;
  if (station === undefined) return false;
  const home = ctx.input.homeAt(night);
  return station.kind === "home" || (home !== null && distanceKm(station, home) <= HOME_RADIUS_KM);
}

/** `place` as a night's answer: the home cluster, under any name, is the word `home`. */
function answerFor(ctx: NightContext, place: string, night: Day): string {
  return isHomePlace(ctx, place, night) ? NIGHT_HOME : place;
}

/** The station a crossing left from: the one whose last photo is the latest before `photo`. */
function boardingStationBefore(ctx: NightContext, photo: PhotoPoint): string | null {
  const area = ctx.areaOfPhoto.get(photo.id);
  if (area === undefined) return null;
  let boarding: { key: string; lastMs: number } | null = null;
  for (const station of area.stations) {
    const span = area.spanMs.get(station.key);
    if (span === undefined || span.lastMs > photo.tMs) continue;
    if (boarding === null || span.lastMs > boarding.lastMs) {
      boarding = { key: station.key, lastMs: span.lastMs };
    }
  }
  return boarding === null ? null : holdingKey(ctx, boarding.key);
}

/**
 * 4. The night was on the water, and goes to the station the ferry left from,
 * not the port it reached. Either P is a photo taken at sea, or P is at a
 * station and the next morning's first photo is at the station a ferry leg
 * leads to. A leg that is only a road does not make a ferry night.
 */
const ruleFerry: NightRule = (ctx, night) => {
  const last = ctx.lastByNight.get(night);
  if (last === undefined) return null;
  if (last.flags.atSea) {
    const boarding = boardingStationBefore(ctx, last);
    return boarding === null
      ? unknownEntry(ctx, night)
      : entry(answerFor(ctx, boarding, night), "ferry");
  }
  const next = ctx.firstMovementByNight.get(addDays(night, 1));
  const from = placeOf(ctx, last);
  const to = next === undefined ? null : placeOf(ctx, next);
  if (from === null || to === null || from === to) return null;
  const crossing = ctx.areaOfPhoto
    .get(last.id)
    ?.legs.some((leg) => leg.mode === "ferry" && leg.fromKey === from && leg.toKey === to);
  return crossing === true ? entry(answerFor(ctx, from, night), "ferry") : null;
};

/** 5. P is in the home cluster: the night was spent at home. */
const ruleHome: NightRule = (ctx, night) => {
  const last = ctx.lastByNight.get(night);
  if (last === undefined || last.flags.atSea) return null;
  const place = placeOf(ctx, last);
  return place !== null && isHomePlace(ctx, place, night) ? entry(NIGHT_HOME, "home") : null;
};

/** Minutes after local midnight on the night's own clock: 00:00–03:59 reads as 24:00–27:59. */
function nightClockMinutes(photo: PhotoPoint): number {
  return minutesOf(photo.local) + (photo.day > photo.nightDay ? 24 * 60 : 0);
}

/**
 * Whether a flight lies between two photos: they are in different areas, or a
 * precise take-off falls between them.
 */
function flightBetween(ctx: NightContext, from: PhotoPoint, to: PhotoPoint): boolean {
  if (ctx.areaOfPhoto.get(from.id) !== ctx.areaOfPhoto.get(to.id)) return true;
  return ctx.input.anchors.some(
    (anchor) => anchor.depMs !== null && anchor.depMs > from.tMs && anchor.depMs < to.tMs
  );
}

/**
 * 6. A night drive. P is at one station and the next morning's first photo Q
 * at another 150 km or more away; P was taken at 18:00 or later and Q before
 * 09:00 (00:00–03:59 reads as 24:00–27:59); no flight lies between them. The
 * night goes to the station driven toward.
 */
const ruleNightDrive: NightRule = (ctx, night) => {
  const last = ctx.lastByNight.get(night);
  const next = ctx.firstMovementByNight.get(addDays(night, 1));
  if (last === undefined || next === undefined || last.flags.atSea) return null;
  if (last.lat === null || last.lon === null || next.lat === null || next.lon === null) return null;
  const from = placeOf(ctx, last);
  const to = placeOf(ctx, next);
  if (from === null || to === null || from === to) return null;
  const km = distanceKm({ lat: last.lat, lon: last.lon }, { lat: next.lat, lon: next.lon });
  if (km < NIGHT_DRIVE_MIN_KM) return null;
  if (nightClockMinutes(last) < minutesOf(NIGHT_DRIVE_LAST_AFTER)) return null;
  if (nightClockMinutes(next) >= minutesOf(NIGHT_DRIVE_FIRST_BEFORE)) return null;
  if (flightBetween(ctx, last, next)) return null;
  return entry(answerFor(ctx, to, night), "nightDrive");
};

/** 7. The station of P. A photo no station owns leaves the night unknown. */
function ruleLastPhoto(ctx: NightContext, night: Day): NightEntry {
  const last = ctx.lastByNight.get(night);
  const place = last === undefined ? null : placeOf(ctx, last);
  if (place === null) return unknownEntry(ctx, night);
  return entry(place, place === NIGHT_HOME ? "home" : "lastPhoto");
}

/**
 * Which place each night of the window, S … E−1, was spent in, and the
 * stations whose first day a rule pulled back to the night they were reached.
 */
export function attributeNights(input: NightInputs): NightAttribution {
  const ctx = buildContext(input);
  const nights: Record<Day, NightEntry> = {};
  for (const night of nightsOf(input.window)) {
    nights[night] =
      ruleFlight(ctx, night) ??
      ruleAfterLanding(ctx, night) ??
      ruleUnknown(ctx, night) ??
      ruleFerry(ctx, night) ??
      ruleHome(ctx, night) ??
      ruleNightDrive(ctx, night) ??
      ruleLastPhoto(ctx, night);
  }
  return { nights, pulls: ctx.pulls };
}

/**
 * `plans` with each pulled station's first day, and its area's, moved back to
 * the night the traveller reached it (rule 2). Returns new plans; the inputs
 * are not touched, and a pull never moves a first day later.
 */
export function applyDayPulls(plans: readonly AreaPlan[], pulls: readonly DayPull[]): AreaPlan[] {
  return plans.map((plan) => {
    const mine = pulls.filter((pull) => pull.areaKey === plan.key);
    if (mine.length === 0) return plan;
    const stations = plan.stations.map((station) => {
      const earliest = mine
        .filter((pull) => pull.stationKey === station.key)
        .map((pull) => pull.firstDay)
        .sort()[0];
      return earliest !== undefined && earliest < station.firstDay
        ? { ...station, firstDay: earliest }
        : station;
    });
    // The area starts where its earliest moved station now starts. A pull for a
    // station the area does not have moves nothing, so it cannot move the area.
    const startDay = stations.reduce(
      (day, station, i) =>
        station !== plan.stations[i] && station.firstDay < day ? station.firstDay : day,
      plan.area.startDay
    );
    return { ...plan, stations, area: { ...plan.area, startDay } };
  });
}

/** What `storedSpanNights` needs of a stored station: its dates and its night (`ExistingStation` fits). */
export interface StoredNightStation {
  startDate: Day | null;
  endDate: Day | null;
  night: StoredNight;
}

/**
 * The nights a STORED station's span covers (owner request 2026-10-12, the
 * trip-scoped re-sync's night seeding): the inverse reading of what a slept
 * station was written from — `deriveStationRows` writes a run of nights as
 * `startDate` (the first night) to `endDate` (the morning after the last) — and
 * the span `countRoadtripNights` counts for a free station. So a slept station
 * dated 11-26 … 11-28 holds the nights of 11-26 and 11-27, the owner's Jebel
 * Shams shape.
 *
 * A slept station dated at one end only holds the one night at the day it
 * names (the reading `daysOverlap` gives such a span); a same-day span holds
 * that one night, never none. A pass-through and a route correction hold no
 * night, and a slept station with no dates holds one no day can name, so none
 * is returned.
 */
export function storedSpanNights(station: StoredNightStation): Day[] {
  if (!isSleptNight(station.night)) return [];
  const first = station.startDate ?? station.endDate;
  const last = station.endDate ?? station.startDate;
  if (first === null || last === null) return [];
  const nights: Day[] = [];
  for (let day = first; day < last; day = addDays(day, 1)) nights.push(day);
  return nights.length === 0 ? [first] : nights;
}
