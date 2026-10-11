import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import {
  DRAFT_ID,
  FLIGHT_ELSEWHERE,
  FLIGHT_OUT,
  KEY,
  PITSTOP_ALBUM,
  PITSTOP_KEY,
  STOPOVER,
  reviewDraft,
} from "../../lib/tripBuilder/__tests__/reviewFixtures";
import {
  pitstopRetry,
  stopoverRetry,
  type CommitJobResult,
  type TripBuilderDraft,
} from "../../types/tripBuilder";
import { useBuilderSession } from "../useBuilderSession";

const mocks = vi.hoisted(() => {
  class JobLostError extends Error {
    constructor() {
      super("job lost");
      this.name = "JobLostError";
    }
  }
  class JobFailedError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number
    ) {
      super(code);
      this.name = "JobFailedError";
    }
  }
  return {
    JobLostError,
    JobFailedError,
    getDraft: vi.fn(),
    commit: vi.fn(),
    retryAlbum: vi.fn(),
    scan: vi.fn(),
    discardDraft: vi.fn(),
    waitForJob: vi.fn(),
    addToast: vi.fn(),
  };
});

vi.mock("../useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../lib/api/tripBuilder", () => ({
  tripBuilderApi: {
    getDraft: mocks.getDraft,
    commit: mocks.commit,
    retryAlbum: mocks.retryAlbum,
    scan: mocks.scan,
    discardDraft: mocks.discardDraft,
  },
}));
vi.mock("../../lib/api/jobs", () => ({
  waitForJob: mocks.waitForJob,
  JobLostError: mocks.JobLostError,
  JobFailedError: mocks.JobFailedError,
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: unknown }) => unknown) =>
    select({ addToast: mocks.addToast }),
}));

// Synthetic fixtures only (public repository): invented places, shifted years.
const JOB = "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a";
const NEXT_JOB = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const COMMIT_JOB = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
const STORED_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const REVIEW_KEY = `tb:draft:${DRAFT_ID}`;
const MEMO_KEY = `tb:scan:${DRAFT_ID}`;
const HANDOFF = {
  form: { name: "Southern loop", startDate: "2031-05-02", endDate: "2031-05-07" },
  target: { kind: "new" },
  returnTo: "/trips/abc",
};
const MEMO = {
  scan: {
    name: "Southern loop",
    startDay: "2031-05-02",
    endDay: "2031-05-07",
    inspect: true,
    createAlbum: true,
    target: { kind: "new" },
  },
  handoff: HANDOFF,
};
const RESULT = {
  status: "committed",
  tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  created: true,
  roadtrips: [{ id: "r1", name: "Southern loop", stations: 4, nights: 2 }],
  stopIds: [],
  flightsAssigned: 1,
  flightsMovedFrom: [],
  routing: { routed: 0, straight: 3, ferry: 0, providerAvailable: true },
  photoJourneysResolved: 1,
  unknownNights: 1,
  album: { status: "linked", added: 72, alreadyIn: 0 },
} satisfies CommitJobResult;

function mount(url: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ session: useBuilderSession(), location: useLocation() }), { wrapper });
}
const draftUrl = `/trips/builder?draft=${DRAFT_ID}`;
const where = (hook: ReturnType<typeof mount>) =>
  hook.result.current.location.pathname + hook.result.current.location.search;

async function ready(url = draftUrl) {
  mocks.getDraft.mockResolvedValue(reviewDraft());
  const hook = mount(url);
  await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("ready"));
  return hook;
}

beforeEach(() => {
  for (const fn of [
    mocks.getDraft,
    mocks.commit,
    mocks.retryAlbum,
    mocks.scan,
    mocks.discardDraft,
    mocks.waitForJob,
    mocks.addToast,
  ]) {
    fn.mockReset();
  }
  mocks.discardDraft.mockResolvedValue(undefined);
  sessionStorage.clear();
});

