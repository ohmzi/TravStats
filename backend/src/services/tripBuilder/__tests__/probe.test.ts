const mockResolveRouteProvider = jest.fn();
jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: (userId?: string) => mockResolveRouteProvider(userId),
}));
// The probes log a warning when they fail; keep it out of the test output.
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { createCustomOsrm } from "../../tour/routing/customOsrm";
import type { RouteProvider } from "../../tour/routing/types";
import {
  mapWithConcurrency,
  probeLegs,
  resolveRoadProbes,
  snapStations,
  stationsWithoutRoute,
  type RoadProbes,
} from "../probe";
import type { PlanStation, StationKind } from "../types";

// Synthetic coordinates (public repository): two invented towns.
const NORTHVALE = { lat: -45.05, lon: 168.7 };
const PORT_CARROW = { lat: -44.4, lon: 171.25 };

function provider(over: Partial<RouteProvider> = {}): RouteProvider {
  return {
    id: "custom",
    route: jest.fn(async () => null),
    probe: jest.fn(async () => ({ distanceKm: 214, ferryKm: 90 })),
    snap: jest.fn(async (c) => ({ lat: c.lat + 0.001, lon: c.lon })),
    ...over,
  };
}

describe("resolveRoadProbes", () => {
  it("has no roads when no routing provider is configured", async () => {
    mockResolveRouteProvider.mockReset();
    mockResolveRouteProvider.mockResolvedValueOnce(null);

    expect(await resolveRoadProbes("user-1")).toEqual({
      available: false,
      canProbe: false,
      probes: null,
    });
    expect(mockResolveRouteProvider).toHaveBeenCalledWith("user-1");
  });

  it("has roads but cannot probe through a hosted provider", async () => {
    mockResolveRouteProvider.mockReset();
    const hosted = provider({ id: "openrouteservice", probe: undefined, snap: undefined });
    mockResolveRouteProvider.mockResolvedValueOnce(hosted);

    expect(await resolveRoadProbes("user-1")).toEqual({
      available: true,
      canProbe: false,
      probes: null,
    });
  });

  it("cannot probe through a custom provider that offers only one of the two questions", async () => {
    mockResolveRouteProvider.mockReset();
    mockResolveRouteProvider.mockResolvedValueOnce(provider({ snap: undefined }));

    const access = await resolveRoadProbes("user-1");

    expect([access.available, access.canProbe, access.probes]).toEqual([true, false, null]);
  });

  it("binds probe and snap to the self-hosted provider", async () => {
    mockResolveRouteProvider.mockReset();
    const custom = provider();
    mockResolveRouteProvider.mockResolvedValueOnce(custom);

    const access = await resolveRoadProbes("user-1");

    expect([access.available, access.canProbe]).toEqual([true, true]);
    expect(await access.probes?.probe(NORTHVALE, PORT_CARROW)).toEqual({
      distanceKm: 214,
      ferryKm: 90,
    });
    expect(custom.probe).toHaveBeenCalledWith(NORTHVALE, PORT_CARROW);
    expect(await access.probes?.snap(NORTHVALE)).toEqual({ lat: -45.049, lon: 168.7 });
    expect(custom.snap).toHaveBeenCalledWith(NORTHVALE);
  });

  it("reads a provider that answers nothing as null", async () => {
    mockResolveRouteProvider.mockReset();
    mockResolveRouteProvider.mockResolvedValueOnce(
      provider({ probe: jest.fn(async () => null), snap: jest.fn(async () => null) })
    );

    const access = await resolveRoadProbes("user-1");

    expect(await access.probes?.probe(NORTHVALE, PORT_CARROW)).toBeNull();
    expect(await access.probes?.snap(NORTHVALE)).toBeNull();
  });

  it("has no roads, rather than failing the scan, when the provider cannot be resolved", async () => {
    mockResolveRouteProvider.mockReset();
    mockResolveRouteProvider.mockRejectedValueOnce(new Error("database is down"));

    expect(await resolveRoadProbes("user-1")).toEqual({
      available: false,
      canProbe: false,
      probes: null,
    });
  });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("returns the results in input order even when later items finish first", async () => {
    const out = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms, i) => {
      await sleep(ms);
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:20", "2:10", "3:0"]);
  });

  it("never runs more than the limit at once, and uses the whole limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(5);
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBe(4);
  });

  it("treats a limit below one as one, and an empty list as nothing to do", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(2);
      running--;
    });
    expect(peak).toBe(1);
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("rejects when one of the calls rejects", async () => {
    const failing = mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    await expect(failing).rejects.toThrow("boom");
  });
});

