/**
 * City clusters (spec 2026-10-09 §C.5): the places a trip stood in.
 *
 * Single linkage, the owner's accepted recipe: two located photos closer than
 * `CITY_LINK_KM` are one place, and so is everything a chain of such pairs
 * reaches. A grid keeps it near-linear. Photos are bucketed on
 * `CLUSTER_GRID_DEG` cells and only the cells within reach of the link
 * distance are compared, each candidate pair by haversine. A cell is 30 km
 * tall but only about 20 km wide at 47°N, so the longitude reach grows with
 * latitude instead of staying a 3×3 block.
 *
 * A chain can run one city into the next, so a cluster that sprawls past
 * `CLUSTER_OVERSIZE_KM` is split again by the names Immich gave its photos.
 */
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import { medianPoint } from "./medians";
import { CITY_LINK_KM, CLUSTER_GRID_DEG } from "./thresholds";
import type { CityCluster, PhotoPoint } from "./types";

/** A photo with its coordinates narrowed, and its place in the (time-ordered) input. */
interface Placed {
  photo: PhotoPoint;
  lat: number;
  lon: number;
  order: number;
}

/** Kilometres per degree of latitude, on the radius `distanceKm` measures with. */
const KM_PER_DEGREE = (Math.PI * 6371) / 180;
/** Keeps cos(latitude) above zero so a cell at the pole does not reach round the world. */
const MAX_CELL_LATITUDE = 89.9;
const LON_CELLS = Math.ceil(360 / CLUSTER_GRID_DEG);
const LAT_CELLS = Math.ceil(180 / CLUSTER_GRID_DEG);
/** A cell is 30 km tall, so one row either side reaches every neighbour. */
const LAT_REACH = Math.ceil(CITY_LINK_KM / (KM_PER_DEGREE * CLUSTER_GRID_DEG));
/** The last column is narrower than the rest where the ring closes at ±180°. */
const SEAM_MARGIN_CELLS = 1;

/** How wide one `CLUSTER_GRID_DEG` longitude cell is, in kilometres, at `lat`. */
export function cellWidthKm(lat: number): number {
  const latitude = Math.min(Math.abs(lat), MAX_CELL_LATITUDE);
  return KM_PER_DEGREE * Math.cos((latitude * Math.PI) / 180) * CLUSTER_GRID_DEG;
}

/** Longitude cells to look through either side: ⌈link distance / cell width⌉, measured poleward. */
function lonReach(lat: number): number {
  const poleward = Math.min(Math.abs(lat) + CLUSTER_GRID_DEG, MAX_CELL_LATITUDE);
  const reach = Math.ceil(CITY_LINK_KM / cellWidthKm(poleward)) + SEAM_MARGIN_CELLS;
  return Math.min(reach, Math.floor((LON_CELLS - 1) / 2));
}

const latCell = (lat: number): number => Math.floor((lat + 90) / CLUSTER_GRID_DEG);
const lonCell = (lon: number): number =>
  Math.min(LON_CELLS - 1, Math.floor((lon + 180) / CLUSTER_GRID_DEG));

class DisjointSet {
  private readonly parent: number[];

  constructor(count: number) {
    this.parent = Array.from({ length: count }, (_, i) => i);
  }

  find(item: number): number {
    let root = item;
    while (this.parent[root] !== root) root = this.parent[root];
    let walk = item;
    while (this.parent[walk] !== root) {
      const next = this.parent[walk];
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // The earlier item stays the root, so a group's root is its first member.
    if (rootA < rootB) this.parent[rootB] = rootA;
    else this.parent[rootA] = rootB;
  }
}

function placedPhotos(photos: readonly PhotoPoint[]): Placed[] {
  const placed: Placed[] = [];
  for (const photo of photos) {
    if (photo.lat === null || photo.lon === null || !photo.flags.located) continue;
    placed.push({ photo, lat: photo.lat, lon: photo.lon, order: placed.length });
  }
  return placed;
}

/** Unions every pair of photos within `CITY_LINK_KM`, looking only at nearby cells. */
function linkNeighbours(points: readonly Placed[]): DisjointSet {
  const sets = new DisjointSet(points.length);
  const cells = new Map<number, number[]>();
  points.forEach((point, index) => {
    const key = latCell(point.lat) * LON_CELLS + lonCell(point.lon);
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
  });

  points.forEach((point, index) => {
    const row = latCell(point.lat);
    const column = lonCell(point.lon);
    const reach = lonReach(point.lat);
    for (let dRow = -LAT_REACH; dRow <= LAT_REACH; dRow++) {
      const neighbourRow = row + dRow;
      if (neighbourRow < 0 || neighbourRow >= LAT_CELLS) continue;
      for (let dColumn = -reach; dColumn <= reach; dColumn++) {
        const neighbourColumn = (((column + dColumn) % LON_CELLS) + LON_CELLS) % LON_CELLS;
        const bucket = cells.get(neighbourRow * LON_CELLS + neighbourColumn);
        if (!bucket) continue;
        for (const other of bucket) {
          // Once two photos share a set the pair costs a lookup, not a haversine:
          // a dense city collapses into one set after its first few unions.
          if (other <= index || sets.find(index) === sets.find(other)) continue;
          if (distanceKm(point, points[other]) <= CITY_LINK_KM) sets.union(index, other);
        }
      }
    }
  });
  return sets;
}

function farthestFrom(points: readonly Placed[], origin: Coord): Placed {
  let farthest = points[0];
  let best = -1;
  for (const point of points) {
    const km = distanceKm(origin, point);
    if (km > best) {
      best = km;
      farthest = point;
    }
  }
  return farthest;
}

/** A cheap diameter: the farthest point from the first, then the farthest from that. */
function spreadKm(points: readonly Placed[]): number {
  if (points.length < 2) return 0;
  const a = farthestFrom(points, points[0]);
  return distanceKm(a, farthestFrom(points, a));
}

/** The value most members carry; a tie goes to the one seen first. Null when none carries one. */
function majority(values: ReadonlyArray<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function toCluster(members: readonly Placed[], id: string): CityCluster {
  const centre = medianPoint(members);
  const city = majority(members.map((member) => member.photo.city));
  const sameCity = city === null ? members : members.filter((member) => member.photo.city === city);
  return {
    id,
    photoIds: members.map((member) => member.photo.id),
    lat: centre.lat,
    lon: centre.lon,
    spreadKm: spreadKm(members),
    immichCity: city,
    immichState:
      majority(sameCity.map((member) => member.photo.state)) ??
      majority(members.map((member) => member.photo.state)),
    immichCountry: majority(members.map((member) => member.photo.country)),
  };
}

/**
 * The city clusters of a set of movement photos, ids `c1`, `c2` … in the order
 * their first photo appears. Photos without coordinates belong to no cluster.
 */
export function clusterCities(photos: readonly PhotoPoint[]): CityCluster[] {
  const points = placedPhotos(photos);
  if (points.length === 0) return [];

  const sets = linkNeighbours(points);
  const byRoot = new Map<number, Placed[]>();
  points.forEach((point, index) => {
    const root = sets.find(index);
    const group = byRoot.get(root);
    if (group) group.push(point);
    else byRoot.set(root, [point]);
  });

  return [...byRoot.values()].map((members, index) => toCluster(members, `c${index + 1}`));
}

/** Photo id → the id of the cluster it belongs to. */
export function clusterOfPhoto(clusters: readonly CityCluster[]): Map<string, string> {
  const clusterOf = new Map<string, string>();
  for (const cluster of clusters) {
    for (const photoId of cluster.photoIds) clusterOf.set(photoId, cluster.id);
  }
  return clusterOf;
}
