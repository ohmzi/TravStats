import { describe, it, expect } from "vitest";

import { roadtripSummaryFigures } from "../roadtripSummaryFigures";

/** Count-aware, like `t()` with `{ count }` — the singular is the point (forgejo#160). */
const labels = {
  roadtrips: (count: number) => (count === 1 ? "Roadtrip" : "Roadtrips"),
  drives: (count: number) => (count === 1 ? "Etappe" : "Etappen"),
  stations: (count: number) => (count === 1 ? "Station" : "Stationen"),
};

const figure = (rows: Parameters<typeof roadtripSummaryFigures>[0], key: string) =>
  roadtripSummaryFigures(rows, labels).find((f) => f.key === key);

describe("roadtripSummaryFigures", () => {
  // There is NO distance figure: a chord leg (`source: "straight"`) and a
  // routed one must not be summed into one measured-looking total — the rule
  // rail, rental and flight share. The first figure is the row count every
  // sibling strip carries.
  it("counts the shown roadtrips, drives and stations, and offers no distance", () => {
    const rows = [
      { driveCount: 1, stationCount: 2 },
      { driveCount: 2, stationCount: 3 },
    ];
    expect(roadtripSummaryFigures(rows, labels).map((f) => f.key)).toEqual([
      "roadtrips",
      "drives",
      "stations",
    ]);
    expect(figure(rows, "roadtrips")?.value).toBe("2");
    expect(figure(rows, "drives")?.value).toBe("3");
    expect(figure(rows, "stations")?.value).toBe("5");
  });

  // A via point is a leg endpoint too, so a route that bends records more drives
  // than `stations - 1`; the backend counts the road legs it holds.
  it("sums the backend's driveCount, so a via point's extra leg counts", () => {
    expect(figure([{ driveCount: 3, stationCount: 3 }], "drives")?.value).toBe("3");
  });

  // A ferry-only crossing records no road leg: 0 drives, honestly — the same
  // rule that gives its card 0 km (drivenKm counts road legs only).
  it("counts zero drives when no leg is a road leg", () => {
    const rows = [{ driveCount: 0, stationCount: 2 }];
    expect(figure(rows, "drives")?.value).toBe("0");
    expect(figure(rows, "stations")?.value).toBe("2");
  });

  it("reports zeroes for an empty list", () => {
    expect(figure([], "roadtrips")?.value).toBe("0");
    expect(figure([], "drives")?.value).toBe("0");
    expect(figure([], "stations")?.value).toBe("0");
  });
});

/**
 * forgejo#160 — each label is handed the number it stands beside, so the
 * translation can pick the singular; a label resolved once without a count
 * cannot.
 */
describe("summary labels agree with their own figure (forgejo#160)", () => {
  it("feeds drives its own total, not another figure's", () => {
    expect(figure([{ driveCount: 1, stationCount: 9 }], "drives")?.label).toBe("Etappe");
    expect(figure([{ driveCount: 2, stationCount: 9 }], "drives")?.label).toBe("Etappen");
  });

  it("feeds stations its own total", () => {
    expect(figure([{ driveCount: 9, stationCount: 1 }], "stations")?.label).toBe("Station");
    expect(figure([{ driveCount: 9, stationCount: 2 }], "stations")?.label).toBe("Stationen");
  });

  it("feeds the row count its own total", () => {
    expect(figure([{ driveCount: 0, stationCount: 0 }], "roadtrips")?.label).toBe("Roadtrip");
    expect(
      figure(
        [
          { driveCount: 0, stationCount: 0 },
          { driveCount: 0, stationCount: 0 },
        ],
        "roadtrips"
      )?.label
    ).toBe("Roadtrips");
  });
});
