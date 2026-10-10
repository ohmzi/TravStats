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
});
