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
import { addDays, nightsOf, NIGHT_HOME, NIGHT_UNKNOWN } from "../../shared/tour/builderNightPlan";
import type {
  AreaPlan,
  Day,
  DayPull,
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

/** 3. No photo at all on this night: unknown, with the stations either side as suggestions. */
const ruleUnknown: NightRule = (ctx, night) =>
  ctx.lastByNight.has(night) ? null : unknownEntry(ctx, night);

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
    nights[night] = ruleUnknown(ctx, night) ?? ruleLastPhoto(ctx, night);
  }
  return { nights, pulls: ctx.pulls };
}
