/**
 * The sentence a failure of the trip builder gets, as a translation key, and the
 * facts a page needs from an error body. A code is for a program: nothing here
 * ever returns the server's text.
 */
import { apiErrorCode, apiErrorMachineCode } from "../apiError";
import { JobFailedError } from "../api/jobs";
import { saveErrorKey } from "../saveErrorMessage";

const SCAN_JOB_KEYS: Readonly<Record<string, string>> = {
  immich_unreachable: "tripBuilder:errors.scan.immich_unreachable",
  immich_auth: "tripBuilder:errors.scan.immich_auth",
  immich_not_found: "tripBuilder:errors.scan.immich_not_found",
  immich_protocol: "tripBuilder:errors.scan.immich_protocol",
  immich_invalid_url: "tripBuilder:errors.scan.immich_invalid_url",
};

/** A scan job that ended `failed`: the Immich failures have their own sentences. */
export function scanFailureKey(err: unknown): string {
  const code = err instanceof JobFailedError ? err.code : null;
  return (code !== null ? SCAN_JOB_KEYS[code] : undefined) ?? "tripBuilder:errors.scan.failed";
}

/** The request that starts a scan was refused. */
export function scanStartFailureKey(err: unknown): string {
  if (apiErrorCode(err) === "notConfigured") return "tripBuilder:errors.scan.notConfigured";
  return saveErrorKey(err, "tripBuilder:errors.scan.failed", {
    VALIDATION_FAILED: "tripBuilder:errors.scan.invalid",
  });
}

const COMMIT_KEYS: Readonly<Record<string, string>> = {
  DRAFT_EXPIRED: "tripBuilder:errors.commit.draftExpired",
  NIGHT_PLAN_INVALID: "tripBuilder:errors.commit.nightPlanInvalid",
  STATIONS_INVALID: "tripBuilder:errors.commit.stationsInvalid",
  DRAFT_MISMATCH: "tripBuilder:errors.commit.draftMismatch",
  WINDOW_CHANGED: "tripBuilder:errors.commit.windowChanged",
  ALREADY_COMMITTED: "tripBuilder:errors.commit.alreadyCommitted",
  COMMIT_IN_PROGRESS: "tripBuilder:errors.commit.inProgress",
  ROADTRIPS_HIDDEN: "tripBuilder:errors.commit.roadtripsHidden",
  TRIP_CHANGED: "tripBuilder:errors.commit.tripChanged",
  COMMIT_FAILED: "tripBuilder:errors.commit.failed",
};

/** The commit request, or the commit job, ended in a failure. */
export function commitFailureKey(err: unknown): string {
  if (err instanceof JobFailedError) {
    return COMMIT_KEYS[err.code] ?? "tripBuilder:errors.commit.failed";
  }
  return saveErrorKey(err, "tripBuilder:errors.commit.failed", COMMIT_KEYS);
}

/** The trip a refused commit says already exists (409 `ALREADY_COMMITTED`). */
export function alreadyCommittedTripId(err: unknown): string | null {
  if (apiErrorMachineCode(err) !== "ALREADY_COMMITTED") return null;
  const data = (err as { response?: { data?: { tripId?: unknown } } }).response?.data;
  return typeof data?.tripId === "string" ? data.tripId : null;
}

interface RateLimitedError {
  response?: { status?: number; headers?: Record<string, unknown>; data?: unknown };
}

const wholeMinutes = (seconds: unknown): number | null => {
  const n = typeof seconds === "string" ? Number(seconds) : seconds;
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.max(1, Math.ceil(n / 60))
    : null;
};

/**
 * Null unless the request was refused for going too fast. Then `minutes` is how
 * long to wait, rounded up, when the response said (the body's `retryAfterSeconds`,
 * else the `Retry-After` or `RateLimit-Reset` header), else null.
 */
export function rateLimitOf(err: unknown): { minutes: number | null } | null {
  const response = (err as RateLimitedError | null)?.response;
  if (response?.status !== 429) return null;
  const body = response.data as { retryAfterSeconds?: unknown } | undefined;
  const headers = response.headers ?? {};
  return {
    minutes:
      wholeMinutes(body?.retryAfterSeconds) ??
      wholeMinutes(headers["retry-after"]) ??
      wholeMinutes(headers["ratelimit-reset"]),
  };
}
