import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { AlbumCapabilityReason } from "../../../types/tripBuilder";
import EmptyState from "../../ui/EmptyState";
import { Switch } from "../../ui/Field";
import type { ImmichBuild } from "./useImmichBuild";

/** Where Immich is connected. Opened in a NEW tab, so the half-filled form stays where it is. */
export const IMMICH_SETTINGS_PATH = "/settings/services?section=externalServices";

/** The sentence for an album the account cannot create, by the reason the server names. */
const ALBUM_BLOCKED_KEY: Record<AlbumCapabilityReason, string> = {
  notConfigured: "tripBuilder:popup.album.blockedNotConfigured",
  sharedConnection: "tripBuilder:popup.album.blockedShared",
  missingScopes: "tripBuilder:popup.album.blockedScopes",
  unverified: "tripBuilder:popup.album.blockedScopes",
};

/**
 * The create-trip popup's two Immich switches (spec 2026-10-09 §G): "Inspect
 * Immich" and "Create album in Immich", visible and off. The state and the
 * capability check live in `useImmichBuild`; this draws them.
 *
 * Nothing is asked of the server until a switch goes on, so the existing
 * TripModal, DomainImportPanel and tripManualEntry tests, which never flip,
 * stay network-free. What the answer forbids is switched off again with the
 * reason beside it.
 */
export default function TripImmichOptions({ build }: { build: ImmichBuild }): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const { options, flip, check, scanning, issue } = build;

  const caps = check.phase === "ready" ? check.caps : null;
  const missingScopes =
    caps !== null && caps.immich.inspect.ok === false ? caps.immich.inspect.missingScopes : null;
  const albumBlocked = caps !== null && caps.immich.album.canCreate === false;
  const unverified =
    scanning &&
    caps !== null &&
    (caps.immich.inspect.ok === null || caps.immich.album.canCreate === null);

  return (
    <div
      className="space-y-2 rounded-lg p-3"
      style={{ border: "1px solid var(--color-border)" }}
      data-testid="trip-immich-options"
    >
      <div
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {t("tripBuilder:popup.heading")}
      </div>
      <Switch
        checked={options.inspect}
        onChange={(on) => flip("inspect", on)}
        label={t("tripBuilder:popup.inspect.label")}
        sub={t("tripBuilder:popup.inspect.sub")}
        disabled={missingScopes !== null}
      />
      <Switch
        checked={options.createAlbum}
        onChange={(on) => flip("createAlbum", on)}
        label={t("tripBuilder:popup.album.label")}
        sub={
          caps !== null && albumBlocked
            ? t(ALBUM_BLOCKED_KEY[caps.immich.album.reason ?? "missingScopes"])
            : t("tripBuilder:popup.album.sub")
        }
        disabled={missingScopes !== null || albumBlocked}
      />

      {check.phase === "loading" && (
        <p role="status" className="t-caption">
          {t("tripBuilder:popup.checking")}
        </p>
      )}
      {check.phase === "failed" && (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {t("tripBuilder:popup.checkFailed")}
        </p>
      )}
      {check.phase === "unpaired" && (
        <EmptyState
          kind="unpaired"
          title={t("tripBuilder:popup.unpaired.title")}
          description={t("tripBuilder:popup.unpaired.description")}
          banner={t("tripBuilder:popup.unpaired.banner")}
          action={
            <a
              href={IMMICH_SETTINGS_PATH}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--ts-accent)", fontWeight: 600 }}
            >
              {t("tripBuilder:popup.unpaired.link")}
            </a>
          }
        />
      )}
      {missingScopes !== null && (
        <div className="space-y-1">
          <p className="t-caption">{t("tripBuilder:popup.scopesMissing")}</p>
          <p className="flex flex-wrap gap-1">
            {missingScopes.map((scope) => (
              <code key={scope} className="t-meta-mono">
                {scope}
              </code>
            ))}
          </p>
        </div>
      )}
      {unverified && <p className="t-caption">{t("tripBuilder:popup.unverified")}</p>}
      {caps !== null && !caps.roadtrips && options.inspect && (
        <p className="t-caption">{t("tripBuilder:popup.roadtripsOff")}</p>
      )}
      {scanning && <p className="t-caption">{t("tripBuilder:popup.coverLater")}</p>}
      {issue === "missing" && (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {t("tripBuilder:popup.needDates")}
        </p>
      )}
      {issue === "tooLong" && (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {t("tripBuilder:popup.tooLong")}
        </p>
      )}
    </div>
  );
}