describe("following a scan (?job=)", () => {
  it("reports the job's progress while it runs", async () => {
    mocks.waitForJob.mockImplementation(
      (_id: string, options: { onPoll: (job: unknown) => void }) => {
        options.onPoll({ progress: { done: 3, total: 7 } });
        return new Promise(() => undefined);
      }
    );
    const hook = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() =>
      expect(hook.result.current.session.phase).toEqual({
        kind: "scanning",
        progress: { done: 3, total: 7 },
      })
    );
  });

  it("starts out scanning, not empty, when the address names a job", () => {
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    expect(mount(`/trips/builder?job=${JOB}`).result.current.session.phase.kind).toBe("scanning");
  });

  it("reads a lost job as lost, and a failed one in words", async () => {
    mocks.waitForJob.mockRejectedValue(new mocks.JobLostError());
    const lost = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() => expect(lost.result.current.session.phase.kind).toBe("scanLost"));
    mocks.waitForJob.mockRejectedValue(new mocks.JobFailedError("immich_unreachable", 502));
    const failed = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() =>
      expect(failed.result.current.session.phase).toEqual({
        kind: "scanFailed",
        message: "tripBuilder:errors.scan.immich_unreachable",
      })
    );
  });

  it("opens the draft the job made, with the form the launcher left", async () => {
    sessionStorage.setItem(`tb:job:${JOB}`, JSON.stringify(HANDOFF));
    mocks.waitForJob.mockResolvedValue({ draftId: DRAFT_ID });
    mocks.getDraft.mockResolvedValue(reviewDraft());
    const hook = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("ready"));
    expect(where(hook)).toBe(draftUrl);
    expect(hook.result.current.session.handoff).toEqual(HANDOFF);
  });

  it("puts the edits a re-scan carried onto the new draft, and says how many held", async () => {
    sessionStorage.setItem(
      `tb:carry:${JOB}`,
      JSON.stringify({
        edits: [
          { type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" },
          { type: "rename", stationKey: "gone", title: "x" },
        ],
        commitKey: STORED_KEY,
      })
    );
    mocks.waitForJob.mockResolvedValue({ draftId: DRAFT_ID });
    mocks.getDraft.mockResolvedValue(reviewDraft());
    const hook = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("ready"));
    const { session } = hook.result.current;
    expect(session.state?.areas[0].stations[1].title).toBe("Northvale Lodge");
    expect(session.carried).toEqual({ kept: 1, total: 2 });
    expect(JSON.parse(sessionStorage.getItem(REVIEW_KEY) ?? "{}").commitKey).toBe(STORED_KEY);
  });
});

describe("loading a draft (?draft=)", () => {
  it("has nothing to show without a job or a draft in the address", () => {
    expect(mount("/trips/builder").result.current.session.phase.kind).toBe("empty");
  });

  it("starts a fresh review with a commit key of its own and remembers how it was asked for", async () => {
    const hook = await ready();
    const stored = JSON.parse(sessionStorage.getItem(REVIEW_KEY) ?? "{}");
    expect(stored.edits).toEqual([]);
    expect(stored.commitKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    const memo = JSON.parse(sessionStorage.getItem(MEMO_KEY) ?? "{}");
    expect(memo.scan).toMatchObject({
      startDay: "2031-05-02",
      endDay: "2031-05-07",
      inspect: true,
    });
    expect(hook.result.current.session.handoff.returnTo).toBe("/trips");
    expect(hook.result.current.session.carried).toBeNull();
  });

  it("resumes the edits kept in sessionStorage, under the key they were kept with", async () => {
    sessionStorage.setItem(
      REVIEW_KEY,
      JSON.stringify({
        edits: [{ type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" }],
        commitKey: STORED_KEY,
      })
    );
    sessionStorage.setItem(MEMO_KEY, JSON.stringify(MEMO));
    const hook = await ready();
    const { session } = hook.result.current;
    expect(session.state?.areas[0].stations[1].title).toBe("Northvale Lodge");
    expect(session.handoff.returnTo).toBe("/trips/abc");
    expect(session.carried).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(REVIEW_KEY) ?? "{}").commitKey).toBe(STORED_KEY);
  });

  it("keeps each edit in sessionStorage as it is made", async () => {
    const hook = await ready();
    act(() =>
      hook.result.current.session.edit({
        type: "setFlightTick",
        flightId: FLIGHT_ELSEWHERE,
        ticked: true,
      })
    );
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(REVIEW_KEY) ?? "{}").edits).toEqual([
        { type: "setFlightTick", flightId: FLIGHT_ELSEWHERE, ticked: true },
      ])
    );
    expect(hook.result.current.session.state?.flightTicks[FLIGHT_ELSEWHERE]).toBe(true);
  });

  it("takes every edit back on request", async () => {
    const hook = await ready();
    act(() =>
      hook.result.current.session.edit({
        type: "setFlightTick",
        flightId: FLIGHT_OUT,
        ticked: false,
      })
    );
    act(() => hook.result.current.session.resetEdits());
    expect(hook.result.current.session.state?.edits).toEqual([]);
    expect(hook.result.current.session.state?.flightTicks[FLIGHT_OUT]).toBe(true);
  });

  it("asks the browser before leaving with edits, and not before", async () => {
    const hook = await ready();
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    act(() =>
      hook.result.current.session.edit({
        type: "setFlightTick",
        flightId: FLIGHT_ELSEWHERE,
        ticked: true,
      })
    );
    await waitFor(() => {
      const after = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(true);
    });
  });

  it("calls a draft the server has forgotten expired, and knows whether it can be scanned again", async () => {
    mocks.getDraft.mockRejectedValue({ response: { status: 404 } });
    const without = mount(draftUrl);
    await waitFor(() =>
      expect(without.result.current.session.phase).toEqual({ kind: "expired", canScanAgain: false })
    );
    sessionStorage.setItem(MEMO_KEY, JSON.stringify(MEMO));
    const withMemo = mount(draftUrl);
    await waitFor(() =>
      expect(withMemo.result.current.session.phase).toEqual({ kind: "expired", canScanAgain: true })
    );
  });

  it("says any other failure to load is a failure to load", async () => {
    mocks.getDraft.mockRejectedValue(new Error("network"));
    const hook = mount(draftUrl);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("loadFailed"));
  });
});

