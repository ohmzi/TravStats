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
import { SEGMENT_CONTINUE_GAP_H } from "./thresholds";
import type { PhotoPoint, RawSegment } from "./types";

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
