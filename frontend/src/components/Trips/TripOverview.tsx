import type { JSX } from "react";

import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import DetailSection from "../ui/DetailSection";
import PeopleList from "../ui/PeopleList";
import DocumentsSection from "../documents/DocumentsSection";
import JourneyTripsChain from "./JourneyTripsChain";
import TripMapWithTours from "./TripMapWithTours";
import TripSummaryPanel from "./TripSummaryPanel";

type T = ReturnType<typeof useTranslation>["t"];

/**
 * The journey's overview, in the template both levels share (spec 2026-10-12
 * §3): the trips chain, the map, then the AI summary below the map. The
 * figures table is the shell's (spec §2) and sits above the tab bar, so this
 * body does not repeat it.
 *
 * The sections the template does not re-home keep their place below it —
 * companions, tags, notes and the journey's documents have no other surface —
 * while everything that got one left this body: the roadtrips list is the
 * Trips tab, the albums the Gallery tab, the flight/cruise/stay/rail/rental
 * entries the Timeline and Logistics tabs. The days and countries tiles are
 * the figures table's cells now.
 */
export default function TripOverview({
  trip,
  t,
  language,
  onChanged,
}: {
  trip: Trip;
  t: T;
  language: string;
  onChanged: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <JourneyTripsChain tripId={trip.id} />

      <TripMapWithTours trip={trip} />

      {/* Below the map, regenerate as today (spec 2026-10-12 §3). */}
      <TripSummaryPanel trip={trip} t={t} language={language} onChanged={onChanged} />

      {(trip.companions.length > 0 || trip.tags.length > 0) && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {trip.companions.length > 0 && (
            <DetailSection title={t("trips:detail.companions")}>
              <PeopleList names={trip.companions} />
            </DetailSection>
          )}
          {trip.tags.length > 0 && (
            <DetailSection title={t("trips:detail.tags")}>
              <div className="flex flex-wrap gap-1.5">
                {trip.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border px-2.5 py-0.5 text-xs"
                    style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </DetailSection>
          )}
        </div>
      )}

      {trip.notes && (
        <DetailSection title={t("trips:detail.notes")}>
          <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ts-text)" }}>
            {trip.notes}
          </p>
        </DetailSection>
      )}

      {/* The journey's own papers, kept where they were mounted (the
          `documentsMountPoints` guard pins this surface). */}
      <DocumentsSection entry={{ type: "trip", id: trip.id }} />
    </div>
  );
}
