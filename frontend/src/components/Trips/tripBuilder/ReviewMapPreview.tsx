import { lazy, Suspense, useMemo, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { DETAIL_MAP_BOX_RADIUS } from "../../../lib/detailChrome";
import type { ReviewState } from "../../../lib/tripBuilder/draftEdits";
import { previewGeometry, previewStations } from "../../../lib/tripBuilder/reviewView";
import type { TripMapContent } from "../TripMap";

// The map is heavy (deck.gl, maplibre): it is fetched when a review has a route to draw.
const TripMap = lazy(() => import("../TripMap"));

/**
 * The route as the review has it now, on the app's own map: a marker per
 * station and a straight line per leg, dashed because none is routed yet. It
 * follows every edit; an area that is not saved is not drawn.
 */
export default function ReviewMapPreview({ state }: { state: ReviewState }): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const stations = useMemo(() => previewStations(state), [state.areas]);
  const content = useMemo<TripMapContent>(
    () => ({
      stops: stations.map((station) => ({
        title: station.title,
        lat: station.lat,
        lon: station.lon,
        domain: "roadtrip" as const,
      })),
      emptyKey: "tripBuilder:review.map.empty",
    }),
    [stations]
  );
  const geometries = useMemo(
    () => [
      {
        routeId: "trip-builder-preview",
        name: t("tripBuilder:review.map.title"),
        geometry: previewGeometry(state),
      },
    ],
    [state.areas, t]
  );
  if (stations.length === 0) return null;

  return (
    <div
      data-testid="review-map"
      className="overflow-hidden"
      style={{
        borderRadius: DETAIL_MAP_BOX_RADIUS,
        border: "1px solid var(--ts-border)",
        height: "min(640px, calc(100vh - 96px))",
        minHeight: 380,
      }}
    >
      <Suspense
        fallback={
          <div role="status" className="t-caption" style={{ padding: "var(--ts-space-xl)" }}>
            {t("tripBuilder:review.map.loading")}
          </div>
        }
      >
        <TripMap trip={content} tourGeometries={geometries} />
      </Suspense>
    </div>
  );
}
