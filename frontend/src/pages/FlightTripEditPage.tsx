import type { JSX } from "react";

import TripEditPage from "./TripEditPage";

/**
 * `/flights/journeys/:id/edit` — the flight trip's edit page (owner,
 * 2026-10-15), which used to be `TripModal` over the flight-trip page. One
 * line on purpose: the form is the journey's form, so the two pages can never
 * disagree about a field; `TripEditPage`'s context gives it the flight trip's
 * title and its own places to land.
 *
 * Those places are not all the flight trip, and saying "every exit" was wrong:
 * Back, Cancel and Save return to `/flights/journeys/:id`, and a delete or a
 * failed load goes to `/flights` — the logbook the flight-trip page's own back
 * link points at. Re-sync is the third case: it opens the journey's
 * `/trips/:id/resync` in either context, because that page owns the Immich
 * flow and the journey links to it as well.
 */
export default function FlightTripEditPage(): JSX.Element {
  return <TripEditPage context="flightTrip" />;
}
