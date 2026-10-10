import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftKey,
  isLauncherHandoff,
  jobKey,
  readSession,
  removeSession,
  writeSession,
} from "../session";

const HANDOFF = {
  form: { name: "Northvale loop", startDate: "2031-05-02", endDate: "2031-05-09" },
  target: { kind: "new" },
  returnTo: "/trips",
};

const SCAN = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const isString = (value: unknown): value is string => typeof value === "string";

describe("trip builder session storage", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("names its keys after the job and the draft", () => {
    expect(jobKey("abc")).toBe("tb:job:abc");
    expect(draftKey("def")).toBe("tb:draft:def");
  });

  it("writes a value and reads it back through its guard", () => {
    writeSession("tb:test", "kept");

    expect(readSession("tb:test", isString)).toBe("kept");
  });

  it("reads nothing for a missing key, a broken value or one the guard refuses", () => {
    expect(readSession("tb:none", isString)).toBeNull();

    sessionStorage.setItem("tb:broken", "{not json");
    expect(readSession("tb:broken", isString)).toBeNull();

    writeSession("tb:number", 7);
    expect(readSession("tb:number", isString)).toBeNull();
  });

  it("removes a value", () => {
    writeSession("tb:test", "kept");
    removeSession("tb:test");

    expect(readSession("tb:test", isString)).toBeNull();
  });

  it("works with storage blocked: reads nothing, drops writes, never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readSession("tb:test", isString)).toBeNull();
    expect(() => writeSession("tb:test", "kept")).not.toThrow();
    expect(() => removeSession("tb:test")).not.toThrow();
  });
});

describe("isLauncherHandoff", () => {
  it("accepts a new-trip and an existing-trip hand-off", () => {
    expect(isLauncherHandoff(HANDOFF)).toBe(true);
    expect(
      isLauncherHandoff({
        ...HANDOFF,
        target: { kind: "existing", tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c" },
        returnTo: "/trips/3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      })
    ).toBe(true);
  });

  it("refuses a hand-off that does not say what it must", () => {
    expect(isLauncherHandoff(null)).toBe(false);
    expect(isLauncherHandoff({ ...HANDOFF, form: { startDate: "2031-05-02" } })).toBe(false);
    expect(isLauncherHandoff({ ...HANDOFF, target: { kind: "existing" } })).toBe(false);
    expect(isLauncherHandoff({ ...HANDOFF, target: { kind: "other" } })).toBe(false);
  });

  it("refuses a Back address that leaves the app", () => {
    for (const returnTo of [
      "https://elsewhere.example.test/",
      "//elsewhere.example.test",
      "/\\x",
    ]) {
      expect(isLauncherHandoff({ ...HANDOFF, returnTo })).toBe(false);
    }
  });

  it("accepts a hand-off with or without the scan request it was started from", () => {
    expect(isLauncherHandoff({ ...HANDOFF, scan: SCAN })).toBe(true);
    expect(
      isLauncherHandoff({
        ...HANDOFF,
        scan: { ...SCAN, target: { kind: "existing", tripId: "3f1c2a4e" } },
      })
    ).toBe(true);
  });

  it("refuses a hand-off whose scan request is not a scan request", () => {
    const { name: _name, ...nameless } = SCAN;
    for (const scan of [
      null,
      "scan",
      [],
      nameless,
      { ...SCAN, startDay: 20310502 },
      { ...SCAN, endDay: undefined },
      { ...SCAN, inspect: "yes" },
      { ...SCAN, createAlbum: 0 },
      { ...SCAN, target: { kind: "existing" } },
      { ...SCAN, target: { kind: "other" } },
    ]) {
      expect(isLauncherHandoff({ ...HANDOFF, scan })).toBe(false);
    }
  });
});
