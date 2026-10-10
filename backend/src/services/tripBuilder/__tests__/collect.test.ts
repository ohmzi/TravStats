import type { ImmichAssetDetail } from "../../immich/types";
import { collectWindow, type CollectDeps } from "../collect";
import type { ScanWindow } from "../types";
import {
  HOME_PERIODS,
  ME,
  NORTHVALE,
  PARTNER,
  at,
  nzAsset,
  photosAt,
  preciseFlight,
} from "./builderFixtures";

const BASE = { immichUserId: ME, startDay: "2031-05-02", endDay: "2031-05-04", targetTripId: null };
const TRIP = "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01";

function fakeDeps(
  assets: ImmichAssetDetail[],
  extra: Partial<CollectDeps> = {},
  truncated = false
) {
  const ranges: Array<{ takenAfter: Date; takenBefore: Date }> = [];
  const deps: CollectDeps = {
    immich: {
      searchWindowAssets: async (range, onPage) => {
        ranges.push(range);
        onPage?.(1, assets.length);
        return { assets, truncated };
      },
    },
    loadFlights: async () => [],
    homePeriods: [],
    ...extra,
  };
  return { deps, ranges };
}

describe("collectWindow", () => {
  it("asks Immich for the padded window and forwards each page's progress", async () => {
    const { deps, ranges } = fakeDeps(photosAt("nv", NORTHVALE, ["2031-05-02T10:00"]));
    const pages: Array<[number, number]> = [];

    await collectWindow(deps, { ...BASE, onPage: (page, seen) => pages.push([page, seen]) });

    expect(ranges).toHaveLength(1);
    // S 00:00Z − 3 d − 14 h, and (E+1) 00:00Z + 3 d + 12 h.
    expect(ranges[0].takenAfter.toISOString()).toBe("2031-04-28T10:00:00.000Z");
    expect(ranges[0].takenBefore.toISOString()).toBe("2031-05-08T12:00:00.000Z");
    expect(pages).toEqual([[1, 1]]);
  });

  it("keeps the caller's photos of the window, sets partners aside and keeps neighbours as context", async () => {
    const { deps } = fakeDeps([
      nzAsset({ id: "own-in", local: "2031-05-02T10:00", ...at(NORTHVALE) }),
      nzAsset({ id: "partner", local: "2031-05-02T11:00", ...at(NORTHVALE), ownerId: PARTNER }),
      nzAsset({ id: "own-before", local: "2031-04-30T10:00", ...at(NORTHVALE) }),
    ]);

    const { clean } = await collectWindow(deps, BASE);

    expect(clean.photos.map((p) => p.id)).toEqual(["own-in"]);
    expect(clean.context.map((p) => p.id)).toEqual(["own-before"]);
    expect(clean.albumAssetIds).toEqual(["own-in"]);
    expect(clean.excluded.partner).toBe(1);
  });

  it("drops locked and hidden assets before they can reach the album list", async () => {
    const { deps } = fakeDeps([
      nzAsset({ id: "own-in", local: "2031-05-02T10:00", ...at(NORTHVALE) }),
      nzAsset({
        id: "locked-in",
        local: "2031-05-02T11:00",
        ...at(NORTHVALE),
        visibility: "locked",
      }),
      nzAsset({
        id: "hidden-in",
        local: "2031-05-02T12:00",
        ...at(NORTHVALE),
        visibility: "hidden",
      }),
      nzAsset({
        id: "locked-near",
        local: "2031-04-30T10:00",
        ...at(NORTHVALE),
        visibility: "locked",
      }),
    ]);

    const { clean } = await collectWindow(deps, BASE);

    expect(clean.albumAssetIds).toEqual(["own-in"]);
    expect(clean.photos.map((p) => p.id)).toEqual(["own-in"]);
    expect(clean.context).toEqual([]);
    // A hidden Live Photo half is counted; a locked asset is not an exclusion, it was never offered.
    expect(clean.excluded.hiddenLivePart).toBe(1);
  });

  it("loads the flights for the same window and resolves the home of the first day", async () => {
    const flight = preciseFlight({
      id: "ff0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      label: "ZZ101 ZKM→ZNC",
      depIata: "ZKM",
      arrIata: "ZNC",
      dep: { lat: -45.63, lon: 169.32 },
      arr: { lat: -37.01, lon: 174.79 },
      depLocal: "2031-05-01T22:00",
      arrLocal: "2031-05-01T23:30",
    });
    const loads: Array<[ScanWindow, string | null]> = [];
    const { deps } = fakeDeps([], {
      homePeriods: HOME_PERIODS,
      loadFlights: async (window, target) => {
        loads.push([window, target]);
        return [flight];
      },
    });

    const collected = await collectWindow(deps, { ...BASE, targetTripId: TRIP });

    expect(collected.anchors).toEqual([flight]);
    expect(loads).toHaveLength(1);
    expect(loads[0][0].startDay).toBe("2031-05-02");
    expect(loads[0][1]).toBe(TRIP);
    expect(collected.homeAt("2031-05-02")?.name).toBe("Kelmore, Westshire");
    expect(collected.clock.homeZone).toBe("Pacific/Auckland");
  });

  it("passes Immich's truncation flag through", async () => {
    const { deps } = fakeDeps([], {}, true);
    expect((await collectWindow(deps, BASE)).truncated).toBe(true);
  });
});
