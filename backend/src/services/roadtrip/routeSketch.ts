/**
 * The polyline a roadtrip's card draws.
 *
 * The list used to sketch the STATIONS alone, joined in order — which reads as
 * a rough polygon rather than a route: a short drive came out a single
 * straight line and a long trip a triangle. The routed shape was already in
 * the database (`TripRouteLeg.waypoints`, GeoJSON `[lon, lat]`) and simply was
 * never asked for.
 *
 * This walks the stations in travel order, takes the leg between each
 * consecutive pair, and falls back to that pair's own endpoints where the leg
 * carries no waypoints — a straight chord, or a leg whose routing never ran.
 * A station without coordinates breaks the line rather than silently joining
 * across the gap.
 *
 * SIMPLIFIED before it leaves: a routed road leg holds thousands of points and
 * one journey alone carries roughly thirty thousand across its legs, which has
 * no business in a LIST response for every card on the page. Ramer-Douglas-
 * Peucker at a tolerance finer than the card can resolve keeps the shape and
 * drops the rest.
 */

export type LonLat = [number, number];

/**
 * Perpendicular distance from `p` to the segment `a`-`b`, in degrees — the
 * same unit as the input, which is all RDP needs since it compares distances
 * against one tolerance.
 */
function perpendicularDistance(p: LonLat, a: LonLat, b: LonLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer-Douglas-Peucker. Iterative rather than recursive on purpose: the input
 * can be tens of thousands of points, and a recursive form puts that depth on
 * the stack.
 */
export function simplifyPath(points: ReadonlyArray<LonLat>, tolerance: number): LonLat[] {
  if (points.length <= 2) {
    return points.map((p) => [p[0], p[1]]);
  }

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let furthest = -1;
    let furthestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > furthestDistance) {
        furthest = i;
        furthestDistance = distance;
      }
    }
    if (furthest > 0) {
      keep[furthest] = true;
      stack.push([first, furthest], [furthest, last]);
    }
  }

  return points.filter((_, i) => keep[i]).map((p) => [p[0], p[1]]);
}

/** Just enough of a station row to place it in the line. */
export interface SketchStation {
  id: string;
  lat: number | null;
  lon: number | null;
}

/** Just enough of a leg row to draw the way between two stations. */
export interface SketchLeg {
  fromStopId: string;
  toStopId: string;
  waypoints: unknown;
}

/** A leg's stored waypoints, when they are a usable `[lon, lat]` list. */
function legWaypoints(leg: SketchLeg | undefined): LonLat[] | null {
  const raw = leg?.waypoints;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: LonLat[] = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    out.push([lon as number, lat as number]);
  }
  return out;
}

/**
 * The travelled line through a roadtrip's stations, simplified.
 *
 * `toleranceDeg` is in degrees and defaults to about a kilometre at these
 * latitudes — far finer than a 320-pixel card can show, so the simplification
 * is invisible there while the payload stays in the hundreds of points.
 */
export function roadtripSketchPath(
  stations: ReadonlyArray<SketchStation>,
  legs: ReadonlyArray<SketchLeg>,
  toleranceDeg = 0.01
): LonLat[] {
  const byPair = new Map<string, SketchLeg>();
  for (const leg of legs) {
    byPair.set(`${leg.fromStopId}|${leg.toStopId}`, leg);
  }

  const placed = stations.filter((s) => s.lat !== null && s.lon !== null);
  const path: LonLat[] = [];
  for (let i = 0; i < placed.length; i++) {
    const from = placed[i];
    if (i === 0) {
      path.push([from.lon!, from.lat!]);
    }
    const to = placed[i + 1];
    if (!to) break;
    const waypoints = legWaypoints(byPair.get(`${from.id}|${to.id}`));
    // The leg's own line when there is one — it starts and ends at the two
    // stations, so neither endpoint needs adding — and the chord when there
    // is not.
    const segment = waypoints ?? [[from.lon!, from.lat!], [to.lon!, to.lat!]] as LonLat[];
    for (const point of segment) {
      const last = path[path.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) {
        path.push(point);
      }
    }
  }

  return simplifyPath(path, toleranceDeg);
}
