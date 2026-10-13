// Where the globe's activity strip sits.
//
// The strip itself (`GlobeTimeHistogram`) is only the surface; its placement
// is a band of the dashboard's phone chrome (`map/phoneChrome.ts`). On a
// desktop it is centred at the top, where it always was. At 390px that centre
// was the collision: a 300px-minimum strip centred at x=45 ran over the
// Aktivität chip on its left and under the "+ Hinzufügen" button at x=345 on
// its right (measured in Chrome, 2026-10-12). On a phone it therefore takes a
// row of its own — full width, under the Aktivität/+Add row — and the strip
// clamps what it grows into (the expanded bar row and the year axis) so it
// stays inside that row.

import type { JSX } from "react";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";
import { PHONE_STRIP_TOP } from "../map/phoneChrome";
import { GlobeTimeHistogram } from "./GlobeTimeHistogram";
import type { MonthBucket } from "./timeSliderUtils";

export interface GlobeTimeStripProps {
  buckets: MonthBucket[];
  visibleFlights: number;
  visibleCruises: number;
}

export function GlobeTimeStrip({
  buckets,
  visibleFlights,
  visibleCruises,
}: GlobeTimeStripProps): JSX.Element {
  const phone = useIsPhoneViewport();
  return (
    <div
      className={phone ? "absolute z-10" : "absolute top-3 left-1/2 z-10 -translate-x-1/2"}
      style={
        phone
          ? { left: 12, right: 12, top: PHONE_STRIP_TOP, pointerEvents: "auto" }
          : { pointerEvents: "auto" }
      }
    >
      <GlobeTimeHistogram
        buckets={buckets}
        visibleFlights={visibleFlights}
        visibleCruises={visibleCruises}
      />
    </div>
  );
}
