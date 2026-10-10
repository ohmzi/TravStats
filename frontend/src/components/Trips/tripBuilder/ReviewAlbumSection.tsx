import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { AlbumCapabilityReason, DraftAlbum } from "../../../types/tripBuilder";
import { Field, Input, Switch } from "../../ui/Field";
import ReviewSection from "./ReviewSection";

const BLOCKED: Record<AlbumCapabilityReason, string> = {
  notConfigured: "tripBuilder:review.album.blocked.notConfigured",
  sharedConnection: "tripBuilder:review.album.blocked.sharedConnection",
  missingScopes: "tripBuilder:review.album.blocked.missingScopes",
  unverified: "tripBuilder:review.album.blocked.unverified",
};

interface ReviewAlbumSectionProps {
  album: DraftAlbum;
  value: { create: boolean; name: string };
  onChange: (create: boolean, name: string) => void;
}

/**
 * The Immich album of the trip: made (or added to, when the user already has
 * one by that name), and how many photos go in. When the key may not make
 * albums the switch is off and says why; nothing is made before "Create trip".
 */
export default function ReviewAlbumSection({
  album,
  value,
  onChange,
}: ReviewAlbumSectionProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const reason = album.blockedReason;
  const sub = !album.allowed
    ? reason !== undefined
      ? t(BLOCKED[reason], { scopes: album.missingScopes.join(", ") })
      : t(BLOCKED.unverified)
    : reason === "unverified"
      ? t(BLOCKED.unverified)
      : undefined;

  return (
    <ReviewSection
      title={t("tripBuilder:review.album.title")}
      aside={t("tripBuilder:review.album.counts", {
        count: album.assetCount,
        images: album.images,
        videos: album.videos,
      })}
    >
      <Switch
        id="album-create"
        label={t("tripBuilder:review.album.create")}
        sub={sub}
        checked={value.create}
        disabled={!album.allowed}
        onChange={(create) => onChange(create, value.name)}
      />
      {value.create && (
        <Field label={t("tripBuilder:review.album.name")} htmlFor="album-name">
          <Input
            id="album-name"
            value={value.name}
            maxLength={200}
            onChange={(event) => onChange(true, event.target.value)}
          />
        </Field>
      )}
      {album.existing !== null && (
        <span className="t-caption">
          {t("tripBuilder:review.album.existing", {
            name: album.name,
            count: album.existing.assetCount,
          })}
        </span>
      )}
      {album.existing?.linkedTripName !== undefined && (
        <span className="t-caption" role="note" style={{ color: "var(--ts-warn)" }}>
          {t("tripBuilder:review.album.linkedElsewhere", { trip: album.existing.linkedTripName })}
        </span>
      )}
      {album.assetCount === 0 && (
        <span className="t-caption">{t("tripBuilder:review.album.empty")}</span>
      )}
    </ReviewSection>
  );
}