function station(key: string, kind: StationKind, at = NORTHVALE): PlanStation {
  return {
    key,
    title: key,
    titleSource: "immich",
    kind,
    lat: at.lat,
    lon: at.lon,
    snappedKm: null,
    firstDay: "2031-05-02",
    lastDay: "2031-05-02",
    firstLocal: "2031-05-02 09:00",
    lastLocal: "2031-05-02 17:00",
    photoCount: 12,
    previewIdx: [],
    notes: null,
  };
}

/** Roads a given number of degrees of latitude from every station (0.018° ≈ 2 km). */
function roadsAt(offsetDeg: number | null): RoadProbes {
  return {
    probe: jest.fn(async () => ({ distanceKm: 100, ferryKm: 0 })),
    snap: jest.fn(async (c: { lat: number; lon: number }) =>
      offsetDeg === null ? null : { lat: c.lat + offsetDeg, lon: c.lon }
    ),
  };
}

describe("snapStations", () => {
  it("moves a station 2 km from the road onto it and says how far it moved", async () => {
    const probes = roadsAt(0.018);

    const { stations, noRoadData } = await snapStations([station("n", "visit")], probes);

    expect(noRoadData).toEqual([]);
    expect(stations[0].lat).toBeCloseTo(-45.032, 6);
    expect(stations[0].lon).toBe(168.7);
    expect(stations[0].snappedKm).toBeCloseTo(2, 1);
  });

  it("leaves a station within 0.9 km of the road where it is", async () => {
    const { stations, noRoadData } = await snapStations([station("n", "visit")], roadsAt(0.004));

    expect(stations[0].lat).toBe(-45.05);
    expect(stations[0].snappedKm).toBeNull();
    expect(noRoadData).toEqual([]);
  });

  it("leaves a station more than 10 km from any road and reports it", async () => {
    const probes = roadsAt(0.108);

    const { stations, noRoadData } = await snapStations(
      [station("n", "visit"), station("p", "brief", PORT_CARROW)],
      probes
    );

    expect(stations.map((s) => [s.lat, s.snappedKm])).toEqual([
      [-45.05, null],
      [-44.4, null],
    ]);
    expect(noRoadData).toEqual(["n", "p"]);
  });

  it("reports a station the router has no road for", async () => {
    const { stations, noRoadData } = await snapStations([station("n", "dayTrip")], roadsAt(null));

    expect(stations[0].lat).toBe(-45.05);
    expect(noRoadData).toEqual(["n"]);
  });

  it("does not ask about an airport or a home station", async () => {
    const probes = roadsAt(0.018);

    const { stations, noRoadData } = await snapStations(
      [station("a", "airport"), station("h", "home")],
      probes
    );

    expect(probes.snap).not.toHaveBeenCalled();
    expect(stations.map((s) => s.snappedKm)).toEqual([null, null]);
    expect(noRoadData).toEqual([]);
  });

  it("treats a probe that throws as no road", async () => {
    const probes: RoadProbes = {
      probe: jest.fn(async () => null),
      snap: jest.fn(async () => {
        throw new Error("socket hang up");
      }),
    };

    const { noRoadData } = await snapStations([station("n", "visit")], probes);

    expect(noRoadData).toEqual(["n"]);
  });

  it("changes and reports nothing without probes", async () => {
    const input = [station("n", "visit")];

    const { stations, noRoadData } = await snapStations(input, null);

    expect(stations).toEqual(input);
    expect(noRoadData).toEqual([]);
  });
});

