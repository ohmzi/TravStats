import { formatTimeValueShown } from "./displayFormat";
import { clockOf, dayOf, type LocalDateValue, type TimeValue } from "../shared/time";

/**
 * Date + time handling for the trip timeline (#175), on the time model of
 * ADR 0002.
 *
 * Every entry carries its time as a `TimeValue` (see `lib/entityTimes.ts`):
 * `local` is the wall clock at the place — "we were at the Louvre at 14:00"
 * means 14:00 in Paris — and `utc` is the instant. The timeline SHOWS `local`
 * and GROUPS by the day in `local`; it uses `utc` only to order entries that
 * share a day. Grouping by the UTC day was the bug this replaced: a flight
 * leaving Haneda at 01:00 on 1 August sat under 31 July, because it was still
 * the 31st in UTC. No reader's zone takes part anywhere — a browser in
 * Kiritimati and one in Honolulu show the same page.
 *
 * A value of precision `day` (a stay, a journal day, a stop without a time)
 * has no clock; `hasExplicitTime` is how the ordering tells.
 */

/** A day-only value (a stay night, a journal day) as a `TimeValue` of precision `day`. */
export function dayAsTimeValue(day: LocalDateValue): TimeValue {
  return {
    utc: `${day.date}T00:00:00.000Z`,
    zone: day.zone,
    offset: "",
    local: `${day.date}T00:00:00`,
    precision: "day",
  };
}

/**
 * The two form inputs (`YYYY-MM-DD`, `HH:mm`) for a stored value, on the
 * place's clock. An absent time of day is an empty field, not "00:00".
 */
export function splitTimeValue(value: TimeValue | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  return { date: dayOf(value), time: clockOf(value) ?? "" };
}

/** True when the value carries a time of day. */
export function hasExplicitTime(value: TimeValue): boolean {
  return clockOf(value) !== null;
}

/**
 * "01.05.2026" or "01.05.2026 14:30" in the user's format, on the place's
 * clock — the value's own `local`, never the reader's zone.
 */
export function formatTimelineDate(value: TimeValue): string {
  return formatTimeValueShown(value);
}

/** The kinds the timeline sorts, as far as ordering cares. */
export interface SortableEvent {
  when: TimeValue;
  kind: string;
  /**
   * Flights only: the local day the flight ARRIVED (the caller computes it
   * from the arrival value), so the comparator can put the flight ahead of the
   * place entries it moved the traveller to. Absent on every other kind, and
   * null when the arrival is not known.
   */
  arrivalDay?: string | null;
}

/**
 * The kinds that stand for the traveller BEING somewhere — a place reached,
 * not the travel that reached it. `lodging-checkin` is not among them: its
 * own rank already places it after that day's travelling.
 */
const PLACE_KINDS: ReadonlySet<string> = new Set(["stop", "roadtrip-station", "place-visit"]);

/**
 * Whether `a` is the flight that moved the traveller to the place entry `b`
 * (owner ruling 2026-10-13, "Sumayya's wedding"): they share a day, `a` is a
 * flight whose own arrival day is that day, and `b` is a time-less place
 * entry. Only a MISSING clock is settled this way — a place entry that carries
 * a time keeps its place in the clock order, exactly as every rank here does.
 * Returns -1 when `a` goes first, 1 when `b` does, 0 when neither is such a
 * pair.
 */
function flightFirst(a: SortableEvent, b: SortableEvent, day: string): number {
  const movedBy = (flight: SortableEvent, place: SortableEvent): boolean =>
    flight.kind === "flight" &&
    PLACE_KINDS.has(place.kind) &&
    flight.arrivalDay === day &&
    !hasExplicitTime(place.when);
  if (movedBy(a, b)) return -1;
  if (movedBy(b, a)) return 1;
  return 0;
}

/**
 * Where an event sits within its day when it carries NO time of day.
 *
 * A day-only value would otherwise sort as 00:00, the EARLIEST moment of the
 * day. That put a hotel check-in above the flight that landed at 07:45 and
 * brought the traveller there, on the owner's Madagascar trip. Every lodging
 * stay is day-only, so the misordering was general, not one bad row.
 *
 * A day without recorded times still has a shape: you leave the hotel, you
 * travel, you arrive somewhere and check in, and you write the day up at its
 * end. That shape is what these ranks encode — and only for events whose time
 * is genuinely unknown. A check-in that DOES carry a time keeps its place in
 * the clock order; the rank is a fallback for missing information, never an
 * override of information we have.
 */
