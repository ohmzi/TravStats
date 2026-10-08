import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import MapGL from "react-map-gl/maplibre";

import { resolveFlatStyle } from "./basemapStyles";

/**
 * A map in a card: real basemap tiles under a drawn route or flight arc.
 *
 * The card used to draw the geometry alone — a bare line on a flat background,
 * with no land to place it against, which is why a road trip read as a squiggle
 * floating in nothing. This puts the app's own basemap behind it, so the shape
 * lands somewhere.
 *
 * The overlay is SVG, NOT a MapLibre layer, and both are pinned by the same
 * projection computed here. Two reasons for not using the map's own layer
 * pipeline: the cards want no attribution control, no interaction and no
 * per-instance GL state (there is one map per card on the page), and a static
 * map whose view this module already decides needs no second source of truth
 * about where a coordinate lands. The cost is that the projection here must
 * agree with MapLibre's exactly — pitch 0, bearing 0, Web Mercator, 256px
 * tiles — which it does by construction, and the reason `zoom` is snapped to
 * nothing and never nudged afterwards.
 *
 * Static on purpose: the whole card is one click target that opens the thing
 * it depicts, and a map that swallowed drags would fight it. `interactive`
 * false is what keeps a scroll wheel over a card scrolling the page.
 */

/**
 * Cards draw on OSM.
 *
 * The dark basemaps — what the trip map and the flight-track map hardcode —
 * draw land and water in almost the same near-black, which is fine at the
 * regional zoom a road trip lives at and useless at the zoom a flight needs:
 * a long-haul flight is most of a hemisphere, so the card came out a line on
 * nothing. OSM is legible at every zoom and is the one basemap that needs no
 * key, and a card is small enough that its brighter palette does not fight the
 * page.
 *
 * The credit below is bound to this choice: OSM's own tiles, so OSM's own
 * attribution — not CARTO's, which the vector styles carry.
 */
const CARD_MAP_STYLE = resolveFlatStyle("osm");
const CARD_MAP_CREDIT = "© OpenStreetMap contributors";
/**
 * MapLibre's world is `512 * 2^zoom` CSS pixels, and every transform of its is
 * built on that. 256 is a RASTER TILE's own pixel size and has nothing to do
 * with it: a style can declare `tileSize: 256` and MapLibre still draws that
 * tile across its 512-based world, scaled 2×.
 *
 * This was 256 for both the fit and the overlay, and the symptom was exact: the
 * drawn line came out HALF the size of the same coordinates on the map beneath
 * it, so a flight's endpoints sat nowhere near its airports and every route
 * looked too short. The fit and the projection have to use the same number, or
 * they disagree by that factor.
 */
const WORLD_TILE = 512;
/** Web Mercator's own limit, so a polar coordinate cannot make the world infinite. */
const MAX_LAT = 85.05112878;

export interface CardMapLine {
  /** `[lon, lat]` in order. */
  coords: ReadonlyArray<readonly [number, number]>;
  color?: string;
  width?: number;
  /** A ferry crossing, a planned leg — a line that is not a road. */
  dashed?: boolean;
}

export interface CardMapStop {
  coord: readonly [number, number];
  color?: string;
  radius?: number;
}

/** Fraction of the world's height at latitude `lat`, measured from the north. */
function mercatorY(lat: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

/** The inverse, for turning the fitted centre back into a latitude. */
function latitudeAt(y: number): number {
  const n = Math.PI - 2 * Math.PI * Math.min(Math.max(y, 0), 1);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export default function CardMap({
  lines,
  stops = [],
  height = 120,
  padding = 14,
  stopColor = "var(--domain-roadtrip)",
  lineColor = "var(--domain-roadtrip)",
}: {
  lines: ReadonlyArray<CardMapLine>;
  stops?: ReadonlyArray<CardMapStop>;
  height?: number;
  padding?: number;
  stopColor?: string;
  lineColor?: string;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  // The map's size decides the zoom, so it has to be measured rather than
  // assumed: a card is whatever the grid gives it, and a zoom computed for the
  // wrong width would put the tiles and the SVG overlay on different scales.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = (): void => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // One map per card, each holding a GL context and fetching tiles, so a card
  // below the fold waits until it is looked at. The SVG is drawn regardless:
  // the route appears immediately and the basemap fills in under it.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const view = useMemo(() => {
    if (width <= 0) return null;
    const all = [...lines.flatMap((l) => l.coords), ...stops.map((s) => s.coord)];
    if (all.length === 0) return null;

    // Fitted in world units (0..1 of the whole map), so the fit is in the same
    // space MapLibre puts its tiles in rather than in degrees — a degree of
    // longitude is not a degree of latitude on screen.
    const xs = all.map(([lon]) => (lon + 180) / 360);
    const ys = all.map(([, lat]) => mercatorY(lat));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);

    const innerW = Math.max(1, width - 2 * padding);
    const innerH = Math.max(1, height - 2 * padding);
    const zoom = Math.log2(Math.min(innerW / (spanX * WORLD_TILE), innerH / (spanY * WORLD_TILE)));

    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    return {
      longitude: centreX * 360 - 180,
      latitude: latitudeAt(centreY),
      // A single point would ask for infinite zoom; a card is not a street map.
      zoom: Math.max(0, Math.min(14, zoom)),
    };
  }, [lines, stops, width, height, padding]);

  /** `[lon, lat]` → pixels in the box, through the SAME fit as the map above. */
  const project = useMemo(() => {
    if (!view || width <= 0) return null;
    const world = WORLD_TILE * Math.pow(2, view.zoom);
    const centreX = ((view.longitude + 180) / 360) * world;
    const centreY = mercatorY(view.latitude) * world;
    return ([lon, lat]: readonly [number, number]): [number, number] => [
      width / 2 + ((lon + 180) / 360) * world - centreX,
      height / 2 + mercatorY(lat) * world - centreY,
    ];
  }, [view, width, height]);

  return (
    <div
      ref={boxRef}
      style={{ position: "relative", height, background: "var(--ts-surface2)", overflow: "hidden" }}
    >
      {visible && view && (
        // Keyed on the fit: a resize refits, and `initialViewState` is only
        // read on mount. Tiles are cached, so the remount costs the overlay
        // and not the network.
        <MapGL
          key={`${view.longitude.toFixed(4)}|${view.latitude.toFixed(4)}|${view.zoom.toFixed(4)}`}
          reuseMaps
          initialViewState={view}
          mapStyle={CARD_MAP_STYLE}
          interactive={false}
          attributionControl={false}
          style={{ position: "absolute", inset: 0 }}
        />
      )}

      {project && (
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {lines.map((line, i) => (
            <polyline
              key={i}
              points={line.coords
                .map((c) => project(c))
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={line.color ?? lineColor}
              strokeWidth={line.width ?? 2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={line.dashed ? "5 4" : undefined}
            />
          ))}
          {stops.map((s, i) => {
            const [cx, cy] = project(s.coord);
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={s.radius ?? 2.6}
                fill={s.color ?? stopColor}
                stroke="var(--ts-surface)"
                strokeWidth={1}
              />
            );
          })}
        </svg>
      )}

      {/* The tiles are OSM data served by CARTO and their terms require the
          credit wherever they are drawn. Compact, but it has to be there — the
          map's own control is off because a card has no room for it. */}
      {visible && view && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 4,
            bottom: 2,
            fontSize: 8,
            lineHeight: 1,
            color: "var(--ts-muted)",
            opacity: 0.75,
            pointerEvents: "none",
          }}
        >
          {CARD_MAP_CREDIT}
        </span>
      )}
    </div>
  );
}
