import { daysBetween } from "../../shared/time";

/** The longest window one scan may cover, both days included (the server's `scanBodySchema`). */
export const MAX_SCAN_DAYS = 62;

export type ScanWindowIssue = "missing" | "tooLong";

/**
 * Why a trip's dates cannot be scanned for photos, or null when they can.
 * An end before the start is not judged here: the form already says so at the
 * field, and refuses to save.
 */
export function scanWindowIssue(startDay: string, endDay: string): ScanWindowIssue | null {
  if (!startDay || !endDay) return "missing";
  return daysBetween(startDay, endDay) + 1 > MAX_SCAN_DAYS ? "tooLong" : null;
}