describe("scanning again", () => {
  it("after expiry, scans what was scanned and carries the edits and the commit key", async () => {
    mocks.getDraft.mockRejectedValue({ response: { status: 404 } });
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    sessionStorage.setItem(MEMO_KEY, JSON.stringify(MEMO));
    sessionStorage.setItem(
      REVIEW_KEY,
      JSON.stringify({ edits: [{ type: "merge", stationKey: "a" }], commitKey: STORED_KEY })
    );
    const hook = mount(draftUrl);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("expired"));
    await act(() => hook.result.current.session.scanAgain());
    await waitFor(() => expect(where(hook)).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(MEMO.scan);
    expect(JSON.parse(sessionStorage.getItem(`tb:carry:${NEXT_JOB}`) ?? "{}")).toEqual({
      edits: [{ type: "merge", stationKey: "a" }],
      commitKey: STORED_KEY,
    });
  });

  it("for other dates, with the same options and the edits so far", async () => {
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    const hook = await ready();
    act(() =>
      hook.result.current.session.edit({
        type: "setFlightTick",
        flightId: FLIGHT_ELSEWHERE,
        ticked: true,
      })
    );
    await act(() => hook.result.current.session.rescan({ endDay: "2031-05-09" }));
    await waitFor(() => expect(where(hook)).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith({
      name: "Southern loop",
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      inspect: true,
      createAlbum: true,
      target: { kind: "new" },
    });
    expect(JSON.parse(sessionStorage.getItem(`tb:carry:${NEXT_JOB}`) ?? "{}").edits).toHaveLength(
      1
    );
  });

  it("after a lost scan, scans the request the hand-off carries, with what a lost re-scan carried", async () => {
    sessionStorage.setItem(`tb:job:${JOB}`, JSON.stringify({ ...HANDOFF, scan: MEMO.scan }));
    sessionStorage.setItem(
      `tb:carry:${JOB}`,
      JSON.stringify({ edits: [{ type: "merge", stationKey: "a" }], commitKey: STORED_KEY })
    );
    mocks.waitForJob
      .mockRejectedValueOnce(new mocks.JobLostError())
      .mockReturnValue(new Promise(() => undefined));
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    const hook = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("scanLost"));
    expect(hook.result.current.session.handoff.scan).toEqual(MEMO.scan);
    await act(() => hook.result.current.session.scanAgain());
    await waitFor(() => expect(where(hook)).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(MEMO.scan);
    expect(JSON.parse(sessionStorage.getItem(`tb:carry:${NEXT_JOB}`) ?? "{}")).toEqual({
      edits: [{ type: "merge", stationKey: "a" }],
      commitKey: STORED_KEY,
    });
    expect(JSON.parse(sessionStorage.getItem(`tb:job:${NEXT_JOB}`) ?? "{}").returnTo).toBe(
      "/trips/abc"
    );
  });

  it("has no request to repeat after a lost scan whose hand-off carries none", async () => {
    sessionStorage.setItem(`tb:job:${JOB}`, JSON.stringify(HANDOFF));
    mocks.waitForJob.mockRejectedValue(new mocks.JobLostError());
    const hook = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("scanLost"));
    expect(hook.result.current.session.handoff.scan).toBeUndefined();
    await act(() => hook.result.current.session.scanAgain());
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(where(hook)).toBe(`/trips/builder?job=${JOB}`);
  });

  it("files a re-scan's hand-off with the request it made, so losing it offers the same dates", async () => {
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    const hook = await ready();
    await act(() => hook.result.current.session.rescan({ endDay: "2031-05-09" }));
    await waitFor(() => expect(where(hook)).toBe(`/trips/builder?job=${NEXT_JOB}`));
    const filed = JSON.parse(sessionStorage.getItem(`tb:job:${NEXT_JOB}`) ?? "{}");
    expect(filed.scan).toMatchObject({ startDay: "2031-05-02", endDay: "2031-05-09" });
  });

  it("stays on the review and says why when the scan is refused", async () => {
    mocks.scan.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: "Too many requests", headers: { "retry-after": "540" } },
    });
    const hook = await ready();
    await act(() => hook.result.current.session.rescan({ endDay: "2031-05-09" }));
    expect(mocks.addToast).toHaveBeenCalledWith(
      "error",
      'tripBuilder:errors.rateLimitedMinutes {"count":9}'
    );
    expect(where(hook)).toBe(draftUrl);
  });
});

