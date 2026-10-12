import { useEffect, useState } from "react";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import type { RoadtripSummary } from "../../types/roadtrip";

/**
 * The roadtrips a journey holds, for the journey's overview.
 *
 * The list endpoint answers the user's roadtrips with the span, the driven
 * distance and the station count the chain prints — the same rows the
 * roadtrips list page reads; the filter to the journey is the row's own
 * `tripId`. The per-journey `/trips/:id/routes` shape carries no dates, so it
 * cannot head a node; the legs and stops this payload adds are the ones the
 * itinerary list's cards already draw.
 *
 * Empty while loading, when the domain is off, and when the call fails — the
 * overview lists what it has and says nothing about what it could not ask, the
 * same way it treats every other linked entry.
 */
export function useTripRoadtrips(tripId: string, enabled: boolean): RoadtripSummary[] {
  const [rows, setRows] = useState<RoadtripSummary[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let cancelled = false;
    roadtripsApi
      .list()
      .then((routes) => !cancelled && setRows(routes.filter((r) => r.tripId === tripId)))
      .catch((err: unknown) => logger.warn("Loading a trip's roadtrips failed", err));
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);
  return rows;
}
