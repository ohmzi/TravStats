import { beforeEach, describe, expect, it, vi } from "vitest";

import { tripBuilderApi } from "../../api/tripBuilder";
import { scanWindowOf, startExistingScan, startRouteScan } from "../launchExisting";
import { jobKey } from "../session";

vi.mock("../../api/tripBuilder", () => ({ tripBuilderApi: { scan: vi.fn() } }));

const JOB = "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a";
const TRIP = {
  id: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  name: "Southern loop",
  startDate: "2031-05-02T00:00:00.000Z",
  endDate: "2031-05-07T00:00:00.000Z",
};
const SCAN = {
  name: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  inspect: true,
  createAlbum: true,
  target: { kind: "existing", tripId: TRIP.id },
};

beforeEach(() => {
  vi.mocked(tripBuilderApi.scan).mockReset();
  sessionStorage.clear();
});

describe("scanWindowOf", () => {
  it("is the saved dates", () => {
    expect(scanWindowOf(TRIP)).toEqual({ startDay: "2031-05-02", endDay: "2031-05-07" });
  });

  it("reads a bare day as it reads a timestamp", () => {
    expect(scanWindowOf({ startDate: "2031-05-02", endDate: "2031-05-07" })).toEqual({
      startDay: "2031-05-02",
      endDay: "2031-05-07",
    });
  });

  it("accepts exactly 62 days and refuses 63", () => {
    expect(scanWindowOf({ ...TRIP, endDate: "2031-07-02" })).toEqual({
      startDay: "2031-05-02",
      endDay: "2031-07-02",
    });
    expect(scanWindowOf({ ...TRIP, endDate: "2031-07-03" })).toEqual({ refusal: "tooLong" });
  });

  it("refuses a trip without both dates, and one that ends before it starts", () => {
    expect(scanWindowOf({ ...TRIP, startDate: null })).toEqual({ refusal: "noDates" });
    expect(scanWindowOf({ ...TRIP, endDate: null })).toEqual({ refusal: "noDates" });
    expect(scanWindowOf({ ...TRIP, endDate: "2031-05-01" })).toEqual({ refusal: "reversed" });
  });
});

describe("startExistingScan", () => {
  it("scans the saved dates of the trip with inspect on, and files the handoff with the scan", async () => {
    vi.mocked(tripBuilderApi.scan).mockResolvedValue({ jobId: JOB });
    await expect(startExistingScan(TRIP, { createAlbum: true })).resolves.toEqual({ jobId: JOB });
    expect(tripBuilderApi.scan).toHaveBeenCalledWith(SCAN);
    expect(JSON.parse(sessionStorage.getItem(jobKey(JOB)) ?? "null")).toEqual({
      form: { name: "Southern loop", startDate: "2031-05-02", endDate: "2031-05-07" },
      target: { kind: "existing", tripId: TRIP.id },
      returnTo: `/trips/${TRIP.id}`,
      scan: SCAN,
    });
  });

  it("asks for the album only when told to, and files what it asked for", async () => {
    vi.mocked(tripBuilderApi.scan).mockResolvedValue({ jobId: JOB });
    await startExistingScan(TRIP, { createAlbum: false });
    expect(tripBuilderApi.scan).toHaveBeenCalledWith({ ...SCAN, createAlbum: false });
    expect(JSON.parse(sessionStorage.getItem(jobKey(JOB)) ?? "null").scan.createAlbum).toBe(false);
  });

  it.each([
    ["no dates", { startDate: null }],
    ["a window of 63 days", { endDate: "2031-07-03T00:00:00.000Z" }],
    ["an end before the start", { endDate: "2031-05-01T00:00:00.000Z" }],
  ])("does not ask the server about %s", async (_name, over) => {
    await expect(startExistingScan({ ...TRIP, ...over }, { createAlbum: true })).rejects.toThrow(
      RangeError
    );
    expect(tripBuilderApi.scan).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("leaves nothing filed when the scan is refused", async () => {
    vi.mocked(tripBuilderApi.scan).mockRejectedValue(new Error("refused"));
    await expect(startExistingScan(TRIP, { createAlbum: true })).rejects.toThrow("refused");
    expect(sessionStorage.length).toBe(0);
  });
});

describe("startRouteScan (owner request 2026-10-12)", () => {
  const JOURNEY = { id: TRIP.id, name: TRIP.name };
  const ROUTE = {
    id: "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
    name: "Northvale loop",
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-04T00:00:00.000Z",
  };
  const SCAN = {
    name: "Northvale loop",
    startDay: "2031-05-02",
    endDay: "2031-05-04",
    inspect: true,
    createAlbum: true,
    target: { kind: "existing", tripId: TRIP.id, routeId: ROUTE.id },
  };

  it("scans the trip's own dates and names both the journey and the route", async () => {
    vi.mocked(tripBuilderApi.scan).mockResolvedValue({ jobId: JOB });
    await expect(
      startRouteScan({ journey: JOURNEY, route: ROUTE }, { createAlbum: true })
    ).resolves.toEqual({ jobId: JOB });
    expect(tripBuilderApi.scan).toHaveBeenCalledWith(SCAN);
    expect(JSON.parse(sessionStorage.getItem(jobKey(JOB)) ?? "null")).toEqual({
      form: { name: "Northvale loop", startDate: "2031-05-02", endDate: "2031-05-04" },
      target: { kind: "existing", tripId: TRIP.id, routeId: ROUTE.id },
      returnTo: `/roadtrips/${ROUTE.id}`,
      scan: SCAN,
    });
  });

  it("asks for the album only when told to", async () => {
    vi.mocked(tripBuilderApi.scan).mockResolvedValue({ jobId: JOB });
    await startRouteScan({ journey: JOURNEY, route: ROUTE }, { createAlbum: false });
    expect(tripBuilderApi.scan).toHaveBeenCalledWith({ ...SCAN, createAlbum: false });
  });

  it.each([
    ["no dates", { startDate: null }],
    ["a window of 63 days", { endDate: "2031-07-05T00:00:00.000Z" }],
    ["an end before the start", { endDate: "2031-05-01T00:00:00.000Z" }],
  ])("does not ask the server about %s", async (_name, over) => {
    await expect(
      startRouteScan({ journey: JOURNEY, route: { ...ROUTE, ...over } }, { createAlbum: true })
    ).rejects.toThrow(RangeError);
    expect(tripBuilderApi.scan).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
});
