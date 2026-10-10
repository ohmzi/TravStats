import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { Switch } from "../../ui/Field";
import { useExistingDiff } from "./ExistingDiffContext";

/** A re-sync with few changes reads as a short diff: unchanged rows collapse, and this brings them back. */
export default function ShowUnchangedToggle(): JSX.Element | null {
  const { active, unchangedCount, showUnchanged, setShowUnchanged } = useExistingDiff();
  const { t } = useTranslation(["tripBuilder"]);
  if (!active || unchangedCount === 0) return null;
  return (
    <Switch
      id="resync-show-unchanged"
      label={t("tripBuilder:existing.showUnchanged", { count: unchangedCount })}
      checked={showUnchanged}
      onChange={setShowUnchanged}
    />
  );
}
