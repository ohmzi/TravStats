import { describe, expect, it } from "vitest";
import { MAX_SCAN_DAYS, dayOf, inclusiveDays, scanWindowIssue, windowIssue } from "../scanWindow";

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

describe("dayOf and inclusiveDays", () => {
  it("read the calendar day an ISO string or a bare day starts with", () => {
    expect(dayOf("2031-05-02T00:00:00.000Z")).toBe("2031-05-02");
    expect(dayOf("2031-05-02")).toBe("2031-05-02");
    expect(dayOf(null)).toBeNull();
    expect(dayOf(undefined)).toBeNull();
    expect(dayOf("")).toBeNull();
    expect(dayOf("May 2")).toBeNull();
  });

  it("count both ends, across a month, a year and a leap day", () => {
    expect(inclusiveDays("2031-05-02", "2031-05-02")).toBe(1);
    expect(inclusiveDays("2031-05-02", "2031-07-02")).toBe(62);
    expect(inclusiveDays("2031-12-30", "2032-01-02")).toBe(4);
    expect(inclusiveDays("2032-02-28", "2032-03-01")).toBe(3);
  });
});

describe("windowIssue", () => {
  it("accepts one day and exactly the longest window", () => {
    expect(windowIssue("2031-05-02", "2031-05-02")).toBeNull();
    expect(windowIssue("2031-05-02", "2031-07-02")).toBeNull();
  });

  it("refuses a window one day too long", () => {
    expect(windowIssue("2031-05-02", "2031-07-03")).toBe("tooLong");
  });

  it("refuses an end before the start", () => {
    expect(windowIssue("2031-05-02", "2031-05-01")).toBe("reversed");
  });

  it("refuses a day that is missing, as an empty date field is", () => {
    expect(windowIssue("", "2031-05-01")).toBe("incomplete");
    expect(windowIssue("2031-05-02", "")).toBe("incomplete");
  });

  // The same strictness as scanWindowIssue: only a bare day is a day, so an ISO
  // datetime or a half-typed year reads as incomplete rather than throwing.
  it.each([
    ["a start with five year digits", "20315-05-02", "2031-05-09"],
    ["an end with six year digits", "2031-05-02", "275760-09-13"],
    ["a start that is not a day at all", "soon", "2031-05-09"],
    ["an end with a trailing time", "2031-05-02", "2031-05-09T00:00:00Z"],
  ])("calls %s incomplete instead of throwing", (_case, startDay, endDay) => {
    expect(() => windowIssue(startDay, endDay)).not.toThrow();
    expect(windowIssue(startDay, endDay)).toBe("incomplete");
  });

  it("is what scanWindowIssue maps: incomplete is missing, reversed is left to the form", () => {
    expect(scanWindowIssue("", "2031-05-09")).toBe("missing");
    expect(scanWindowIssue("2031-05-09", "2031-05-02")).toBeNull();
    expect(scanWindowIssue("2031-05-02", "2031-07-03")).toBe("tooLong");
  });
});
