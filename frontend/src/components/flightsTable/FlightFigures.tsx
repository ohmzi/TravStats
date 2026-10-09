import type { JSX } from "react";

import FigureBand, { type FigureBandCell } from "../ui/FigureBand";
import type { Flight } from "../../types";

/**
 * A single flight's numbers as a band, in the roadtrip page's furniture (owner,
 * 2026-10-08: "match the flight page to the road trip page"). The band itself
 * is `FigureBand`, shared with the roadtrip band and the flight journey's band
 * so none of the three can drift; what is left here is the single-flight
 * page's own shape.
 *
 * `FigureBand` is handed no `columns`, so its grid follows the CELL COUNT
 * rather than breakpoints — a single flight may show anywhere from two figures
 * to six, and no one cadence holds for that. The count-derived grid used to
 * live here beside a `responsive` breakpoint grid the journey band borrowed
 * through this component; the journey band now takes its breakpoints straight
 * from `FigureBand`, and this wrapper no longer has to serve two masters.
 *
 * A single flight keeps its own caller's rule — a cell is LEFT OUT when its
 * value is unknown rather than drawn as a dash — which is the page's choice:
 * `FlightDetailPage` builds only the cells it can fill. The journey band
 * opposite draws dashes with reasons instead, because a journey always has the
 * cell and may simply not know its value. Both are the band being handed cells;
 * the band itself hides nothing it is given.
 */
export type FlightFigure = FigureBandCell & { value: string };

export default function FlightFigures({
  figures,
}: {
  figures: readonly FigureBandCell[];
}): JSX.Element | null {
  return <FigureBand cells={figures} />;
}

/** The airline and number, "AC8946 · Air Canada" — the band's own heading. */
export function flightTitle(flight: Pick<Flight, "airline" | "flightNumber">): string {
  return [flight.flightNumber, flight.airline].filter(Boolean).join(" · ");
}
