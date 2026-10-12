import type { JSX } from "react";

import ImmichAlbumSection from "../Trips/ImmichAlbumSection";
import { albumForRoadtrip } from "../../lib/roadtrip/roadtripAlbum";
import { useTranslation } from "../../hooks/useTranslation";
import type { RoadtripDetail } from "../../types/roadtrip";

/**
 * The Gallery tab of one trip (template spec §3): ONLY the trip's own album.
 *
 * The journey's Gallery tab (`components/Trips/TripGallery.tsx`) carries every
 * linked album — that is the journey's scope and stays. A trip's album hangs
 * off the journey row too (the trip builder links it there), so the trip
 * resolves WHICH one is its own from the stored names (`albumForRoadtrip`, the
 * same call the figures band's album cell makes — owner-reported 2026-10-12)
 * and renders that one section and only it. A trip whose name matches no
 * naming pair keeps the documented fallback, the journey's first album
 * (roadtripAlbum.ts); a journey with no linked album, or a detached trip that
 * has no journey at all, draws the honest sentence instead of an empty grid.
 */
export default function RoadtripGallery({
  detail,
  onChanged,
}: {
  detail: RoadtripDetail;
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const journey = detail.trip;
  const album = journey ? albumForRoadtrip(journey, detail.roadtrip.name) : null;

  if (journey === null || album === null) {
    return (
      <p className="t-caption">
        {journey === null
          ? t("roadtrips:detail.gallery.detached")
          : t("roadtrips:detail.gallery.empty")}
      </p>
    );
  }

  // The JOURNEY's id, not the roadtrip's: the link row hangs off the trip
  // (the album belongs to the journey, a roadtrip can move between trips),
  // and every album call is `/trips/:id/immich/...`.
  return <ImmichAlbumSection tripId={journey.id} album={album} onChanged={onChanged} />;
}
