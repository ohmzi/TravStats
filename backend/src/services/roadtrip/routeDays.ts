import { AppError } from "../../middleware/errorHandler";
import { TRIP_DATE_ORDER_MESSAGE, tripDatesInOrder } from "../../schemas/trip";
import { dayColumn, storedDay } from "../tripSuggestions/time";

/**
 * The trip's OWN days (owner 2026-10-13): `trip_routes.start_day`/`end_day`,
 * the journey's convention one level down (ADR 0002 — a DATE, "YYYY-MM-DD"
 * across every boundary). The editor's Dates section writes them; a re-sync
 * commit writes the review's chosen window. Clearing one side returns that
 * side to the stations' derivation (`spanOf`), so the pair is never required.
 *
 * Mirrors `services/tour/tourDay.ts`: the PATCH body carries calendar days,
 * the columns are UTC-midnight Dates, and only a roadtrip owns a pair — a day
 * tour's own day is its `tourDate`.
 */

export interface RouteDaysInput {
  /** `YYYY-MM-DD`; null clears that side (the stations' span answers again). */
  startDay?: string | null;
  endDay?: string | null;
}

export interface RouteDayColumns {
  startDay?: Date | null;
  endDay?: Date | null;
}

export interface StoredRouteDays {
  startDay: Date | null;
  endDay: Date | null;
}

const refuse = (message: string): AppError => new AppError(message, 400, "VALIDATION_FAILED");

/**
 * The columns a PATCH body writes. `undefined` means "not sent" and leaves the
 * stored day alone; an explicit null clears it. A non-roadtrip refuses, the
 * way a roadtrip refuses a `tourDate` — the pair is this row kind's own.
 */
export function routeDaysColumns(input: RouteDaysInput, kind: string): RouteDayColumns {
  if (input.startDay === undefined && input.endDay === undefined) return {};
  if (kind !== "roadtrip") throw refuse("Only a roadtrip carries its own dates");
  const columns: RouteDayColumns = {};
  if (input.startDay !== undefined) {
    columns.startDay = input.startDay === null ? null : dayColumn(input.startDay);
  }
  if (input.endDay !== undefined) {
    columns.endDay = input.endDay === null ? null : dayColumn(input.endDay);
  }
  return columns;
}

/**
 * The span the update would LEAVE BEHIND is judged, not the days it happens to
 * carry — the journey's own rule (`services/trip/tripDateOrder.ts`,
 * SRV-TRIP-DATE-001): a PATCH that moves only the end before a stored start
 * would otherwise answer 200 and store a trip ending before it began. One
 * side unknown leaves the span unjudgeable, as there.
 */
export function assertMergedRouteDays(patch: RouteDayColumns, existing: StoredRouteDays): void {
  const startDay = patch.startDay !== undefined ? patch.startDay : existing.startDay;
  const endDay = patch.endDay !== undefined ? patch.endDay : existing.endDay;
  if (!tripDatesInOrder(startDay, endDay)) {
    throw new AppError(TRIP_DATE_ORDER_MESSAGE, 400);
  }
}

/** The two days as every section response carries them: "YYYY-MM-DD" or null. */
export function routeDaysDto(row: StoredRouteDays): {
  startDay: string | null;
  endDay: string | null;
} {
  return {
    startDay: row.startDay ? storedDay(row.startDay) : null,
    endDay: row.endDay ? storedDay(row.endDay) : null,
  };
}
