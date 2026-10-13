import { toDbDate } from "../../shared/time/localDate";
import type { LocalDateValue, TimeValue } from "../../shared/time/wire";
import type { TripTimes } from "../../schemas/times";
import { flightTimes } from "../flights/timesDto";
import { tripTimes, type TripTimeColumns } from "./timesDto";

/**
 * A journey's effective span (owner 2026-10-13): "in flight trips the start and
 * end date of trips should be based on first and last flight ... this trip and
 * journey doesnt understand what the tineline of the trip".
 *
 * Verified live: a flight-only journey (`NYC 2020`) had `Trip.startDay`/
 * `endDay` NULL and no roadtrips, so nothing supplied its span — the Dates
 * cell, the timeline extent and the edit form's dates had nothing — while its
 * FLIGHTS carried the real days. This is the journey-level twin of the
 * roadtrip's `spanOf` (`services/roadtrip/roadtripSummary.ts`), whose stored
 * days win per side with the stations answering the sides nobody set.
 *
 * THE ONE RULE, served on the trip DTO so every consumer reads the same
 * numbers — the band's Dates cell, the timeline, the list cards, the AI
 * summary brief, the Immich scan's window (`scanWindowOf`), the edit form's
 * prefill:
 *
 *   1. a stored `startDay`/`endDay` (else the legacy anchor) wins on its own
 *      side — exactly what `times` already served;
 *   2. a side with neither is the entries' own day: the earliest start to the
 *      latest end over the journey's flights, cruises and stays. The entry set
 *      and the readings are the ones the web's `tripEntrySpan`
 *      (`frontend/src/lib/tripEntrySpan.ts`) has used for the form's "use
 *      entry dates" suggestion; the backend now owns them, and that module
 *      stays a mirror of this one rather than a second answer;
 *   3. an entry whose day cannot be read — a flight with no departure time —
 *      contributes nothing, and a journey with no dated entry abstains (null),
 *      exactly as the trip's dates always did.
 *
 * IT IS A FALLBACK, NEVER A WRITE. Nothing here backfills `Trip.startDay`/
 * `endDay`: the derivation runs on the way out only. A flight's day is the
 * clock at ITS airport (`times` where the flight was enriched for clients,
 * else `flightTimes` over the row's stored zone — `LEGACY_FAKE_UTC` rows keep
 * their wall clock), a cancelled entry never widens the trip, and a one-ended
 * entry stands for its single day, as in the rule this mirrors.
 */

const CANCELLED = "cancelled";

/** A flight as any read path carries it — narrow selects hold only some columns. */
export interface JourneyFlightRow {
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics?: string | null;
  arrTimeSemantics?: string | null;
  depTimezone?: string | null;
  arrTimezone?: string | null;
  depPrecision?: string | null;
  arrPrecision?: string | null;
  status?: string | null;
  /** Present once the flight was enriched for clients: the zone-resolved answer. */
  times?: { departure: TimeValue | null; arrival: TimeValue | null } | null;
}

export interface JourneyCruiseRow {
  startDate: Date | null;
  endDate: Date | null;
  status?: string | null;
}

export interface JourneyStayRow {
  checkIn: Date | null;
  checkOut: Date | null;
  status?: string | null;
}

/** The entries a journey's derived span reads. */
export interface JourneyEntries {
  flights?: readonly JourneyFlightRow[] | null;
  cruises?: readonly JourneyCruiseRow[] | null;
  lodgingStays?: readonly JourneyStayRow[] | null;
}

export interface JourneySpanDays {
  start: LocalDateValue | null;
  end: LocalDateValue | null;
}

const dayOfInstant = (value: TimeValue | null): string | null =>
  value ? value.local.slice(0, 10) : null;

/** A day column's day — a day anchor is stored as UTC midnight, read as it is. */
const dayOfColumn = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const dayValue = (date: string, zone: string | null): LocalDateValue => ({
  date,
  zone,
  precision: "day",
});

/**
 * A flight's two ends, on the clock at each airport. `times` already carries
 * that reading when the caller enriched the flight; otherwise `flightTimes`
 * builds it from the row's own columns (the stored zone, then no catalogue
 * here — a narrow select has none, and the stored zone is the rule anyway).
 */