describe("saving", () => {
  beforeEach(() => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
  });

  it("sends the body the review made under its key, and holds the result", async () => {
    mocks.waitForJob.mockResolvedValue(RESULT);
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({
      kind: "done",
      result: RESULT,
      retrying: null,
    });
    const [draftId, body] = mocks.commit.mock.calls[0];
    expect(draftId).toBe(DRAFT_ID);
    expect(body).toMatchObject({
      window: { startDay: "2031-05-02", endDay: "2031-05-07" },
      flightIds: [FLIGHT_OUT],
      album: { create: true, name: "Southern loop" },
    });
    expect(body.commitKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("forgets the edits once the trip exists, so a reload cannot resume them", async () => {
    mocks.waitForJob.mockResolvedValue(RESULT);
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(sessionStorage.getItem(REVIEW_KEY)).toBeNull();
  });

  it("stops at the preflight's block, and saves without the album under the same key when asked", async () => {
    const blocked = { status: "blocked", reason: "missingScopes", missingScopes: ["album.create"] };
    mocks.waitForJob.mockResolvedValueOnce(blocked).mockResolvedValueOnce(RESULT);
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({ kind: "blocked", blocked });
    await act(() => hook.result.current.session.submit(true));
    expect(hook.result.current.session.commit.kind).toBe("done");
    const [first, second] = mocks.commit.mock.calls.map((call) => call[1]);
    expect(first.album.create).toBe(true);
    expect(second.album.create).toBe(false);
    expect(second.commitKey).toBe(first.commitKey);
    expect(hook.result.current.session.state?.album).toEqual({
      create: false,
      name: "Southern loop",
    });
  });

  it("says a refused commit in words", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "WINDOW_CHANGED" } },
    });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({
      kind: "failed",
      message: "tripBuilder:errors.commit.windowChanged",
      canScanAgain: false,
    });
  });

  it("offers a new scan when the trip changed since the scan, however that is reported", async () => {
    mocks.commit.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "TRIP_CHANGED" } },
    });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({
      kind: "failed",
      message: "tripBuilder:errors.commit.tripChanged",
      canScanAgain: true,
    });

    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockRejectedValue(new mocks.JobFailedError("TRIP_CHANGED", 409));
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({
      kind: "failed",
      message: "tripBuilder:errors.commit.tripChanged",
      canScanAgain: true,
    });
  });

  it("offers a new scan when the draft has expired, the way its sentence promises", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: "x", code: "DRAFT_EXPIRED" } },
    });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({
      kind: "failed",
      message: "tripBuilder:errors.commit.draftExpired",
      canScanAgain: true,
    });
  });

  it("gives the wait when the server says to slow down", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: "Too many requests", headers: { "retry-after": "540" } },
    });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({
      kind: "failed",
      message: 'tripBuilder:errors.rateLimitedMinutes {"count":9}',
      canScanAgain: false,
    });
  });

  it("finds the trip a repeated commit says already exists", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "ALREADY_COMMITTED", tripId: "t-77" } },
    });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({ kind: "already", tripId: "t-77" });
  });

  it("calls a lost commit job unknown, never failed", async () => {
    mocks.waitForJob.mockRejectedValue(new mocks.JobLostError());
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    expect(hook.result.current.session.commit).toEqual({ kind: "unknown" });
  });
});

