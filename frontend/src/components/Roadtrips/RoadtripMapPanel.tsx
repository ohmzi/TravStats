import { useMemo } from "react";
import type { JSX } from "react";

import TripMap, { type TripMapContent } from "../Trips/TripMap";
import { stationHighlightLayer } from "./stationHighlightLayer";
import { useDomainColors } from "../../hooks/useDomainColors";
import { hexToRgb } from "../../lib/domainColor";
import type { RoadtripDetail, RoadtripStation } from "../../types/roadtrip";
import type { TourGeometry } from "../../types/tour";

/**
 * A roadtrip's map — its stations and, when the routing pass stored one, its
 * travelled line — as the overview's aside and the Map tab both draw it. One
 * panel for the two, so the map tab and the aside cannot drift apart; the
 * station the chain selected is ringed by the extra layer the caller hands in,
 * and the Map tab has no chain and hands none.
 */
export default function RoadtripMapPanel({
  detail,
  geometry,
  selected = null,
}: {
  detail: RoadtripDetail;
  /** The line the geometry endpoint returned; null while it is unread. */
  geometry: TourGeometry | null;
  /** The chain's selected station, ringed on the map. */
  selected?: RoadtripStation | null;
}): JSX.Element {
  const roadtripColor = useDomainColors().colorOf("roadtrip");

  const mapContent = useMemo<TripMapContent>(
    () => ({
      // Route corrections shape the line only; they are no station marker.
      stops: detail.stations
        .filter((s) => s.state !== "via")
        .map((s) => ({
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          // A night at a stay is drawn in the stay's colour, everything else in
          // the roadtrip's — the same split the markers make.
          domain: s.state === "stay" ? "hotel" : "roadtrip",
        })),
      emptyKey: "roadtrips:map.empty",
    }),
    [detail]
  );
  const mapGeometries = useMemo(
    () =>
      geometry
        ? [
            {
              routeId: detail.roadtrip.id,
              name: detail.roadtrip.name,
              geometry,
              rgb: hexToRgb(roadtripColor),
            },
          ]
        : [],
    [geometry, detail, roadtripColor]
  );
  const highlight = useMemo(
    () =>
      stationHighlightLayer(
        selected && selected.lat !== null && selected.lon !== null
          ? { lat: selected.lat, lon: selected.lon }
          : null
      ),
    [selected]
  );

  return <TripMap trip={mapContent} tourGeometries={mapGeometries} extraLayers={highlight} />;
}
