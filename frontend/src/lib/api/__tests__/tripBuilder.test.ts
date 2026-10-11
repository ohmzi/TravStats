import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanBody, ScanJobResult } from "../../../types/tripBuilder";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock("../client", () => ({
  API_URL: "https://travstats.example.test",
  api: { get: mocks.get, post: mocks.post, delete: mocks.del },
}));

import { waitForJob } from "../jobs";
import { tripBuilderApi } from "../tripBuilder";

const DRAFT = "4b9d6f1a-2c3e-4a5b-8d7e-9f0a1b2c3d4e";
const JOB = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const TRIP = "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c";

const SCAN: ScanBody = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

describe("tripBuilderApi", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.del.mockReset();
  });

  it("reads the capabilities as the bare resource", async () => {
    const caps = { roadtrips: true };
    mocks.get.mockResolvedValue({ data: caps });

    await expect(tripBuilderApi.capabilities()).resolves.toBe(caps);
    expect(mocks.get).toHaveBeenCalledWith("/trip-builder/capabilities");
  });

  it("starts a scan and hands back the job to wait for", async () => {
    mocks.post.mockResolvedValue({ data: { jobId: JOB } });

    await expect(tripBuilderApi.scan(SCAN)).resolves.toEqual({ jobId: JOB });
    expect(mocks.post).toHaveBeenCalledWith("/trip-builder/scan", SCAN);
  });

  it("reads a scan job's result, the draft id, with waitForJob", async () => {
    mocks.post.mockResolvedValue({ data: { jobId: JOB } });
    mocks.get.mockResolvedValue({
      data: { success: true, data: { id: JOB, status: "succeeded", result: { draftId: DRAFT } } },
    });

    const { jobId } = await tripBuilderApi.scan(SCAN);
    const result = await waitForJob<ScanJobResult>(jobId);

    expect(result).toEqual({ draftId: DRAFT });
    expect(mocks.get).toHaveBeenCalledWith(`/jobs/${JOB}`);
  });

  it("reads and discards a draft by its id", async () => {
    mocks.get.mockResolvedValue({ data: { id: DRAFT } });
    mocks.del.mockResolvedValue({});

    await expect(tripBuilderApi.getDraft(DRAFT)).resolves.toEqual({ id: DRAFT });
    await tripBuilderApi.discardDraft(DRAFT);

    expect(mocks.get).toHaveBeenCalledWith(`/trip-builder/drafts/${DRAFT}`);
    expect(mocks.del).toHaveBeenCalledWith(`/trip-builder/drafts/${DRAFT}`);
  });

  it("commits a reviewed draft", async () => {
    mocks.post.mockResolvedValue({ data: { jobId: JOB } });
    const body = { commitKey: JOB } as Parameters<typeof tripBuilderApi.commit>[1];

    await expect(tripBuilderApi.commit(DRAFT, body)).resolves.toEqual({ jobId: JOB });
    expect(mocks.post).toHaveBeenCalledWith(`/trip-builder/drafts/${DRAFT}/commit`, body);
  });

  it("retries an album, with a name only when one is given", async () => {
    mocks.post.mockResolvedValue({ data: { jobId: JOB } });

    await tripBuilderApi.retryAlbum(TRIP);
    await tripBuilderApi.retryAlbum(TRIP, "Northvale loop");

    expect(mocks.post).toHaveBeenNthCalledWith(1, `/trip-builder/trips/${TRIP}/album`, {});
    expect(mocks.post).toHaveBeenNthCalledWith(2, `/trip-builder/trips/${TRIP}/album`, {
      name: "Northvale loop",
    });
  });

  it("sends the review's removal choice with the retry, and nothing when it is off", async () => {
    mocks.post.mockResolvedValue({ data: { jobId: JOB } });

    await tripBuilderApi.retryAlbum(TRIP, "Northvale loop", true);
    await tripBuilderApi.retryAlbum(TRIP, undefined, false);

    expect(mocks.post).toHaveBeenNthCalledWith(1, `/trip-builder/trips/${TRIP}/album`, {
      name: "Northvale loop",
      removeOutside: true,
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, `/trip-builder/trips/${TRIP}/album`, {});
  });

  it("addresses a thumbnail by draft and index, never by an asset id", () => {
    expect(tripBuilderApi.previewUrl(DRAFT, 3, "thumbnail")).toBe(
      `https://travstats.example.test/api/v1/trip-builder/drafts/${DRAFT}/preview/3/file?size=thumbnail`
    );
    expect(tripBuilderApi.previewUrl(DRAFT, 0, "preview")).toMatch(
      /\/preview\/0\/file\?size=preview$/
    );
  });
});
