/**
 * One clock for every photo (spec 2026-10-09 §C.1).
 *
 * Immich's `localDateTime` is a true wall clock only when Immich knew the
 * zone (immich server metadata.service.ts:1020-1061). A screenshot without an
 * EXIF date gets its file time written as UTC, and a video is read as UTC.
 * So every asset gets a real instant t(p) and a zone z(p), and its wall clock
 * is read off those two:
 *
 * - case A, EXIF names a zone: `fileCreatedAt` is the instant;
 * - case B, no zone, and the asset looks like a file-time fallback (no camera
 *   make or model, or created = modified): `fileCreatedAt` is the instant;
 * - case C, no zone otherwise: `localDateTime` is the camera's naive wall
 *   clock, and t(p) = toInstant(wall, z(p)).
 *
 * The zone z(p) comes from the first rule that matches: 1 the zone of the
 * photo's own GPS fix; 2 an EXIF zone other than UTC; 3 the zone of the
 * nearest located photo within ZONE_NEIGHBOUR_H; 4 the dominant zone of the
 * photo's flight-bounded stretch (`areaZoneSpans`); 5 the home zone; 6 UTC.
 * Rules 3–6 borrow a zone, so the photo's day is a guess.
 *
 * Durations, ordering and the in-flight tests read t(p) alone. The local
 * strings serve days, nights and notes. Every zone conversion goes through
 * shared/time.
 */
import { toLocal } from "../../shared/time/instant";
import { addDays } from "../../shared/tour/builderNightPlan";
import { NIGHT_BOUNDARY_H } from "./thresholds";
import type { Day, LocalMinute } from "./types";

/** `YYYY-MM-DD HH:MM` of an instant on a zone's clock. The seconds are dropped, not rounded. */
export function localMinuteOf(tMs: number, zone: string): LocalMinute {
  return toLocal(new Date(tMs), zone).local.slice(0, 16).replace("T", " ");
}

/**
 * The night a photo belongs to: the day of local(p) − NIGHT_BOUNDARY_H,
 * worked out on the string alone. 00:00–03:59 is still the evening before,
 * so a night drive that arrives at 02:53 stays on the night it started.
 */
export function nightDayOf(local: LocalMinute): Day {
  const day = local.slice(0, 10);
  return Number(local.slice(11, 13)) < NIGHT_BOUNDARY_H ? addDays(day, -1) : day;
}

/** Minutes since local midnight: "2031-05-03 18:05" → 1085. */
export function minutesOfDay(local: LocalMinute): number {
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}
