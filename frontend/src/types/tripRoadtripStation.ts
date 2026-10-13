/**
 * A roadtrip station shown on its trip's timeline (spec 2026-10-09 §E): one
 * row of `roadtripStations` on `GET /trips/:id`, from
 * `backend/src/services/trips/tripRoadtripStations.ts`. Read-only here; the
 * station is edited on its roadtrip (`/roadtrips/:routeId`).
 */
import type { TripStopTimes } from "./times";

export interface TripRoadtripStationDto {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  /** Legacy UTC-midnight day anchors as ISO strings; read `times` first. */
  startDate: string | null;
  endDate: string | null;
  /** The stored instants and the zone they were taken in, as on a `TripStop`; `times` is built from them. */
  startUtc?: string | null;
  endUtc?: string | null;
  stopZone?: string | null;
  precision?: string | null;
  notes: string | null;
  routeId: string;
  routeName: string;
  /**
   * The trip's effective span (owner 2026-10-13): its own stored days where
   * set, its stations' earliest/latest on the sides where not — the SAME
   * answer the roadtrip's pages, the chain and the band read. The journey's
   * timeline places the trip's entries inside it.
   */
  routeStartDate?: string | null;
  routeEndDate?: string | null;
  routeOrderIdx: number | null;
  state: "stay" | "free" | "pass";
  /** This station's own nights (`countRoadtripNights`); 0 for a pass. */
  nights: number;
  times?: TripStopTimes;
}