describe("probeLegs", () => {
  const three = [station("n", "visit"), station("e", "visit"), station("p", "visit", PORT_CARROW)];

  it("asks about each consecutive pair, in order", async () => {
    const probe = jest.fn(async (a: { lat: number }, b: { lat: number }) => ({
      distanceKm: Math.abs(b.lat - a.lat),
      ferryKm: 0,
    }));

    const legs = await probeLegs(three, { probe, snap: jest.fn(async () => null) });

    expect(legs).toHaveLength(2);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls[0][0]).toMatchObject({ lat: -45.05 });
    expect(legs[1]?.distanceKm).toBeCloseTo(0.65, 6);
  });

  it("is null for a leg the router cannot answer, whether it says so or throws", async () => {
    const answers = [null, new Error("socket hang up")];
    const probe = jest.fn(async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    });

    const legs = await probeLegs(three, { probe, snap: jest.fn(async () => null) });

    expect(legs).toEqual([null, null]);
  });

  it("asks nothing and answers null for every leg without probes", async () => {
    expect(await probeLegs(three, null)).toEqual([null, null]);
    expect(await probeLegs([], null)).toEqual([]);
    expect(await probeLegs([three[0]], null)).toEqual([]);
  });

  it("asks at most four legs at a time", async () => {
    const many = Array.from({ length: 10 }, (_, i) => station(`s${i}`, "visit"));
    let running = 0;
    let peak = 0;
    const probe = jest.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(5);
      running--;
      return { distanceKm: 1, ferryKm: 0 };
    });

    const legs = await probeLegs(many, { probe, snap: jest.fn(async () => null) });

    expect(legs).toHaveLength(9);
    expect(peak).toBe(4);
  });
});

describe("a router that accepts and never answers", () => {
  /**
   * The real custom OSRM adapter in front of a hung worker: it settles only
   * when the request's own signal aborts it, the way a real fetch does. The
   * adapter's bound is tiny here only so the test does not wait the real one.
   */
  function stalledRoads(boundMs: number): RoadProbes {
    const stalled = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new Error("aborted"))
        );
      });
    const provider = createCustomOsrm(
      "http://osrm.local:5000",
      stalled as unknown as typeof fetch,
      boundMs
    );
    return {
      probe: async (a, b) => (await provider.probe?.(a, b)) ?? null,
      snap: async (c) => (await provider.snap?.(c)) ?? null,
    };
  }

  it("reads the scan's road questions as no answer once the adapter's bound passes", async () => {
    const probes = stalledRoads(20);

    const { noRoadData } = await snapStations([station("n", "visit")], probes);
    expect(noRoadData).toEqual(["n"]);

    const legs = await probeLegs(
      [station("n", "visit"), station("p", "visit", PORT_CARROW)],
      probes
    );
    expect(legs).toEqual([null]);
  });
});

describe("stationsWithoutRoute", () => {
  const keyed = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  const found = { distanceKm: 40, ferryKm: 0 };

  it("names both ends of each leg with no route, once each, in order", () => {
    expect(stationsWithoutRoute(keyed, [null, found, null])).toEqual(["a", "b", "c", "d"]);
    expect(stationsWithoutRoute(keyed, [found, null, found])).toEqual(["b", "c"]);
    expect(stationsWithoutRoute(keyed, [null, null, found])).toEqual(["a", "b", "c"]);
  });

  it("names nothing when every leg has a route", () => {
    expect(stationsWithoutRoute(keyed, [found, found, found])).toEqual([]);
    expect(stationsWithoutRoute([], [])).toEqual([]);
  });
});
