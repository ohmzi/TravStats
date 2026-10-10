/**
 * Segments (spec 2026-10-09 §C.6): the stretches of a ground area spent in one city.
 *
 * `buildSegments` walks an area's movement photos by time. The same city with
 * a gap of at most `SEGMENT_CONTINUE_GAP_H` continues the segment; anything
 * else starts a new one. Adjacent segments of one city are never merged: a gap
 * over 30 h at one place stays two segments, and the nights between them stay
 * unknown (decision 11).
 *
 * `classifySegments` then says what each segment is: a visit, a brief stop, an
 * excursion out of a base and back, or transit noise.
 */
import {
  BRIEF_MIN_MINUTES,
  BRIEF_MIN_PHOTOS,
  EXCURSION_MAX_H,
  SEGMENT_CONTINUE_GAP_H,
  VISIT_MIN_H,
} from "./thresholds";
import type { PhotoPoint, RawSegment, Segment } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** One area's movement photos cut into runs in one city; ids `s1`, `s2` … in time order. */
export function buildSegments(
  photos: readonly PhotoPoint[],
  clusterOf: ReadonlyMap<string, string>
): RawSegment[] {
  const segments: RawSegment[] = [];
  let run: PhotoPoint[] = [];
  let runCluster = "";

  const close = (): void => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    segments.push({
      id: `s${segments.length + 1}`,
      clusterId: runCluster,
      photoIds: run.map((photo) => photo.id),
      startMs: first.tMs,
      endMs: last.tMs,
      firstDay: first.day,
      lastDay: last.day,
      firstLocal: first.local,
      lastLocal: last.local,
    });
    run = [];
  };

  for (const photo of [...photos].sort((a, b) => a.tMs - b.tMs)) {
    const clusterId = clusterOf.get(photo.id);
    if (clusterId === undefined) continue;
    const previous = run[run.length - 1];
    const gapMs = previous === undefined ? 0 : photo.tMs - previous.tMs;
    if (
      previous !== undefined &&
      (clusterId !== runCluster || gapMs > SEGMENT_CONTINUE_GAP_H * HOUR_MS)
    ) {
      close();
    }
    runCluster = clusterId;
    run.push(photo);
  }
  close();
  return segments;
}

/** The ids of the segments holding the last photo of some `nightDay`. */
function nightHolders(
  segments: readonly RawSegment[],
  photosById: ReadonlyMap<string, PhotoPoint>
): Set<string> {
  const lastOfNight = new Map<string, { tMs: number; segmentId: string }>();
  for (const segment of segments) {
    for (const id of segment.photoIds) {
      const photo = photosById.get(id);
      if (!photo) continue;
      const latest = lastOfNight.get(photo.nightDay);
      if (!latest || photo.tMs > latest.tMs) {
        lastOfNight.set(photo.nightDay, { tMs: photo.tMs, segmentId: segment.id });
      }
    }
  }
  return new Set([...lastOfNight.values()].map((latest) => latest.segmentId));
}

/** Not first or last in its area, under 3 photos, under 30 minutes: passed through. */
function isTransitNoise(segment: RawSegment, index: number, count: number): boolean {
  return (
    index > 0 &&
    index < count - 1 &&
    segment.photoIds.length < BRIEF_MIN_PHOTOS &&
    segment.endMs - segment.startMs < BRIEF_MIN_MINUTES * MINUTE_MS
  );
}

/**
 * The cluster a segment is an excursion from, or null. An excursion lies
 * between two segments of one other city A, close enough in time to be a
 * continuation (`SEGMENT_CONTINUE_GAP_H` either side), lasts under
 * `EXCURSION_MAX_H`, and holds no night — a place somebody slept is a stay,
 * however few photos it has.
 */
function excursionOrigin(
  segments: readonly RawSegment[],
  transit: readonly boolean[],
  index: number,
  holdsNight: boolean
): string | null {
  const segment = segments[index];
  const before = segments[index - 1];
  const after = segments[index + 1];
  if (before === undefined || after === undefined || holdsNight) return null;
  if (transit[index - 1] || transit[index + 1]) return null;
  if (before.clusterId !== after.clusterId || segment.clusterId === before.clusterId) return null;
  if (segment.endMs - segment.startMs >= EXCURSION_MAX_H * HOUR_MS) return null;
  const continuousMs = SEGMENT_CONTINUE_GAP_H * HOUR_MS;
  if (
    segment.startMs - before.endMs > continuousMs ||
    after.startMs - segment.endMs > continuousMs
  ) {
    return null;
  }
  return before.clusterId;
}

/**
 * What each segment of one area is. `photosById` must hold the segments'
 * photos; the night a photo belongs to is its `nightDay`.
 */
export function classifySegments(
  segments: readonly RawSegment[],
  photosById: ReadonlyMap<string, PhotoPoint>
): Segment[] {
  const holders = nightHolders(segments, photosById);
  const transit = segments.map((segment, index) => isTransitNoise(segment, index, segments.length));

  return segments.map((segment, index): Segment => {
    const holdsNight = holders.has(segment.id);
    const base = { ...segment, holdsNight, excursionOf: null };
    if (transit[index]) return { ...base, role: "transit" };
    const origin = excursionOrigin(segments, transit, index, holdsNight);
    if (origin !== null) return { ...base, role: "excursion", excursionOf: origin };
    const long = segment.endMs - segment.startMs >= VISIT_MIN_H * HOUR_MS;
    return { ...base, role: long ? "visit" : "brief" };
  });
}
