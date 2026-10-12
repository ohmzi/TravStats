import { useEffect, useState } from "react";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import type { RoadtripSummary } from "../../types/roadtrip";

/** What the journey's overview can say about its trips right now. */
export interface TripRoadtrips {
  /**
   * The journey's own roadtrips — the list rows whose `tripId` is the
   * journey's. Empty until the read behind `settled` has landed.
   */
  rows: RoadtripSummary[];
  /**
   * True only once a read of the roadtrips list has landed for this journey.
   * While the read is in flight, when it fails and when the roadtrip domain is
   * off it stays false, so no surface claims the journey holds no trips before
   * a successful read says so.
   */
  settled: boolean;
}

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
 * Rows are empty while the read is in flight, when the domain is off and when
 * the call fails; `settled` is what tells those states apart from a journey
 * that truly holds no roadtrips, so a failed request never reads as an empty
 * journey.
 */
export function useTripRoadtrips(tripId: string, enabled: boolean): TripRoadtrips {
  const [state, setState] = useState<TripRoadtrips>({ rows: [], settled: false });
  useEffect(() => {
    // A read starts unsettled, and rows never outlive their journey.
    setState({ rows: [], settled: false });
    if (!enabled) {
      return;
    }
    let cancelled = false;
    roadtripsApi
      .list()
      .then((routes) => {
        if (!cancelled) {
          setState({ rows: routes.filter((r) => r.tripId === tripId), settled: true });
        }
      })
      .catch((err: unknown) => logger.warn("Loading a trip's roadtrips failed", err));
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);
  return state;
}
