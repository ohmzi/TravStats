import type { JSX } from "react";

import TripEditPage from "./TripEditPage";

/**
 * `/flights/journeys/:id/edit` — the flight trip's edit page (owner,
 * 2026-10-15), which used to be `TripModal` over the flight-trip page. One
 * line on purpose: the form is the journey's form, so the two pages can never
 * disagree about a field; `TripEditPage`'s context gives it the flight trip's
 * title and sends every exit back to the flight trip.
 */
export default function FlightTripEditPage(): JSX.Element {
  return <TripEditPage context="flightTrip" />;
}
