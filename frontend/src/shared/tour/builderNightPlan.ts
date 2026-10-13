/**
 * The trip builder's night plan (spec 2026-10-09 §C.10): the ONE rule for what
 * a set of night answers writes as roadtrip stations, whether those answers
 * form a plan, and what the roadtrips are called.
 *
 * Mirror of `backend/src/shared/tour/builderNightPlan.ts` — change both
 * together. The review page derives what it shows from these functions and the
 * commit handler re-derives and re-validates with the same ones, so the two
 * cannot disagree about a night. Pure and import-free, so both trees hold the
 * same file.
 */

/** A night's answer: a station key, or one of the three words below. */
export type NightAssign = string;

/** The night was spent at home. */
export const NIGHT_HOME = "home";
/** No photo says where; the user decides, the builder never guesses (decision 11). */
export const NIGHT_UNKNOWN = "unknown";
/** Airborne across local midnight. */
export const NIGHT_FLIGHT = "flight";
export const NIGHT_SPECIALS = [NIGHT_HOME, NIGHT_UNKNOWN, NIGHT_FLIGHT] as const;

/** What the plan needs of a station; `firstDay`/`lastDay` are its photo days after any pull. */
export interface NightPlanStation {
  key: string;
  title: string;
  lat: number;
  lon: number;
  firstDay: string;
  lastDay: string;
  notes?: string | null;
}

/** An area's span and its stations in travel order. */
export interface NightPlanArea {
  key: string;
  startDay: string;
  endDay: string;
  stationKeys: readonly string[];
}

/** S and E, the trip's own first and last day. Its nights are S … E−1. */
export interface NightPlanWindow {
  startDay: string;
  endDay: string;
}

/**
 * One roadtrip station row. A slept station gives one row per CONTIGUOUS run
 * of its nights — `startDate` the first night, `endDate` the last night + 1,
 * the span `countRoadtripNights` counts — and a station without nights one
 * pass row from `firstDay` to `lastDay`. `key` is the station key for the
 * first row and `<stationKey>@2`, `@3` … for each later run.
 */
export interface StationRow {
  key: string;
  stationKey: string;
  title: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  slept: boolean;
  notes?: string | null;
}

export const NIGHT_PLAN_ERROR_CODES = [
  "duplicateStation",
  "unknownStation",
  "nightOutsideWindow",
  "nightOutsideArea",
  "nightNotAdjacent",
  "overlappingSleptRows",
  "sleptRowOutsideWindow",
] as const;
export type NightPlanErrorCode = (typeof NIGHT_PLAN_ERROR_CODES)[number];

export interface NightPlanError {
  code: NightPlanErrorCode;
  stationKey: string | null;
  day: string | null;
}

/** What naming needs of an area that becomes a roadtrip, in travel order. */
export interface AreaNameInput {
  key: string;
  mainCity: string | null;
  startDay: string;
}

const DAY_MS = 86_400_000;

/** `day` moved by `n` calendar days, on the day string alone — no zone can shift it. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The least nights a stay needs to be a trip of its own (owner ruling
 * 2026-10-13, "Sumayya's wedding"): "clearly istanbul first stay and karachi
 * stay should prompt trip creation suggestion … not the 5 hrs stay as nothing
 * much happened in there evident by pictures". One night is still a mere stop.
 */
export const STAY_MIN_NIGHTS = 2;

/**
 * Whether an area is a multi-night stay: the days it spans hold at least
 * `STAY_MIN_NIGHTS` nights (an area holding days S…E holds the nights S…E−1)
 * and its photos stand on more than one day — a station whose own photo days
 * span two days. A same-day transit and a one-night stop are no stay; a long
 * window whose every photo sits on one day is no stay either: nothing much
 * happened, and the stop already carries that day.
 */
