import type { LauncherHandoff, ScanBody, ScanTarget } from "../../types/tripBuilder";

/**
 * The photo trip builder's use of `sessionStorage` (spec 2026-10-09 §A).
 *
 * Four keys. `tb:job:<jobId>` carries what the popup knew when it started the
 * scan (the form, the target, where Back returns), and `tb:draft:<draftId>`
 * carries the review's edits and its commit key, so a reload resumes them.
 * `tb:carry:<jobId>` carries the edits and commit key of a review that started
 * a re-scan, for the new draft to pick up, and `tb:scan:<draftId>` remembers how
 * a draft was asked for (the scan and its handoff), so an expired one can be
 * scanned again. The last two are named in `reviewSession.ts`.
 *
 * Storage can be absent, blocked or full (a private window, cleared site
 * data). Every access is wrapped: a read that fails is "nothing there", a
 * write that fails is dropped, and the page works without either; only a
 * reload loses the edits.
 */

export const jobKey = (jobId: string): string => `tb:job:${jobId}`;
export const draftKey = (draftId: string): string => `tb:draft:${draftId}`;

export function readSession<T>(key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked: the review simply cannot be resumed after a reload.
  }
}

export function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing stored, or storage blocked: either way there is nothing to remove.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isScanTarget(value: unknown): value is ScanTarget {
  if (!isRecord(value)) return false;
  return (
    value.kind === "new" ||
    (value.kind === "existing" &&
      typeof value.tripId === "string" &&
      (value.routeId === undefined || typeof value.routeId === "string"))
  );
}

/** The request `scan` was started with, kept so a scan that failed early can be run again. */
export function isScanBody(value: unknown): value is ScanBody {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.startDay === "string" &&
    typeof value.endDay === "string" &&
    typeof value.inspect === "boolean" &&
    typeof value.createAlbum === "boolean" &&
    isScanTarget(value.target)
  );
}

/** An in-app path. The page navigates to it on Back, so an address elsewhere is refused. */
function isLocalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  );
}

export function isLauncherHandoff(value: unknown): value is LauncherHandoff {
  return (
    isRecord(value) &&
    isRecord(value.form) &&
    typeof value.form.name === "string" &&
    isScanTarget(value.target) &&
    isLocalPath(value.returnTo) &&
    (value.scan === undefined || isScanBody(value.scan))
  );
}
