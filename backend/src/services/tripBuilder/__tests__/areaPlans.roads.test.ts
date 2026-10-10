import { emptyMovement, roadsPhase, type BuiltArea } from "../areaPlans";
import type { RoadProbes } from "../probe";
import { NORTHVALE, PORT_CARROW, builderDeps } from "./builderFixtures";
import { groundArea, noHome, planOf, station } from "./planFixtures";

const STATIONS = [
  station("a", { lat: NORTHVALE.lat, lon: NORTHVALE.lon }),
  station("b", { lat: PORT_CARROW.lat, lon: PORT_CARROW.lon }),
  station("c", { lat: NORTHVALE.lat, lon: NORTHVALE.lon }),
];

function builtArea(): BuiltArea {
  const build = planOf(STATIONS);
  return {
    part: { key: "2031-05-02#1", area: groundArea(), segments: [] },
    build,
    stations: build.stations,
    home: noHome(),
  };
}

function depsWith(probes: RoadProbes | null) {
  return builderDeps([], { roads: { available: true, canProbe: probes !== null, probes } });
}

describe("roadsPhase: stations the router has no road data for", () => {
  const route = { distanceKm: 80, ferryKm: 0 };

  it("names both ends of a leg with no route, and nothing else", async () => {
    const probes: RoadProbes = {
      snap: async (c) => c,
      probe: async (_a, b) => (b.lat === PORT_CARROW.lat ? route : null),
    };

    const { plans, noRoadData } = await roadsPhase(depsWith(probes), emptyMovement([]), [
      builtArea(),
    ]);

    expect(plans[0].legs).toHaveLength(2);
    expect(noRoadData).toEqual(["b", "c"]);
  });

  it("reports a station once when both the snap and a leg have no road for it", async () => {
    const probes: RoadProbes = {
      snap: async (c) => (c.lat === PORT_CARROW.lat ? null : c),
      probe: async () => null,
    };

    const { noRoadData } = await roadsPhase(depsWith(probes), emptyMovement([]), [builtArea()]);

    expect(noRoadData).toEqual(["b", "a", "c"]);
  });

  it("does not read a missing router as a missing road", async () => {
    const { plans, noRoadData } = await roadsPhase(depsWith(null), emptyMovement([]), [
      builtArea(),
    ]);

    expect(plans[0].legs).toHaveLength(2);
    expect(noRoadData).toEqual([]);
  });
});
