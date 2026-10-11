import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { BuilderLegMode, DraftLeg, FerryEvidence } from "../../../types/tripBuilder";
import Pill from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";

const EVIDENCE: Record<FerryEvidence, string> = {
  router: "tripBuilder:review.leg.evidence.router",
  seaPhotos: "tripBuilder:review.leg.evidence.seaPhotos",
  chip: "tripBuilder:review.leg.evidence.chip",
};

interface ReviewLegRowProps {
  leg: DraftLeg;
  fromTitle: string;
  toTitle: string;
  onMode: (mode: BuilderLegMode) => void;
}

/**
 * The way between two stations: how far, and whether it was a road or a ferry.
 * The distance is the routed one when the scan had a route, else the straight
 * line, and says which. Why a leg is a ferry (or may be) is a chip; it never
 * changes the mode by itself.
 *
 * On a re-sync the toggle starts on the mode the trip stores, because the
 * commit leaves a stored leg alone unless the reviewed mode differs from it —
 * so the derivation the scan made (when it made a different one) is a changed
 * pill, not the toggle's value.
 */
export default function ReviewLegRow({
  leg,
  fromTitle,
  toTitle,
  onMode,
}: ReviewLegRowProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const routed = leg.routedKm !== null;
  const scanDiffers = leg.derivedMode !== undefined && leg.derivedMode !== leg.mode;
  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: "var(--ts-space-md)",
        padding: "var(--ts-space-sm) 0 var(--ts-space-sm) var(--ts-space-xl)",
        borderLeft: "2px dashed var(--ts-border)",
      }}
    >
      <span className="t-caption">
        {t("tripBuilder:review.leg.between", { from: fromTitle, to: toTitle })}
      </span>
      <span className="t-meta-mono">
        {t(routed ? "tripBuilder:review.leg.routed" : "tripBuilder:review.leg.chord", {
          km: Math.round(leg.routedKm ?? leg.chordKm),
        })}
      </span>
      <Segmented<BuilderLegMode>
        label={t("tripBuilder:review.leg.mode")}
        value={leg.mode}
        options={[
          { value: "road", label: t("tripBuilder:review.leg.road") },
          { value: "ferry", label: t("tripBuilder:review.leg.ferry") },
        ]}
        onChange={onMode}
      />
      {scanDiffers && (
        <Pill color="var(--ts-warn)">{t("tripBuilder:existing.status.changed")}</Pill>
      )}
      {leg.ferryEvidence !== null && (
        <Pill color="var(--ts-info)">{t(EVIDENCE[leg.ferryEvidence])}</Pill>
      )}
    </div>
  );
}
