/**
 * After a trip edit is saved: its Immich album and roadtrip stations were built
 * for the old dates, so a moved date offers the re-sync (spec 2026-10-09 §K.1).
 *
 * The check and the offer live here rather than in TripModal: the modal is
 * deliberately built without a router in many tests and must not grow.
 */
import { dayOf } from "../../../lib/tripForDate";
import type { ToastAction, ToastType } from "../../../store/toastStore";
import type { Trip } from "../../../types";

/** The toast store's `addToast`, passed in so this module stays store-free. */
type AddToast = (type: ToastType, message: string, duration?: number, action?: ToastAction) => void;

export interface ResyncOfferInput {
  /** The trip as it was before this save; null while creating one. */
  trip: Pick<Trip, "startDate" | "endDate"> | null;
  /** The id the save returned — an update may answer with a fresh row. */
  tripId: string;
  /** What the form's date inputs hold (`YYYY-MM-DD`, `""` when empty). */
  startDate: string;
  endDate: string;
  addToast: AddToast;
  t: (key: string) => string;
}

/** Offers the re-sync when an edit moved the trip's dates; says nothing otherwise. */
export function offerResync(input: ResyncOfferInput): void {
  const { trip, tripId, startDate, endDate, addToast, t } = input;
  if (trip === null || !startDate || !endDate) return;
  if (startDate === dayOf(trip.startDate) && endDate === dayOf(trip.endDate)) return;
  addToast("info", t("tripBuilder:resync.datesChanged"), 15_000, {
    label: t("tripBuilder:resync.action"),
    to: `/trips/${tripId}/resync`,
  });
}
