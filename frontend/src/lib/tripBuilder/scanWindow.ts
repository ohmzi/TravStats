import { daysBetween } from "../../shared/time";

/** The longest window one scan may cover, both days included (the server's `scanBodySchema`). */
export const MAX_SCAN_DAYS = 62;

export type ScanWindowIssue = "missing" | "tooLong";

/** A bare calendar day, as the server's `scanBodySchema` takes it. */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day an ISO string starts with; the time and zone after it are not read. */
const DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/** The calendar day an ISO string or a bare day starts with, or null when it starts with none. */
export function dayOf(value: string | null | undefined): string | null {
  return value ? (DAY_PREFIX.exec(value)?.[0] ?? null) : null;
}

/** Days from `startDay` to `endDay`, both included. */
export function inclusiveDays(startDay: string, endDay: string): number {
  return daysBetween(startDay, endDay) + 1;
}

export type WindowIssue = "incomplete" | "reversed" | "tooLong";

/**
 * Why two days are not a window the server will scan, or null when they are:
 * both days, the end not before the start, at most `MAX_SCAN_DAYS`. A date
 * picker asks it on every render, so it can say so beside the field instead of
 * after a round trip.
 *
 * The picker asks with whatever a date input holds, and Chrome lets the user
 * type up to six digits into the year ("20315-05-02"). Such a value is a day the
 * user still has to finish, so it is "incomplete" like an empty one, and so is
 * an ISO datetime: only a bare day is a day, as the server takes it.
 * `daysBetween` would throw on anything else.
 */
export function windowIssue(startDay: string, endDay: string): WindowIssue | null {
  if (!BARE_DAY.test(startDay) || !BARE_DAY.test(endDay)) return "incomplete";
  const days = inclusiveDays(startDay, endDay);
  if (days < 1) return "reversed";
  return days > MAX_SCAN_DAYS ? "tooLong" : null;
}

/**
 * Why a trip's dates cannot be scanned for photos, or null when they can.
 * An end before the start is not judged here: the form already says so at the
 * field, and refuses to save.
 */
export function scanWindowIssue(startDay: string, endDay: string): ScanWindowIssue | null {
  const issue = windowIssue(startDay, endDay);
  if (issue === "incomplete") return "missing";
  return issue === "tooLong" ? "tooLong" : null;
}
