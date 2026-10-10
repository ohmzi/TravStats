import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { StationStatus } from "../../../types/tripBuilder";
import Pill from "../../ui/Pill";
import { token } from "../../ui/tokens";

/** `same` is muted, `changed` warns, `new` informs; `notSeen` is dashed — it still needs a decision. */
const COLOR: Record<StationStatus, string> = {
  same: token("muted"),
  changed: token("warn"),
  new: token("info"),
  notSeen: token("muted"),
};

export default function StationStatusPill({ status }: { status: StationStatus }): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return (
    <Pill color={COLOR[status]} dashed={status === "notSeen"}>
      {t(`tripBuilder:existing.status.${status}`)}
    </Pill>
  );
}
