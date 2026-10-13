import { formatLocalDate, formatTimeValueShown } from "./displayFormat";
import {
  cruiseEnd,
  cruiseStart,
  flightArrival,
  flightDeparture,
  journalDay,
  railDeparture,
  stayCheckIn,
  stayCheckOut,
  tripStopStart,
  visitTime,
} from "./entityTimes";
import {
  compareTimelineEvents,
  dayAsTimeValue,
  hasExplicitTime,
  isSupersededByPlaceVisit,
} from "./tripTimeline";
import { dayOf, readsAsUtc, timeValueAtZone, type TimeValue } from "../shared/time";
import type { Trip, TripJournalEntry, TripStop } from "../types";
import type { Place, PlaceVisit } from "../types/place";
import type { TripRailJourney } from "../types/rail";
import type { TripRental } from "../types/rental";
import type { TripRoadtripStationDto } from "../types/tripRoadtripStation";

/**
 * The trip timeline's entries — every dated thing a trip holds, in one
 * chronology. Moved out of `pages/TripDetailPage.tsx`, which is over the
 * 800-line limit and frozen at its size, when rail journeys joined the
 * timeline (spec 2026-09-25-rail-domain, phase 2b).
 *
 * Every entry's `when` is a `TimeValue` from `lib/entityTimes.ts`: the
 * place's own clock to show and group by, the instant to order within a day
 * (ADR 0002). No entry is read in the viewer's zone.
 */
export type TimelineEvent =
  | {
      id: string;
      kind: "flight";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      /**
       * The local day the flight ARRIVED, or null when the arrival is not
       * known: the comparator sorts the flight ahead of the time-less place
       * entries of that day (owner ruling 2026-10-13).
       */
      arrivalDay: string | null;
      title: string;
      subtitle: string | null;
      /** The row itself, so the entry can open in place. It is already on the
       *  trip payload -- see the note on `Trip["flights"]`. */
      flight: NonNullable<Trip["flights"]>[number];
    }
  | {
      id: string;
      kind: "cruise";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      title: string;
      subtitle: string | null;
      cruise: NonNullable<Trip["cruises"]>[number];
    }
  | {
      id: string;
      kind: "stop";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      stop: TripStop;
    }
  | {
      id: string;
      kind: "journal";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      entry: TripJournalEntry;
    }
  | {
      id: string;
      kind: "lodging-checkin" | "lodging-checkout";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      stay: NonNullable<Trip["lodgingStays"]>[number];
    }
  | {
      id: string;
      kind: "rail";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      journey: TripRailJourney;
    }
  | {
      id: string;
      kind: "rental-pickup" | "rental-return";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      rental: TripRental;
    }
  | {
      id: string;
      kind: "place-visit";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      place: Place;
      visit: PlaceVisit;
    }
  | {
      id: string;
      kind: "roadtrip-station";
      /** `when.utc` — kept for callers that only need an instant to compare. */
      date: string;
      when: TimeValue;
      station: TripRoadtripStationDto;
    };

/** Rentals as entries: the pickup and the return, each on its station's clock. */
function rentalEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const rental of trip.rentalBookings ?? []) {
    const ends = [
      ["rental-pickup", rental.pickupTime, rental.pickupTimezone, rental.pickupPrecision],
      ["rental-return", rental.returnTime, rental.returnTimezone, rental.returnPrecision],
    ] as const;
    for (const [kind, time, zone, precision] of ends) {
      const when = timeValueAtZone(time, zone, precision === "day" ? "day" : "minute");
      if (!when) continue;
      out.push({ id: `${kind}-${rental.id}`, kind, date: when.utc, when, rental });
    }
  }
  return out;
}

/** Rail journeys as entries: one per ride, at its departure. */
function railEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const journey of trip.railJourneys ?? []) {
    const when = railDeparture(journey);
    if (!when) continue;
    out.push({ id: `rail-${journey.id}`, kind: "rail", date: when.utc, when, journey });
  }
  return out;
}

/** One end of a flight as the subtitle shows it: on its airport's clock, "UTC" where no zone is known. */
function flightEndLabel(value: TimeValue): string {
  const shown = formatTimeValueShown(value);
  return readsAsUtc(value) && hasExplicitTime(value) ? `${shown} UTC` : shown;
}

function flightEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const f of trip.flights ?? []) {
    const when = flightDeparture(f);
    if (!when) continue;
    const arrival = flightArrival(f);
    out.push({
      id: `flight-${f.id}`,
      kind: "flight",
      date: when.utc,
      when,
      // The arrival's own day, so the comparator sorts this flight ahead of
      // the place entries it moved the traveller to (owner 2026-10-13).
      arrivalDay: arrival === null ? null : dayOf(arrival),
      title: `${f.depIata ?? "???"} → ${f.arrIata ?? "???"}`,
      // Each end on its own airport's clock (the server's `local`), never the
      // viewer's: `toLocaleString()` once put a JFK arrival six hours off the
      // boarding pass here.
      subtitle: arrival
        ? `${flightEndLabel(when)} → ${flightEndLabel(arrival)}`
        : flightEndLabel(when),
      flight: f,
    });
  }
  return out;
}

function cruiseEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const c of trip.cruises ?? []) {
    const start = cruiseStart(c);
    if (!start) continue;
    const end = cruiseEnd(c);
    const when = dayAsTimeValue(start);
    out.push({
      id: `cruise-${c.id}`,
      kind: "cruise",
      date: when.utc,
      when,
      title: c.cruiseLine ?? "Kreuzfahrt",
      subtitle: end
        ? `${formatLocalDate(start.date)} → ${formatLocalDate(end.date)}`
        : formatLocalDate(start.date),
      cruise: c,
    });
  }
  return out;
}