describe("the album afterwards", () => {
  /** An existing trip whose linked album is TravStats-created: removal starts on. */
  const resyncDraft = (over: Partial<TripBuilderDraft> = {}): TripBuilderDraft =>
    reviewDraft({
      target: { kind: "existing", tripId: "t-9", tripName: "Southern loop" },
      album: {
        name: "Southern loop",
        existing: null,
        assetCount: 72,
        images: 68,
        videos: 4,
        allowed: true,
        missingScopes: [],
        sync: {
          target: "linked",
          toAdd: 0,
          alreadyIn: 72,
          removable: { count: 4, defaultOn: true, allowed: true },
        },
      },
      ...over,
    });

  it("retries the album that failed and holds what it did", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        album: { status: "failed", error: { kind: "unreachable" } },
      })
      .mockResolvedValueOnce({ status: "linked", added: 72, alreadyIn: 0 });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum());
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, { name: "Southern loop" });
    const { commit } = hook.result.current.session;
    expect(commit.kind === "done" && commit.result.album).toEqual({
      status: "linked",
      added: 72,
      alreadyIn: 0,
    });
  });

  it("carries a re-sync's removal choice into the album retry", async () => {
    // The retry must complete the update the commit was asked for: a re-sync
    // whose review left the removal on cannot have that decision dropped by
    // the failure and the retry (final review, finding N4-3).
    mocks.getDraft.mockResolvedValue(resyncDraft());
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({ ...RESULT, created: false, album: { status: "failed" } })
      .mockResolvedValueOnce({ status: "linked", removed: 4 });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = mount(draftUrl);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("ready"));
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum());
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, {
      name: "Southern loop",
      removeOutside: true,
    });
  });

  it("retries a flights-only re-sync with the keep the empty screen sent", async () => {
    // The empty-window screen sends keepEverything — it must not remove what it
    // never drew — so the retry after its album failure must carry that same
    // keep, not the raw default-on switch the screen replaced (final review,
    // finding X1-1).
    mocks.getDraft.mockResolvedValue(
      resyncDraft({
        stats: { ...reviewDraft().stats, assets: 0, located: 0 },
      })
    );
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({ ...RESULT, created: false, album: { status: "failed" } })
      .mockResolvedValueOnce({ status: "linked", removed: 0 });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = mount(draftUrl);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("ready"));
    await act(() => hook.result.current.session.submitFlightsOnly());
    expect(mocks.commit.mock.calls[0][1].album).toMatchObject({ removeOutside: false });
    await act(() => hook.result.current.session.retryAlbum());
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, { name: "Southern loop" });
  });

  it("retries a stopover's album by key, and holds its new outcome", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        stopoverAlbums: [{ key: STOPOVER.key, name: STOPOVER.title, album: { status: "failed" } }],
      })
      .mockResolvedValueOnce({
        status: "linked",
        albumName: STOPOVER.title,
        added: 24,
        alreadyIn: 0,
      });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(stopoverRetry(STOPOVER.key)));
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, { stopoverKey: STOPOVER.key });
    const { commit } = hook.result.current.session;
    expect(commit.kind === "done" && commit.result.stopoverAlbums?.[0].album).toEqual({
      status: "linked",
      albumName: STOPOVER.title,
      added: 24,
      alreadyIn: 0,
    });
  });

  it("retries a pitstop area's album by its key, and holds its new outcome", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        pitstopAlbums: [{ key: PITSTOP_KEY, name: PITSTOP_ALBUM, album: { status: "failed" } }],
      })
      .mockResolvedValueOnce({
        status: "linked",
        albumName: PITSTOP_ALBUM,
        added: 18,
        alreadyIn: 2,
      });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(pitstopRetry(PITSTOP_KEY)));
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, {
      pitstopKey: PITSTOP_KEY,
    });
    const { commit } = hook.result.current.session;
    expect(commit.kind === "done" && commit.result.pitstopAlbums?.[0].album).toEqual({
      status: "linked",
      albumName: PITSTOP_ALBUM,
      added: 18,
      alreadyIn: 2,
    });
  });

  it("refuses to believe a pitstop retry that wrote another album", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        pitstopAlbums: [{ key: PITSTOP_KEY, name: PITSTOP_ALBUM, album: { status: "failed" } }],
      })
      .mockResolvedValueOnce({
        status: "linked",
        albumName: "Southern loop",
        added: 72,
        alreadyIn: 0,
      });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(pitstopRetry(PITSTOP_KEY)));
    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:errors.album.retryFailed");
    const { commit } = hook.result.current.session;
    expect(commit).toMatchObject({ kind: "done", retrying: null });
    expect(commit.kind === "done" && commit.result.pitstopAlbums?.[0].album).toEqual({
      status: "failed",
    });
  });

  it("ignores a retry of a pitstop album the commit never wrote", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValueOnce(RESULT);
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(pitstopRetry(PITSTOP_KEY)));
    expect(mocks.retryAlbum).not.toHaveBeenCalled();
  });

  it("refuses to believe a stopover retry that wrote another album", async () => {
    // The server once fell back to the trip's album when it could not resolve
    // the stopover; the panel then reported that outcome as the city album's
    // repair. A success naming an album other than the requested one is a
    // failed retry (final review, finding S2-3).
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        stopoverAlbums: [{ key: STOPOVER.key, name: STOPOVER.title, album: { status: "failed" } }],
      })
      .mockResolvedValueOnce({
        status: "linked",
        albumName: "Southern loop",
        added: 72,
        alreadyIn: 0,
      });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(stopoverRetry(STOPOVER.key)));
    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:errors.album.retryFailed");
    const { commit } = hook.result.current.session;
    expect(commit).toMatchObject({ kind: "done", retrying: null });
    expect(commit.kind === "done" && commit.result.stopoverAlbums?.[0].album).toEqual({
      status: "failed",
    });
  });

  it("keeps a stopover the server refused (its scan is gone) as failed", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValueOnce({
      ...RESULT,
      stopoverAlbums: [{ key: STOPOVER.key, name: STOPOVER.title, album: { status: "failed" } }],
    });
    mocks.retryAlbum.mockRejectedValue(new Error("STOPOVER_EXPIRED"));
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(stopoverRetry(STOPOVER.key)));
    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:errors.album.retryFailed");
    const { commit } = hook.result.current.session;
    expect(commit).toMatchObject({ kind: "done", retrying: null });
    expect(commit.kind === "done" && commit.result.stopoverAlbums?.[0].album).toEqual({
      status: "failed",
    });
  });

  it("ignores a retry of a stopover album the commit never wrote", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValueOnce(RESULT);
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum(stopoverRetry(STOPOVER.key)));
    expect(mocks.retryAlbum).not.toHaveBeenCalled();
  });

  it("tells the user when the retry fails, and keeps the trip", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValueOnce({ ...RESULT, album: { status: "failed" } });
    mocks.retryAlbum.mockRejectedValue(new Error("refused"));
    const hook = await ready();
    await act(() => hook.result.current.session.submit());
    await act(() => hook.result.current.session.retryAlbum());
    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:errors.album.retryFailed");
    expect(hook.result.current.session.commit.kind).toBe("done");
  });
});

describe("leaving", () => {
  it("discards the draft and goes back to where the review was started", async () => {
    sessionStorage.setItem(MEMO_KEY, JSON.stringify(MEMO));
    const hook = await ready();
    act(() => hook.result.current.session.leave());
    expect(mocks.discardDraft).toHaveBeenCalledWith(DRAFT_ID);
    expect(where(hook)).toBe("/trips/abc");
    expect(sessionStorage.getItem(REVIEW_KEY)).toBeNull();
    expect(sessionStorage.getItem(MEMO_KEY)).toBeNull();
  });

  it("goes back from a lost scan without a draft to discard", async () => {
    sessionStorage.setItem(`tb:job:${JOB}`, JSON.stringify(HANDOFF));
    mocks.waitForJob.mockRejectedValue(new mocks.JobLostError());
    const hook = mount(`/trips/builder?job=${JOB}`);
    await waitFor(() => expect(hook.result.current.session.phase.kind).toBe("scanLost"));
    act(() => hook.result.current.session.leave());
    expect(mocks.discardDraft).not.toHaveBeenCalled();
    expect(where(hook)).toBe("/trips/abc");
  });
});
