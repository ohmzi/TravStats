const mockResolveRouteProvider = jest.fn();
jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: (userId?: string) => mockResolveRouteProvider(userId),
}));
// The probes log a warning when they fail; keep it out of the test output.
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type { RouteProvider } from "../../tour/routing/types";
import { mapWithConcurrency, resolveRoadProbes } from "../probe";

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