function stopEvents(trip: Trip): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const s of trip.stops ?? []) {
    // A migrated POI stop is drawn as its PlaceVisit instead. Both rows
    // exist between the backfill and the delete release, so without this
    // every migrated POI would appear twice — see isSupersededByPlaceVisit.
    if (isSupersededByPlaceVisit(s)) continue;
    // A stop without a date sits on the day it was written down (UTC, the
    // only day a creation instant has), without a clock.
    const when = tripStopStart(s) ?? timeValueAtZone(s.createdAt, null, "day");
    if (!when) continue;
    out.push({ id: `stop-${s.id}`, kind: "stop", date: when.utc, when, stop: s });
  }
  return out;
}

/**
 * The day a roadtrip station's entry is DRAWN on (owner 2026-10-13): the
 * trip's own days place the trip, so an entry the trip's effective span
 * (`routeStartDate`/`routeEndDate` — its stored days where set) leaves outside
 * is drawn at the bound, and an entry inside keeps its own day. The span the
 * server sends is the SAME `spanOf` answer the roadtrip's pages, the chain
 * and the figures band read, so the timeline cannot place the trip somewhere
 * the trip's own page contradicts. The report behind this: a flight arriving
 * day D rendered after the trip it brought the traveller to, because the
 * trip's first station was dated before D and nothing let the trip start
 * later. Without a stored day the span is derived from the stations
 * themselves, so this clips nothing on an undated trip.
 */
function placedWhen(station: TripRoadtripStationDto, when: TimeValue): TimeValue {
  const day = dayOf(when);
  const start = station.routeStartDate?.slice(0, 10) ?? null;
  const end = station.routeEndDate?.slice(0, 10) ?? null;
  if (start !== null && day < start) {
    return dayAsTimeValue({ date: start, zone: when.zone, precision: "day" });
  }
  if (end !== null && day > end) {
    return dayAsTimeValue({ date: end, zone: when.zone, precision: "day" });
  }
  return when;
}

/**
 * A roadtrip's stations as entries (photo trip builder, spec 2026-10-09 §E).
 * `GET /trips/:id` lists the stations of the trip's roadtrips that are NOT
 * timeline stops of the trip: a station adopted onto the trip is already in
 * `trip.stops`, and drawing it twice is the defect the id check guards
 * against. The server answers `[]` while roadtrips are off, so no gate is
 * needed here. A station with no day has no place on a chronology.
 *
 * Each entry is placed by the trip's own days (`placedWhen`); a time-less one
 * sorts after the flights of its day (`dayRank` in `tripTimeline.ts`), so an
 * arriving flight precedes the trip it brought the traveller to.
 */
function roadtripStationEvents(trip: Trip): TimelineEvent[] {
  const onTimeline = new Set((trip.stops ?? []).map((stop) => stop.id));
  const out: TimelineEvent[] = [];
  for (const station of trip.roadtripStations ?? []) {
    if (onTimeline.has(station.id)) continue;
    const own = tripStopStart(station);
    if (!own) continue;
    const when = placedWhen(station, own);
    const id = `roadtrip-station-${station.id}`;
    out.push({ id, kind: "roadtrip-station", date: when.utc, when, station });
  }
  return out;
}

function lodgingEvents(trip: Trip): TimelineEvent[] {
  // Each linked stay renders as TWO timeline entries — a check-in and a
  // check-out — so the hotel is visible in the trip's chronology. An undated
  // stay has no place on one; it still shows in the lodging list below.
  const out: TimelineEvent[] = [];
  for (const s of trip.lodgingStays ?? []) {
    const checkIn = stayCheckIn(s);
    const checkOut = stayCheckOut(s);
    const inWhen = s.times?.checkInAt ?? (checkIn ? dayAsTimeValue(checkIn) : null);
    const outWhen = s.times?.checkOutAt ?? (checkOut ? dayAsTimeValue(checkOut) : null);
    if (inWhen) {
      const id = `lodging-checkin-${s.id}`;
      out.push({ id, kind: "lodging-checkin", date: inWhen.utc, when: inWhen, stay: s });
    }
    if (outWhen) {
      const id = `lodging-checkout-${s.id}`;
      out.push({ id, kind: "lodging-checkout", date: outWhen.utc, when: outWhen, stay: s });
    }
  }
  return out;
}

export function buildTimelineEvents(
  trip: Trip,
  placeVisits: ReadonlyArray<{ place: Place; visit: PlaceVisit }>
): TimelineEvent[] {
  const out: TimelineEvent[] = [
    ...railEvents(trip),
    ...rentalEvents(trip),
    ...flightEvents(trip),
    ...cruiseEvents(trip),
    ...stopEvents(trip),
    ...roadtripStationEvents(trip),
  ];
  for (const { place, visit } of placeVisits) {
    // An undated visit has no place on a chronology; it still shows on the
    // place itself. Same rule an undated lodging stay already follows.
    const when = visitTime(visit);
    if (!when) continue;
    out.push({
      id: `place-visit-${visit.id}`,
      kind: "place-visit",
      date: when.utc,
      when,
      place,
      visit,
    });
  }
  for (const e of trip.journalEntries ?? []) {
    const day = journalDay(e);
    if (!day) continue;
    const when = dayAsTimeValue(day);
    out.push({ id: `journal-${e.id}`, kind: "journal", date: when.utc, when, entry: e });
  }
  out.push(...lodgingEvents(trip));
  // #175: grouped by the place's day, ordered within it, a day's diary entry
  // last. See compareTimelineEvents — the rules and why they exist live there.
  return out.sort(compareTimelineEvents);
}
