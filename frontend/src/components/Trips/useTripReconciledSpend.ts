import { useEffect, useState } from "react";

import { expensesApi } from "../../lib/api/expenses";
import { logger } from "../../lib/logger";
import { readTripReconciliation, type TripReconciliation } from "../../lib/reconcilerNote";

/**
 * What the host trip-reconciler booked on a trip, for the overview's "Paid
 * from your accounts" card. Null while loading, when the trip carries no
 * reconciler rows, and when the call fails — the same contract as
 * `useTripRoadtrips`: the overview shows what it has and says nothing about
 * what it could not ask. Here that is also the only honest choice: most trips
 * never see the reconciler, so a failure line would stand on every one of them
 * for a card that would not have been drawn. The cost tile above it does not
 * depend on this call.
 */
export function useTripReconciledSpend(tripId: string): TripReconciliation | null {
  const [reconciliation, setReconciliation] = useState<TripReconciliation | null>(null);
  useEffect(() => {
    setReconciliation(null);
    let cancelled = false;
    expensesApi
      .listForTrip(tripId)
      .then(
        ({ expenses }) => !cancelled && setReconciliation(readTripReconciliation(expenses, tripId))
      )
      .catch((err: unknown) => logger.warn("Loading a trip's reconciled spend failed", err));
    return () => {
      cancelled = true;
    };
  }, [tripId]);
  return reconciliation;
}
