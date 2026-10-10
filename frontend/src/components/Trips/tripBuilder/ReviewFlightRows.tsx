import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { DraftFlight } from "../../../types/tripBuilder";
import { Switch } from "../../ui/Field";
import Pill from "../../ui/Pill";
import ReviewSection from "./ReviewSection";

interface ReviewFlightRowsProps {
  flights: readonly DraftFlight[];
  ticks: Readonly<Record<string, boolean>>;
  onTick: (flightId: string, ticked: boolean) => void;
}

/**
 * The flights the scan lists for the trip's dates. Each is ticked to be filed on
 * the trip. A flight that belongs to another trip starts unticked and says so;
 * one already on this trip is ticked and stays.
 */
export default function ReviewFlightRows({
  flights,
  ticks,
  onTick,
}: ReviewFlightRowsProps): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  if (flights.length === 0) return null;

  const when = (local: string): string =>
    local.length > 10
      ? `${fmt.localDate(local)} ${fmt.localClock(local.slice(11))}`
      : fmt.localDate(local);

  return (
    <ReviewSection
      title={t("tripBuilder:review.flights.title")}
      aside={t("tripBuilder:review.flights.hint")}
    >
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        {flights.map((flight) => (
          <li key={flight.id}>
            <Switch
              id={`flight-${flight.id}`}
              label={flight.label}
              sub={
                <span className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
                  <span>{`${when(flight.depLocal)} → ${when(flight.arrLocal)}`}</span>
                  {!flight.precise && <span>{t("tripBuilder:review.flights.approximate")}</span>}
                  {flight.currentTrip !== null && (
                    <Pill color="var(--ts-warn)">
                      {t("tripBuilder:review.flights.currentTrip", {
                        trip: flight.currentTrip.name,
                      })}
                    </Pill>
                  )}
                  {flight.locked && <span>{t("tripBuilder:review.flights.locked")}</span>}
                  {flight.layover !== undefined && (
                    <span>
                      {t("tripBuilder:review.flights.layover", {
                        count: flight.layover.photoCount,
                        airport: flight.layover.airportIata ?? "",
                      })}
                    </span>
                  )}
                </span>
              }
              checked={flight.locked || ticks[flight.id] === true}
              disabled={flight.locked}
              onChange={(ticked) => onTick(flight.id, ticked)}
            />
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}