function dayRank(ev: SortableEvent): number {
  if (ev.kind === "journal") return 3; // always the day's last word — #175
  if (hasExplicitTime(ev.when)) return 1;
  if (ev.kind === "lodging-checkout") return 0; // you leave before you travel
  if (ev.kind === "lodging-checkin") return 2; // you arrive before you settle
  // A trip's station is the same shape: its day's first station is a place you
  // REACH, and the flight (or drive) that brought you there is the travelling.
  // Without this, a time-less station sorted at midnight, ABOVE the timed
  // flight that landed that morning — the owner's "my flight to muscat is
  // showing up after the trip of muscat starts" (2026-10-13).
  if (ev.kind === "roadtrip-station") return 2;
  return 1;
}

/**
 * Chronological order: by the day AT THE PLACE first, then within a day by
 * four deliberate tie-breaks.
 *
 * 1. The flight that brought the traveller to a place sorts BEFORE the
 *    time-less place entries of its arrival day (`flightFirst`, owner ruling
 *    2026-10-13): the presence in Istanbul is not drawn before the flight from
 *    Karachi.
 * 2. A DIARY entry sorts after everything else on the same day — Alex's
 *    request (#175): "Diary entries should always be the last entry of a day".
 * 3. A time-less check-in or check-out is placed by `dayRank` rather than by
 *    a made-up midnight — see there for why.
 * 4. Otherwise the instants decide (`utc` is the one thing that orders two
 *    clocks in different zones), and ties keep their original relative order
 *    (the comparator returns 0 and Array.prototype.sort is stable), so two
 *    stops entered for the same time stay in the order the backend returned.
 *
 * Across days the place's day decides, so a check-in on the 1st can never be
 * dragged past anything on the 2nd, and a flight that leaves on the 1st is on
 * the 1st.
 */
export function compareTimelineEvents(a: SortableEvent, b: SortableEvent): number {
  const da = dayOf(a.when);
  const db = dayOf(b.when);
  if (da !== db) return da < db ? -1 : 1;
  const moved = flightFirst(a, b, da);
  if (moved !== 0) return moved;
  const ra = dayRank(a);
  const rb = dayRank(b);
  if (ra !== rb) return ra - rb;
  const ta = Date.parse(a.when.utc);
  const tb = Date.parse(b.when.utc);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

/**
 * Whether a `TripStop` has already been replaced by a `PlaceVisit` and must
 * therefore NOT be drawn — otherwise the migrated POI appears twice.
 *
 * The POI backfill (`20260823150500_poi_backfill_from_trip_stops`) is the
 * EXPAND half of an expand/contract pair: it copies every qualifying
 * `domain='poi'` stop into Place + PlaceVisit and deliberately leaves the
 * original rows in place, so a bad backfill stays recoverable. The DELETE
 * ships a release later. Between those two releases both rows exist, and
 * something has to decide which one the timeline shows.
 *
 * The rule mirrors the migration's own WHERE clause exactly, which is what
 * makes it correct rather than approximate: a POI stop was migrated **if and
 * only if** it had both coordinates. Coordinate-less POI stops were neither
 * migrated nor deleted — `places.lat/lon` is NOT NULL and deleting the user's
 * text to satisfy a schema was not acceptable — so those keep rendering as
 * ordinary stops, which is exactly what this returns.
 *
 * Once the contract migration has run this becomes a no-op rather than a lie:
 * there will be no `domain='poi'` stops left with coordinates. Delete it then,
 * together with the audit table.
 */
export function isSupersededByPlaceVisit(stop: {
  domain?: string | null;
  lat?: number | null;
  lon?: number | null;
}): boolean {
  return (
    stop.domain === "poi" &&
    stop.lat !== null &&
    stop.lat !== undefined &&
    stop.lon !== null &&
    stop.lon !== undefined
  );
}
