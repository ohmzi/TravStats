import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { Switch } from "../../ui";
import { useExistingDiff } from "./ExistingDiffContext";

/**
 * The album section of an existing trip: which album is updated, what it gains
 * and the switch that takes photos outside the trip dates out of it. The switch
 * starts on only where TravStats wrote the album, and is disabled — with the
 * scope named — when the key cannot remove.
 */
export default function AlbumSyncPanel(): JSX.Element | null {
  const { albumSync } = useExistingDiff();
  const { t } = useTranslation(["tripBuilder"]);
  if (albumSync === null) return null;
  const { sync, removeOutside, setRemoveOutside } = albumSync;
  const { removable } = sync;
  const reason = !removable.allowed
    ? t("tripBuilder:existing.album.needsScope", {
        scope: removable.missingScope ?? "albumAsset.delete",
      })
    : removable.defaultOn
      ? t("tripBuilder:existing.album.reasonCreatedByTravstats")
      : t("tripBuilder:existing.album.reasonForeign");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <p className="t-caption">{t(`tripBuilder:existing.album.target.${sync.target}`)}</p>
      <p className="t-caption">
        {t("tripBuilder:existing.album.adds", { added: sync.toAdd, already: sync.alreadyIn })}
      </p>
      {removable.count > 0 && (
        <Switch
          id="resync-remove-outside"
          label={t("tripBuilder:existing.album.removeOutside", { count: removable.count })}
          sub={reason}
          checked={removeOutside}
          disabled={!removable.allowed}
          onChange={setRemoveOutside}
        />
      )}
    </div>
  );
}
