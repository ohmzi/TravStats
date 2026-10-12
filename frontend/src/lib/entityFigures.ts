import { inclusiveDaysBetween, type LocalDateValue } from "../shared/time";

/**
 * The folds the shared template's figures table is made of (design 2026-10-12
 * §2), so the rules can be tested without rendering a band — and so the journey
 * and the trip read the SAME rule for the two cells they share.
 *
 * THE DAYS ARE THE 2026-10-11 CONVENTION (owner): the two own dates' INCLUSIVE
 * span — five nights away, leaving on the 1st and home on the 6th, is six days
 * — with `≈` exactly while the span is only a bound on the days (`roadtripDays`
 * in `lib/roadtrip/roadtripView.ts` and `journeyDays` in
 * `lib/flights/journeyFigures.ts` are the level's own folds of the same
 * convention). Here the marker rides the DATE'S OWN precision: a day column the
 * backfill could not place (`LocalDateValue.precision` `"unknown"`, the
 * ambiguous legacy anchor of `shared/time/legacyValues.ts`) or a month/year is
 * not a day, so the span computed from it is approximate and says so. An exact
 * end never wears the marker.
 *
 * THE KILOMETRES ARE THE SUM OF WHAT IS STORED, with no derivation of its own:
 * a roadtrip row's `drivenKm` is the backend's allow-list total over its road
 * legs (`services/tour/tourDistance.ts`), so the journey's Km figure and the
 * trips it is made of cannot disagree about the same kilometres.
 */

/** The one field the Km figure needs — narrow on purpose, so any roadtrip row fits. */
export interface DrivenKms {
  drivenKm: number;
}

/** The sum of the rows' stored driven km (design §2: the journey's Km). */
export function roadtripsDrivenKm(roadtrips: readonly DrivenKms[]): number {
  return roadtrips.reduce((sum, roadtrip) => sum + roadtrip.drivenKm, 0);
}

/** A days figure of an entity's own two dates, and whether it is only a bound. */
export interface EntityDays {
  days: number;
  /** True while an end is not known to its day — the band's `≈`. */
  approximate: boolean;
}

/**
 * The days figure of an entity's own from–to dates: both ends counted, `null`
 * when either is missing (no honest number, so the band draws no Days cell at
 * all), `approximate` while either end is coarser than a day.
 */
export function ownDatesDays(
  start: LocalDateValue | null,
  end: LocalDateValue | null
): EntityDays | null {
  if (start === null || end === null) return null;
  return {
    days: inclusiveDaysBetween(start.date, end.date),
    approximate: start.precision !== "day" || end.precision !== "day",
  };
}
