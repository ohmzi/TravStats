import { storedSpanNights } from "../nights";
import type { StoredNight } from "../existingTypes";

/** A stored station as `storedSpanNights` reads it: its dates and its night. */
const span = (
  startDate: string | null,
  endDate: string | null,
  night: StoredNight = "free"
): { startDate: string | null; endDate: string | null; night: StoredNight } => ({
  startDate,
  endDate,
  night,
});

// Synthetic fixtures only (public repository): invented towns, shifted years.

describe("storedSpanNights: the nights a stored station's span covers", () => {
  it("reads the owner's shape: 11-26 to 11-28 holds the nights of 26/27 and 27/28", () => {
    expect(storedSpanNights(span("2031-11-26", "2031-11-28"))).toEqual([
      "2031-11-26",
      "2031-11-27",
    ]);
  });

  it("reads a one-day span as one night and two days as two", () => {
    expect(storedSpanNights(span("2031-05-02", "2031-05-03"))).toEqual(["2031-05-02"]);
    expect(storedSpanNights(span("2031-05-02", "2031-05-04"))).toEqual([
      "2031-05-02",
      "2031-05-03",
    ]);
  });

  it("reads a span dated at one end only as the one night at that day", () => {
    expect(storedSpanNights(span("2031-05-02", null))).toEqual(["2031-05-02"]);
    expect(storedSpanNights(span(null, "2031-05-02"))).toEqual(["2031-05-02"]);
  });

  it("reads a same-day span as one night, never none", () => {
    expect(storedSpanNights(span("2031-05-02", "2031-05-02"))).toEqual(["2031-05-02"]);
  });

  it("holds no night for a pass-through or a route correction", () => {
    expect(storedSpanNights(span("2031-05-02", "2031-05-04", "pass"))).toEqual([]);
    expect(storedSpanNights(span("2031-05-02", "2031-05-04", "via"))).toEqual([]);
  });

  it("holds no day-nameable night for a slept station with no dates at all", () => {
    expect(storedSpanNights(span(null, null))).toEqual([]);
  });

  it("reads a stay by the same span rule (the dates it carries)", () => {
    expect(storedSpanNights(span("2031-05-07", "2031-05-09", "stay"))).toEqual([
      "2031-05-07",
      "2031-05-08",
    ]);
  });
});
