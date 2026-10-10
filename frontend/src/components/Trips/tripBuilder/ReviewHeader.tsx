import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { TripBuilderDraft } from "../../../types/tripBuilder";
import Button from "../../ui/Button";
import { Field, Input } from "../../ui/Field";
import Pill from "../../ui/Pill";
import CountryChips from "./CountryChips";

interface ReviewHeaderProps {
  draft: TripBuilderDraft;
  tripName: string;
  countries: readonly string[];
  /** Nights nobody has answered yet. */
  unknownNights: number;
  /** Set after a re-scan: how many of the user's edits the new draft could take. */
  carried: { kept: number; total: number } | null;
  onTripName: (name: string) => void;
  onCountries: (countries: string[]) => void;
  /** Opens the dialog that scans again for other dates. */
  onChangeDates: () => void;
}

/**
 * The trip as the review has it: its name (editable for a new trip, the saved
 * name for an existing one), its dates with "Change dates…", its countries, and
 * the notes about the work so far: nights still open, edits carried over. The
 * page owns the dialog the button opens, so the empty-window screen can open it
 * too.
 */
export default function ReviewHeader({
  draft,
  tripName,
  countries,
  unknownNights,
  carried,
  onTripName,
  onCountries,
  onChangeDates,
}: ReviewHeaderProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const { startDay, endDay } = draft.window;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      {draft.target.kind === "new" ? (
        <Field label={t("tripBuilder:review.header.name")} htmlFor="builder-trip-name">
          <Input
            id="builder-trip-name"
            value={tripName}
            maxLength={200}
            onChange={(event) => onTripName(event.target.value)}
          />
        </Field>
      ) : (
        <div className="flex flex-col" style={{ gap: 2 }}>
          <span className="t-caption">{t("tripBuilder:review.header.existingTrip")}</span>
          <strong style={{ fontSize: 18, color: "var(--ts-text-bright)" }}>{tripName}</strong>
        </div>
      )}

      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <span style={{ fontWeight: 600 }}>
          {`${fmt.localDate(startDay)} – ${fmt.localDate(endDay)}`}
        </span>
        <Button onClick={onChangeDates}>{t("tripBuilder:review.header.changeDates")}</Button>
        {unknownNights > 0 && (
          <Pill color="var(--ts-warn)">
            {t("tripBuilder:review.header.unknownNights", { count: unknownNights })}
          </Pill>
        )}
      </div>

      <CountryChips countries={countries} onChange={onCountries} />

      {carried !== null && (
        <p role="status" className="t-caption">
          {t("tripBuilder:review.header.carried", { kept: carried.kept, total: carried.total })}
        </p>
      )}
    </div>
  );
}