export function isMultiNightStay(
  startDay: string,
  endDay: string,
  stations: ReadonlyArray<{ firstDay: string; lastDay: string }>
): boolean {
  const nights = Math.round(
    (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / DAY_MS
  );
  if (nights < STAY_MIN_NIGHTS) return false;
  return stations.some((station) => station.firstDay < station.lastDay);
}

/** What a trip-shape check needs of an area: its span and the stations the scan offered. A `DraftArea` fits. */
export interface TripShapeArea {
  startDay: string;
  endDay: string;
  stations: ReadonlyArray<{ firstDay: string; lastDay: string }>;
}

/**
 * Whether `rowCount` dated station rows are a trip shape the commit writes
 * (owner ruling 2026-10-13, "Sumayya's wedding"): two rows or more, or exactly
 * one when the area is the multi-night stay that row is (`isMultiNightStay`).
 * The ONE predicate every path that judges an area's shape reads — the create
 * guard, the re-sync guard, the review's report and the scan's offer — so a
 * one-station stay can never be offered by one path and refused by another.
 * Zero rows is never a trip: an area the user emptied writes nothing. A via
 * station is no station: callers count dated stations only.
 */
export function isTripShape(rowCount: number, area: TripShapeArea): boolean {
  if (rowCount >= 2) return true;
  return rowCount === 1 && isMultiNightStay(area.startDay, area.endDay, area.stations);
}

/** The window's nights, S … E−1; none for a one-day window. */
export function nightsOf(window: NightPlanWindow): string[] {
  const nights: string[] = [];
  for (let night = window.startDay; night < window.endDay; night = addDays(night, 1)) {
    nights.push(night);
  }
  return nights;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "2031-05-02" → "2 May". English short month names on purpose: the label ends
 * up inside a roadtrip's NAME, which is data the user may rename, not UI copy.
 */
export function dayMonthLabel(day: string): string {
  const month = Number(day.slice(5, 7));
  const dayOfMonth = Number(day.slice(8, 10));
  return `${dayOfMonth} ${MONTH_NAMES[month - 1]}`;
}

/** The separator of `"<trip> · <city>"`: a space, U+00B7, a space (`renameTripSections` renames by it). */
const AREA_NAME_SEPARATOR = " · ";

/**
 * What each area that becomes a roadtrip is called (spec §C.11, decision 4).
 *
 * - One area: exactly the trip's name, unless the trip already holds a roadtrip
 *   of that name (`takenNames`, for the existing target), then the `·` form.
 * - Several: `"<trip> · <main city>"` (the trip's name again for an area with
 *   no main city). A name that two areas share, or one already taken, gets
 *   ` (<d MMM>)` of the area's first day, and a last numeric suffix keeps two
 *   areas that start on the same day apart. That last pass checks the taken
 *   names too, so the ` (<d MMM>)` and numbered forms never repeat a name the
 *   trip already holds.
 *
 * Keyed by `AreaNameInput.key`; `areas` come in travel order.
 */
export function roadtripAreaNames(
  areas: readonly AreaNameInput[],
  tripName: string,
  takenNames: ReadonlySet<string>
): Record<string, string> {
  const names: Record<string, string> = {};
  if (areas.length === 0) return names;
  if (areas.length === 1 && !takenNames.has(tripName)) {
    names[areas[0].key] = tripName;
    return names;
  }
  const bases = areas.map(
    (area) => `${tripName}${AREA_NAME_SEPARATOR}${area.mainCity ?? tripName}`
  );
  areas.forEach((area, i) => {
    const base = bases[i];
    const clashes = takenNames.has(base) || bases.some((other, j) => j !== i && other === base);
    names[area.key] = clashes ? `${base} (${dayMonthLabel(area.startDay)})` : base;
  });
  const seen = new Set(takenNames);
  for (const area of areas) {
    const wanted = names[area.key];
    let name = wanted;
    for (let n = 2; seen.has(name); n++) name = `${wanted} ${n}`;
    seen.add(name);
    names[area.key] = name;
  }
  return names;
}

/**
 * Whether `day` is a real calendar date written `YYYY-MM-DD`. Parsing it must
 * give a time (`addDays` throws on "2031-13-45"), and the day must survive the
 * round trip: "2031-02-30" parses, but as 2 March. Only a ten-character
 * `YYYY-MM-DD` string can equal what `addDays` writes back, so no separate
 * pattern check is needed.
 */
function isCalendarDay(day: string): boolean {
  return !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && addDays(day, 0) === day;
}

/**
 * The days `nights` gives to one station, earliest first. A key that is not a
 * calendar date is no night at all: it can come from a request body, and
 * `validateNightPlan` reports it as a night outside the window.
 */
function nightsAssignedTo(key: string, nights: Readonly<Record<string, NightAssign>>): string[] {
  return Object.keys(nights)
    .filter((day) => nights[day] === key && isCalendarDay(day))
    .sort();
}

/** Sorted days grouped into runs of consecutive calendar days. */
function consecutiveRuns(days: readonly string[]): string[][] {
  const runs: string[][] = [];
  for (const day of days) {
    const run = runs[runs.length - 1];
    if (run !== undefined && addDays(run[run.length - 1], 1) === day) run.push(day);
    else runs.push([day]);
  }
  return runs;
}

/**
 * What a set of night answers writes as roadtrip stations (spec §C.10).
 *
 * `nights[day]` is the source of truth; the dates are derived from it so a
 * station can never claim a night another station holds.
 *
 * - A station with no night is a pass station: one row from its `firstDay` to
 *   its `lastDay`.
 * - A station with nights is slept: one row per run of consecutive nights,
 *   `startDate` the first night and `endDate` the last night + 1, which is
 *   exactly the span `countRoadtripNights` counts. A gap in its nights (an
 *   unknown night, a night spent elsewhere) splits it into rows at the same
 *   coordinates; the 0 km leg between them is fine.
 *
 * Rows come ordered by start day, then by the stations' order, then by run.
 * A key of `nights` that is not a calendar date is not a night and gives no row.
 */
export function deriveStationRows(
  stations: readonly NightPlanStation[],
  nights: Readonly<Record<string, NightAssign>>
): StationRow[] {
  const placed: Array<{ row: StationRow; stationIndex: number; runIndex: number }> = [];
  stations.forEach((station, stationIndex) => {
    const shared = {
      stationKey: station.key,
      title: station.title,
      lat: station.lat,
      lon: station.lon,
      ...(station.notes !== undefined ? { notes: station.notes } : {}),
    };
    const runs = consecutiveRuns(nightsAssignedTo(station.key, nights));
    if (runs.length === 0) {
      const row = {
        key: station.key,
        ...shared,
        startDate: station.firstDay,
        endDate: station.lastDay,
        slept: false,
      };
      placed.push({ row, stationIndex, runIndex: 0 });
      return;
    }
    runs.forEach((run, runIndex) => {
      const row = {
        key: runIndex === 0 ? station.key : `${station.key}@${runIndex + 1}`,
        ...shared,
        startDate: run[0],
        endDate: addDays(run[run.length - 1], 1),
        slept: true,
      };
      placed.push({ row, stationIndex, runIndex });
    });
  });
  placed.sort((a, b) => {
    if (a.row.startDate !== b.row.startDate) return a.row.startDate < b.row.startDate ? -1 : 1;
    return a.stationIndex - b.stationIndex || a.runIndex - b.runIndex;
  });
  return placed.map(({ row }) => row);
}

/**
 * Every reason a set of night answers is not a plan the commit may write
 * (spec §C.10); an empty list means it is one.
 *
 * The checks run in the order below, and within a check the errors come by
 * day, so the first error is the one to tell the person about:
 *
 * 1. `duplicateStation`: two stations share a key.
 * 2. `nightOutsideWindow`: a night that is not one of S … E−1.
 * 3. `unknownStation`: an answer that is neither a station key nor a word.
 * 4. `nightOutsideArea`: a night outside [area start − 1, area end] of the
 *    area that holds the station it names (the evening of the last day
 *    belongs to the area; so does the night before its first photo day, when
 *    the traveller landed late).
 * 5. `nightNotAdjacent`: a night outside [first photo day − 1, last photo
 *    day + 1] of the station it names, which would stretch the station over
 *    the nights of its neighbours.
 * 6. `overlappingSleptRows`: two slept rows share a night. The rows come from
 *    `deriveStationRows`, so only a repeated station key can do it; the check
 *    is the commit's last line of defence against writing a night twice.
 * 7. `sleptRowOutsideWindow`: a slept row that is not inside [S, E].
 *
 * Checks 3 to 5 look only at nights inside the window; checks 4 and 5 only at
 * nights that name a known station. Checks 6 and 7 read the rows the nights
 * as sent would write. The nights come from a request body, so a key that is
 * not a calendar date ("garbage", "2031-13-45") is a night outside the window
 * and writes no row, so no key of `nights` makes this function throw.
 */
export function validateNightPlan(
  stations: readonly NightPlanStation[],
  nights: Readonly<Record<string, NightAssign>>,
  areas: readonly NightPlanArea[],
  window: NightPlanWindow
): NightPlanError[] {
  const errors: NightPlanError[] = [];
  const words = new Set<string>(NIGHT_SPECIALS);
  const windowNights = new Set(nightsOf(window));
  const days = Object.keys(nights).sort();

  const known = new Map<string, NightPlanStation>();
  const repeated = new Set<string>();
  for (const station of stations) {
    if (known.has(station.key)) repeated.add(station.key);
    else known.set(station.key, station);
  }
  for (const key of repeated) errors.push({ code: "duplicateStation", stationKey: key, day: null });

  for (const day of days) {
    if (windowNights.has(day)) continue;
    const assign = nights[day];
    errors.push({ code: "nightOutsideWindow", stationKey: words.has(assign) ? null : assign, day });
  }

  const named = days.filter((day) => windowNights.has(day) && !words.has(nights[day]));
  for (const day of named) {
    if (!known.has(nights[day])) {
      errors.push({ code: "unknownStation", stationKey: nights[day], day });
    }
  }
  const placed = named.filter((day) => known.has(nights[day]));

  const areaOf = new Map<string, NightPlanArea>();
  for (const area of areas) {
    for (const key of area.stationKeys) if (!areaOf.has(key)) areaOf.set(key, area);
  }
  for (const day of placed) {
    const area = areaOf.get(nights[day]);
    if (area === undefined || day < addDays(area.startDay, -1) || day > area.endDay) {
      errors.push({ code: "nightOutsideArea", stationKey: nights[day], day });
    }
  }
  for (const day of placed) {
    const station = known.get(nights[day]);
    if (
      station !== undefined &&
      (day < addDays(station.firstDay, -1) || day > addDays(station.lastDay, 1))
    ) {
      errors.push({ code: "nightNotAdjacent", stationKey: nights[day], day });
    }
  }

  const slept = deriveStationRows(stations, nights).filter((row) => row.slept);
  let reach = "";
  for (const row of slept) {
    if (row.startDate < reach) {
      errors.push({ code: "overlappingSleptRows", stationKey: row.stationKey, day: row.startDate });
    }
    if (row.endDate > reach) reach = row.endDate;
  }
  for (const row of slept) {
    if (row.startDate < window.startDay) {
      errors.push({
        code: "sleptRowOutsideWindow",
        stationKey: row.stationKey,
        day: row.startDate,
      });
    } else if (row.endDate > window.endDay) {
      errors.push({ code: "sleptRowOutsideWindow", stationKey: row.stationKey, day: row.endDate });
    }
  }
  return errors;
}

/**
 * The leg mode between each pair of consecutive station rows (spec §C.10).
 *
 * The draft's `legModes[i]` joins `stationKeys[i]` to `stationKeys[i + 1]`,
 * but the rows are not the stations: a station split by a night spent
 * elsewhere is two rows. So each pair of rows takes the mode of the draft leg
 * that joins their two stations, a station's own split is a 0 km `road` leg,
 * and a pair no draft leg joins (a station was merged, deleted or reordered)
 * is `road`. The result has one entry fewer than there are rows.
 */
export function rowLegModes(
  stationKeys: readonly string[],
  legModes: readonly ("road" | "ferry")[],
  rows: readonly StationRow[]
): Array<"road" | "ferry"> {
  const modes: Array<"road" | "ferry"> = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const from = rows[i].stationKey;
    const to = rows[i + 1].stationKey;
    let mode: "road" | "ferry" = "road";
    if (from !== to) {
      const leg = stationKeys.findIndex((key, j) => key === from && stationKeys[j + 1] === to);
      if (leg >= 0) mode = legModes[leg] ?? "road";
    }
    modes.push(mode);
  }
  return modes;
}
