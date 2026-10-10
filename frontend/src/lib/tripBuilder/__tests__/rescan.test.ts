import { beforeEach, describe, expect, it, vi } from "vitest";

import { tripBuilderApi } from "../../api/tripBuilder";
import { carryKey } from "../reviewSession";
import { scanBodyFor, startRescan } from "../rescan";
import { jobKey } from "../session";
import { COMMIT_KEY, reviewDraft } from "./reviewFixtures";

vi.mock("../../api/tripBuilder", () => ({ tripBuilderApi: { scan: vi.fn() } }));

const JOB = "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a";
const HANDOFF = {
  form: { name: "Southern loop" },
  target: { kind: "new" } as const,
  returnTo: "/trips",
};

beforeEach(() => {
  vi.mocked(tripBuilderApi.scan).mockReset();
  sessionStorage.clear();
});

describe("scanBodyFor", () => {
  it("asks for the draft's window with the options it was made with", () => {
    expect(scanBodyFor(reviewDraft(), " Autumn loop ")).toEqual({
      name: "Autumn loop",
      startDay: "2031-05-02",
      endDay: "2031-05-07",
      inspect: true,
      createAlbum: true,
      target: { kind: "new" },
    });
  });

  it("keeps the draft's own name for a blank one, and names the trip for an existing target", () => {
    const existing = reviewDraft({
      target: {
        kind: "existing",
        tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
        tripName: "Southern loop",
      },
      options: { inspect: false, createAlbum: true },
    });
    expect(scanBodyFor(existing, " ")).toMatchObject({
      name: "Southern loop",
      inspect: false,
      target: { kind: "existing", tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c" },
    });
  });
});

describe("startRescan", () => {
  const scan = scanBodyFor(reviewDraft(), "Southern loop");
  const edits = [{ type: "merge", stationKey: "a" } as const];

  it("starts the scan, then files the handoff and the edits under the new job", async () => {
    vi.mocked(tripBuilderApi.scan).mockResolvedValue({ jobId: JOB });
    const jobId = await startRescan({
      scan,
      handoff: HANDOFF,
      edits: [...edits],
      commitKey: COMMIT_KEY,
    });
    expect(jobId).toBe(JOB);
    expect(tripBuilderApi.scan).toHaveBeenCalledWith(scan);
    expect(JSON.parse(sessionStorage.getItem(jobKey(JOB)) ?? "null")).toEqual(HANDOFF);
    expect(JSON.parse(sessionStorage.getItem(carryKey(JOB)) ?? "null")).toEqual({
      edits,
      commitKey: COMMIT_KEY,
    });
  });

  it("files nothing when the scan is refused, and lets the page say why", async () => {
    vi.mocked(tripBuilderApi.scan).mockRejectedValue(new Error("refused"));
    await expect(
      startRescan({ scan, handoff: HANDOFF, edits: [...edits], commitKey: COMMIT_KEY })
    ).rejects.toThrow("refused");
    expect(sessionStorage.length).toBe(0);
  });
});
