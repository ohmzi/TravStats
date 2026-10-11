import { describe, expect, it } from "vitest";

import { JobFailedError } from "../../api/jobs";
import {
  alreadyCommittedTripId,
  commitFailureKey,
  commitNeedsRescan,
  rateLimitOf,
  scanFailureKey,
  scanStartFailureKey,
} from "../errors";

function refused(status: number, data: object | string = {}, headers: Record<string, string> = {}) {
  return { isAxiosError: true, response: { status, data, headers } };
}

describe("scanFailureKey", () => {
  it("gives each Immich failure its own sentence", () => {
    for (const code of [
      "immich_unreachable",
      "immich_auth",
      "immich_not_found",
      "immich_protocol",
      "immich_invalid_url",
    ]) {
      expect(scanFailureKey(new JobFailedError(code, 502))).toBe(`tripBuilder:errors.scan.${code}`);
    }
  });

  it("falls back for any other failure, and never prints a code", () => {
    expect(scanFailureKey(new JobFailedError("JOB_FAILED", 500))).toBe(
      "tripBuilder:errors.scan.failed"
    );
    expect(scanFailureKey(new Error("x"))).toBe("tripBuilder:errors.scan.failed");
  });
});

describe("scanStartFailureKey", () => {
  it("says Immich is not set up for the 409 that says so", () => {
    expect(scanStartFailureKey(refused(409, { error: "notConfigured" }))).toBe(
      "tripBuilder:errors.scan.notConfigured"
    );
  });

  it("explains a refused body, a rate limit and a lost network", () => {
    expect(scanStartFailureKey(refused(400, { error: "x", code: "VALIDATION_FAILED" }))).toBe(
      "tripBuilder:errors.scan.invalid"
    );
    expect(scanStartFailureKey(refused(429))).toBe("common:saveErrors.rateLimited");
    expect(scanStartFailureKey({ isAxiosError: true })).toBe("common:saveErrors.network");
    expect(scanStartFailureKey(refused(500))).toBe("tripBuilder:errors.scan.failed");
  });
});

describe("commitFailureKey", () => {
  it("has a sentence for every refusal the commit can give", () => {
    const codes: Record<string, string> = {
      DRAFT_EXPIRED: "draftExpired",
      NIGHT_PLAN_INVALID: "nightPlanInvalid",
      STATIONS_INVALID: "stationsInvalid",
      DRAFT_MISMATCH: "draftMismatch",
      WINDOW_CHANGED: "windowChanged",
      ALREADY_COMMITTED: "alreadyCommitted",
      COMMIT_IN_PROGRESS: "inProgress",
      ROADTRIPS_HIDDEN: "roadtripsHidden",
      TRIP_CHANGED: "tripChanged",
    };
    for (const [code, key] of Object.entries(codes)) {
      expect(commitFailureKey(refused(400, { error: "x", code }))).toBe(
        `tripBuilder:errors.commit.${key}`
      );
    }
  });

  it("names the list a refused body says is too long", () => {
    const details = (field: string) => [
      { field, message: "Too big: expected array to have <=100 items" },
    ];
    expect(
      commitFailureKey(
        refused(400, { error: "x", code: "VALIDATION_FAILED", details: details("flightIds") })
      )
    ).toBe("tripBuilder:errors.commit.tooManyFlights");
    expect(
      commitFailureKey(
        refused(400, { error: "x", code: "VALIDATION_FAILED", details: details("areas") })
      )
    ).toBe("tripBuilder:errors.commit.tooManyAreas");
    expect(
      commitFailureKey(
        refused(400, { error: "x", code: "VALIDATION_FAILED", details: details("photoJourneyIds") })
      )
    ).toBe("tripBuilder:errors.commit.tooManyJourneys");
  });

  it("keeps the shared validation sentence for a field that names no size", () => {
    expect(
      commitFailureKey(
        refused(400, {
          error: "x",
          code: "VALIDATION_FAILED",
          details: [{ field: "areas.0.stations", message: "Too many stations" }],
        })
      )
    ).toBe("common:saveErrors.validation");
  });

  it("reads a job that failed by its code, and falls back to one sentence", () => {
    expect(commitFailureKey(new JobFailedError("COMMIT_FAILED", 500))).toBe(
      "tripBuilder:errors.commit.failed"
    );
    expect(commitFailureKey(new JobFailedError("SOMETHING", 500))).toBe(
      "tripBuilder:errors.commit.failed"
    );
    expect(commitFailureKey(refused(500))).toBe("tripBuilder:errors.commit.failed");
  });

  it("reads a trip that changed since the scan from a failed job too", () => {
    expect(commitFailureKey(new JobFailedError("TRIP_CHANGED", 409))).toBe(
      "tripBuilder:errors.commit.tripChanged"
    );
  });
});

describe("commitNeedsRescan", () => {
  it("is true when the trip changed since the scan, refused or failed in the job", () => {
    expect(commitNeedsRescan(refused(409, { error: "x", code: "TRIP_CHANGED" }))).toBe(true);
    expect(commitNeedsRescan(new JobFailedError("TRIP_CHANGED", 409))).toBe(true);
  });

  it("is false for every other failure, which a new scan would not mend", () => {
    expect(commitNeedsRescan(refused(409, { error: "x", code: "WINDOW_CHANGED" }))).toBe(false);
    expect(commitNeedsRescan(refused(500))).toBe(false);
    expect(commitNeedsRescan(new JobFailedError("COMMIT_FAILED", 500))).toBe(false);
    expect(commitNeedsRescan(new Error("x"))).toBe(false);
  });
});

describe("alreadyCommittedTripId", () => {
  it("reads the trip the refusal names", () => {
    const err = refused(409, { error: "x", code: "ALREADY_COMMITTED", tripId: "t-1" });
    expect(alreadyCommittedTripId(err)).toBe("t-1");
  });

  it("is null for any other refusal, or one that names no trip", () => {
    expect(alreadyCommittedTripId(refused(409, { code: "COMMIT_IN_PROGRESS" }))).toBeNull();
    expect(alreadyCommittedTripId(refused(409, { code: "ALREADY_COMMITTED" }))).toBeNull();
    expect(alreadyCommittedTripId(new Error("x"))).toBeNull();
  });
});

describe("rateLimitOf", () => {
  it("is null for anything but a 429", () => {
    expect(rateLimitOf(refused(500))).toBeNull();
    expect(rateLimitOf(new Error("x"))).toBeNull();
    expect(rateLimitOf(null)).toBeNull();
  });

  it("says how many minutes to wait, rounded up, from the body or the headers", () => {
    expect(rateLimitOf(refused(429, { retryAfterSeconds: 61 }))).toEqual({ minutes: 2 });
    expect(rateLimitOf(refused(429, {}, { "retry-after": "540" }))).toEqual({ minutes: 9 });
    expect(rateLimitOf(refused(429, {}, { "ratelimit-reset": "30" }))).toEqual({ minutes: 1 });
  });

  it("is still a rate limit when it does not say how long", () => {
    expect(rateLimitOf(refused(429, "Too many requests"))).toEqual({ minutes: null });
  });
});
