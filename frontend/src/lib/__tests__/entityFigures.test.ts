import { describe, expect, it } from "vitest";

import { ownDatesDays, roadtripsDrivenKm } from "../entityFigures";
import type { LocalDateValue } from "../../shared/time";

// Synthetic days only (public repository).

const day = (date: string, precision: LocalDateValue["precision"] = "day"): LocalDateValue => ({
  date,
  zone: null,
  precision,
});

describe("roadtripsDrivenKm", () => {
  it("sums the rows' stored driven km", () => {
    expect(roadtripsDrivenKm([{ drivenKm: 812 }, { drivenKm: 254 }])).toBe(1066);
  });

  it("reads an empty journey as no kilometres", () => {
    expect(roadtripsDrivenKm([])).toBe(0);
  });
});

describe("ownDatesDays", () => {
  it("counts both ends of the span — five nights away is six days (2026-10-11)", () => {
    expect(ownDatesDays(day("2031-05-02"), day("2031-05-07"))).toEqual({
      days: 6,
      approximate: false,
    });
  });

  it("is no number at all when either end is missing", () => {
    expect(ownDatesDays(day("2031-05-02"), null)).toBeNull();
    expect(ownDatesDays(null, day("2031-05-07"))).toBeNull();
  });

  it("marks the span approximate while either end is not known to its day", () => {
    expect(ownDatesDays(day("2031-05-02"), day("2031-05-07", "unknown"))).toEqual({
      days: 6,
      approximate: true,
    });
  });
});
