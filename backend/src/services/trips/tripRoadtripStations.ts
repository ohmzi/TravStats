import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import type { TripStopTimes } from "../../schemas/times";
import { stationState } from "../../shared/tour/roadtrip";
import { loadVisibleDomains } from "../domainVisibility";
import { STATION_SELECT, nightsOf } from "../roadtrip/roadtripSummary";
import { withTripStopTimes, type TripStopTimeColumns } from "./timesDto";

/**
 * A roadtrip station as the trip's timeline lists it (photo trip builder, spec
 * 2026-10-09 §E). The time columns travel beside `times`, as on every other
 * timeline row (`withTripStopTimes`); `nights` is this station's own count.
 */
export type TripRoadtripStationDto = TripStopTimeColumns & {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  routeId: string;
  routeOrderIdx: number | null;
  routeName: string;
  state: "stay" | "free" | "pass";
  /** `countRoadtripNights` over this station alone; 0 for a pass-through. */
  nights: number;
  times: TripStopTimes;
};

const SELECT = {
  ...STATION_SELECT,
  precision: true,
  route: { select: { id: true, name: true } },
} satisfies Prisma.TripStopSelect;

/**
 * The stations of the trip's roadtrips, roadtrip by roadtrip and station by
 * station, for the trip's timeline.
 *
 * - `[]` unless the user's visible domains include `roadtrip`: the timeline
 *   must not draw a domain the user switched off.
 * - `tripId: null` leaves out a station adopted onto the trip's own timeline
 *   (the 2.7 classification kept its `tripId`): it is already one of
 *   `trip.stops`, and drawing it twice is the defect this filter prevents.
 * - A route correction (`viaPoint`) is a bend in the line, not a place.
 *
 * `tripId` must already be resolved as the caller's trip; `userId` is checked
 * again on the roadtrip, so a foreign trip id yields nothing.
 */
export async function roadtripStationsForTrip(
  userId: string,
  tripId: string
): Promise<TripRoadtripStationDto[]> {
  const visible = await loadVisibleDomains(userId);
  if (!visible.includes("roadtrip")) return [];

  // `TripRoute.orderIdx` is not unique (a trip merge keeps each roadtrip's old
  // position), so `routeId` breaks the tie and keeps one roadtrip's stations together.
  const rows = await prisma.tripStop.findMany({
    where: { tripId: null, viaPoint: false, route: { tripId, userId, kind: "roadtrip" } },
    orderBy: [{ route: { orderIdx: "asc" } }, { routeId: "asc" }, { routeOrderIdx: "asc" }],
    select: SELECT,
  });

  return rows.flatMap((row) => {
    const state = stationState(row);
    if (state === "via" || row.route === null) return [];
    const columns = withTripStopTimes({
      startDate: row.startDate,
      endDate: row.endDate,
      startUtc: row.startUtc,
      endUtc: row.endUtc,
      stopZone: row.stopZone,
      precision: row.precision,
    });
    return [
      {
        ...columns,
        id: row.id,
        title: row.title,
        lat: row.lat,
        lon: row.lon,
        notes: row.notes,
        routeId: row.route.id,
        routeOrderIdx: row.routeOrderIdx,
        routeName: row.route.name,
        state,
        nights: nightsOf([row]).nights,
      },
    ];
  });
}
