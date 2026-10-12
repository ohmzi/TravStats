import type { JSX } from "react";

import RoadtripCostsSection from "./RoadtripCostsSection";
import RoadtripTourCards from "./RoadtripTourCards";
import { RoadtripRailConversion } from "../rail/RoadtripRailConversion";
import { useTranslation } from "../../hooks/useTranslation";
import type { RoadtripDetail } from "../../types/roadtrip";

/**
 * The Logistics tab of one trip (template spec §3): everything the roadtrip
 * page carried besides its chain and map — the day tours and their recordings,
 * the rail conversion for a roadtrip stored by rail, and the costs — moved
 * under the tab that now owns them.
 *
 * The journey's own Logistics tab (the linked flights, cruises, stays, rail
 * journeys, rentals and bookings) stays where it is; this is the trip's own.
 * The editor, the leg dialog and the map stay on the Overview: they change
 * the chain, not the logistics.
 */
export default function RoadtripLogisticsTab({
  detail,
  onChanged,
}: {
  detail: RoadtripDetail;
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const r = detail.roadtrip;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <section className="flex flex-col" style={{ gap: 14 }}>
        <h2 className="t-card-title">{t("roadtrips:detail.toursTitle")}</h2>
        <RoadtripTourCards tours={detail.tours} stations={detail.stations} />
      </section>

      {/* A roadtrip stored by rail, from before rail was a domain (rail beta). */}
      <RoadtripRailConversion routeId={r.id} vehicle={r.vehicle} onConverted={onChanged} />

      <RoadtripCostsSection
        roadtripId={r.id}
        stations={detail.stations}
        expenses={detail.expenses}
        costs={detail.costs}
        onChanged={onChanged}
      />
    </div>
  );
}
