import { describe, expect, it } from "vitest";
import { MAX_SCAN_DAYS, scanWindowIssue } from "../scanWindow";

describe("scanWindowIssue", () => {
  it("wants both days", () => {
    expect(scanWindowIssue("", "2031-05-09")).toBe("missing");
    expect(scanWindowIssue("2031-05-02", "")).toBe("missing");
  });

  it("accepts a one-day window and one of exactly 62 days", () => {
    expect(MAX_SCAN_DAYS).toBe(62);
    expect(scanWindowIssue("2031-05-02", "2031-05-02")).toBeNull();
    expect(scanWindowIssue("2031-05-02", "2031-07-02")).toBeNull();
  });

  it("refuses 63 days", () => {
    expect(scanWindowIssue("2031-05-02", "2031-07-03")).toBe("tooLong");
  });

  it("leaves an end before the start to the form", () => {
    expect(scanWindowIssue("2031-05-09", "2031-05-02")).toBeNull();
  });

  // A date input lets the user type up to six digits into the year, and then
  // reports e.g. "20315-05-02". The popup asks on every render, so this must not throw.
  it.each([
    ["a start with five year digits", "20315-05-02", "2031-05-09"],
    ["an end with six year digits", "2031-05-02", "275760-09-13"],
    ["a start that is not a day at all", "soon", "2031-05-09"],
    ["an end with a trailing time", "2031-05-02", "2031-05-09T00:00:00Z"],
  ])("calls %s missing instead of throwing", (_case, startDay, endDay) => {
    expect(() => scanWindowIssue(startDay, endDay)).not.toThrow();
    expect(scanWindowIssue(startDay, endDay)).toBe("missing");
  });
});