function flightEnds(f: JourneyFlightRow): {
  start: LocalDateValue;
  end: LocalDateValue;
} | null {
  const times =
    f.times ??
    flightTimes(
      {
        departureTime: f.departureTime,
        arrivalTime: f.arrivalTime,
        depTimeSemantics: f.depTimeSemantics ?? "UTC",
        arrTimeSemantics: f.arrTimeSemantics ?? "UTC",
        depTimezone: f.depTimezone ?? null,
        arrTimezone: f.arrTimezone ?? null,
        depPrecision: f.depPrecision ?? null,
        arrPrecision: f.arrPrecision ?? null,
        actualDeparture: null,
        actualArrival: null,
        runwayDepartureTime: null,
        runwayArrivalTime: null,
      },
      { dep: null, arr: null }
    );
  const departure = times.departure ?? null;
  const arrival = times.arrival ?? null;
  const startDay = dayOfInstant(departure);
  // No departure day: the flight's day is unknown and it contributes nothing.
  if (!startDay) return null;
  const endDay = dayOfInstant(arrival) ?? startDay;
  const endZone = arrival?.zone ?? departure?.zone ?? null;
  return {
    start: dayValue(startDay, departure?.zone ?? null),
    end: dayValue(endDay, endZone),
  };
}

/** One entry's two ends, or null when no day of it can be read. */
function entryDays(entries: JourneyEntries): Array<{ start: LocalDateValue; end: LocalDateValue }> {
  const out: Array<{ start: LocalDateValue; end: LocalDateValue }> = [];
  for (const f of entries.flights ?? []) {
    if (f.status === CANCELLED) continue;
    const ends = flightEnds(f);
    if (ends) out.push(ends);
  }
  for (const c of entries.cruises ?? []) {
    if (c.status === CANCELLED) continue;
    const start = dayOfColumn(c.startDate) ?? dayOfColumn(c.endDate);
    const end = dayOfColumn(c.endDate) ?? dayOfColumn(c.startDate);
    if (start && end) out.push({ start: dayValue(start, null), end: dayValue(end, null) });
  }
  for (const s of entries.lodgingStays ?? []) {
    if (s.status === CANCELLED) continue;
    const start = dayOfColumn(s.checkIn) ?? dayOfColumn(s.checkOut);
    const end = dayOfColumn(s.checkOut) ?? dayOfColumn(s.checkIn);
    if (start && end) out.push({ start: dayValue(start, null), end: dayValue(end, null) });
  }
  return out;
}

/**
 * The days a journey's own entries cover: the earliest start to the latest end,
 * or null when no entry carries a day (abstention, not an empty journey).
 */
export function entrySpanDays(entries: JourneyEntries): {
  start: LocalDateValue;
  end: LocalDateValue;
} | null {
  const days = entryDays(entries);
  if (days.length === 0) return null;
  let { start, end } = days[0];
  for (const d of days) {
    // `YYYY-MM-DD` sorts as strings, as everywhere else in the app.
    if (d.start.date < start.date) start = d.start;
    if (d.end.date > end.date) end = d.end;
  }
  return { start, end };
}

/**
 * The journey's effective span: the stored side where the trip has one (the
 * same `times` the DTO already served), the entries' day otherwise.
 */
export function journeySpanDays<T extends TripTimeColumns & JourneyEntries>(
  trip: T
): JourneySpanDays {
  const stored = tripTimes(trip);
  const derived = stored.start && stored.end ? null : entrySpanDays(trip);
  return {
    start: stored.start ?? derived?.start ?? null,
    end: stored.end ?? derived?.end ?? null,
  };
}

const DAY_MS = 86_400_000;

/** Whole nights between two days, or null when either is unknown. */
function nightsBetween(from: string | null, to: string | null): number | null {
  return from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)) : null;
}

/**
 * The effective span as the AI summary's brief states it — the same days and
 * their length, read here so the brief cannot disagree with the journey's
 * pages. ("Night" is a day boundary; the brief's one reader, `routeLine`,
 * prints it and the model is never asked to count.)
 */
export function journeySpanBrief(trip: TripTimeColumns & JourneyEntries): {
  startDate: string | null;
  endDate: string | null;
  nights: number | null;
} {
  const span = journeySpanDays(trip);
  const startDate = span.start?.date ?? null;
  const endDate = span.end?.date ?? null;
  return { startDate, endDate, nights: nightsBetween(startDate, endDate) };
}

const anchorOf = (day: LocalDateValue | null): Date | null => (day ? toDbDate(day.date) : null);

/**
 * The trip DTO with its effective span — `times` (ADR 0002) and the legacy
 * `startDate`/`endDate` anchors beside it, so a reader of either sees the same
 * days. A side the trip stored travels exactly as it was (anchor and zone
 * untouched); only a side nobody stored takes the derived day as its DATE
 * anchor. Nothing is written anywhere.
 */
export function withJourneySpan<T extends TripTimeColumns & JourneyEntries>(
  trip: T
): T & { times: TripTimes } {
  const stored = tripTimes(trip);
  const span = journeySpanDays(trip);
  return {
    ...trip,
    startDate: stored.start ? trip.startDate : anchorOf(span.start),
    endDate: stored.end ? trip.endDate : anchorOf(span.end),
    times: { start: span.start, end: span.end },
  };
}
