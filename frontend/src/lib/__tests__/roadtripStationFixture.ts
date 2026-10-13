import type { TimeValue } from "../../shared/time";
import type { TripRoadtripStationDto } from "../../types/tripRoadtripStation";

/** A day on a station's own clock, the way the server sends a day-precision `times`. */
export const dayAt = (date: string): TimeValue => ({
  utc: `${date}T00:00:00.000Z`,
  zone: "Pacific/Auckland",
  offset: "+12:00",
  local: `${date}T00:00:00`,
  precision: "day",
});

/** One roadtrip station as `GET /trips/:id` lists it. Synthetic: invented place and roadtrip. */
export function stationDto(over: Partial<TripRoadtripStationDto> = {}): TripRoadtripStationDto {
  return {
    id: "7c6b5a49-3827-4615-9d0c-1b2a3f4e5d6c",
    title: "Northvale",
    lat: -45.05,
    lon: 168.7,
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-04T00:00:00.000Z",
    notes: null,
    routeId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    routeName: "Northvale loop",
    // The trip's effective span, matching this station's own days (the
    // derived answer): the timeline's clipping is a no-op until a stored day
    // moves the span (owner 2026-10-13).
    routeStartDate: "2031-05-02T00:00:00.000Z",
    routeEndDate: "2031-05-04T00:00:00.000Z",
    routeOrderIdx: 0,
    state: "free",
    nights: 2,
    times: { start: dayAt("2031-05-02"), end: dayAt("2031-05-04") },
    ...over,
  };
}
