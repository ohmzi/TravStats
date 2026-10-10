import { daysBetween } from "../../shared/time";

/** The longest window one scan may cover, both days included (the server's `scanBodySchema`). */
export const MAX_SCAN_DAYS = 62;

export type ScanWindowIssue = "missing" | "tooLong";

/** A bare calendar day, as the server's `scanBodySchema` takes it. */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why a trip's dates cannot be scanned for photos, or null when they can.
 * An end before the start is not judged here: the form already says so at the
 * field, and refuses to save.
 *
 * The popup asks on every render, with whatever a date input holds, and Chrome
 * lets the user type up to six digits into the year ("20315-05-02"). Such a
 * value is a day the user still has to finish, so it is "missing" like an empty
 * one; `daysBetween` would throw on it.
 */
export function scanWindowIssue(startDay: string, endDay: string): ScanWindowIssue | null {
  if (!BARE_DAY.test(startDay) || !BARE_DAY.test(endDay)) return "missing";
  return daysBetween(startDay, endDay) + 1 > MAX_SCAN_DAYS ? "tooLong" : null;
}
