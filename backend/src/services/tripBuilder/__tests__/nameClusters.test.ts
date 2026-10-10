import type { GeocodeParts } from "../../geo/nominatim";
import { nameClusters } from "../nameClusters";
import type { CityCluster, ExistingTitle, HomeAtDay } from "../types";
import { KELMORE, NORTHVALE, PORT_CARROW } from "./placeFixtures";

function cluster(
  id: string,
  at: { lat: number; lon: number },
  overrides: Partial<CityCluster> = {}
): CityCluster {
  return {
    id,
    photoIds: [`${id}-1`],
    lat: at.lat,
    lon: at.lon,
    spreadKm: 1,
    immichCity: null,
    immichState: null,
    immichCountry: null,
    ...overrides,
  };
}

const HOME: HomeAtDay = {
  name: "Kelmore, Westshire",
  lat: KELMORE.lat,
  lon: KELMORE.lon,
  confirmed: true,
  zone: "Pacific/Auckland",
  airports: new Set(["KMR"]),
};

const noGeocoder = () => jest.fn(async (): Promise<GeocodeParts | null> => null);

describe("nameClusters: the title chain", () => {
  it("reuses the user's own station title within 5 km, ahead of Immich", async () => {
    const existing: ExistingTitle[] = [
      { title: "Northvale, Westshire", lat: NORTHVALE.lat + 0.027, lon: NORTHVALE.lon },
    ];
    const reverseGeocode = noGeocoder();
    const [named] = await nameClusters([cluster("c1", NORTHVALE, { immichCity: "Northvale" })], {
      existingTitles: existing,
      reverseGeocode,
      home: null,
    });
    expect([named.title, named.titleSource]).toEqual(["Northvale, Westshire", "existing"]);
    expect(reverseGeocode).toHaveBeenCalledTimes(0);
  });

  it("takes the nearest of two own titles, and ignores one 6 km away", async () => {
    const existing: ExistingTitle[] = [
      { title: "Far Reach", lat: NORTHVALE.lat + 0.054, lon: NORTHVALE.lon },
      { title: "Near Reach", lat: NORTHVALE.lat + 0.018, lon: NORTHVALE.lon },
    ];
    const [named] = await nameClusters([cluster("c1", NORTHVALE)], {
      existingTitles: existing,
      reverseGeocode: noGeocoder(),
      home: null,
    });
    expect(named.title).toBe("Near Reach");
    const [alone] = await nameClusters([cluster("c1", NORTHVALE, { immichCity: "Northvale" })], {
      existingTitles: [existing[0]],
      reverseGeocode: noGeocoder(),
      home: null,
    });
    expect([alone.title, alone.titleSource]).toEqual(["Northvale", "immich"]);
  });

  it("falls back to Immich's city, then to a geocoded city, then to coordinates", async () => {
    const reverseGeocode = jest.fn(async (lat: number): Promise<GeocodeParts | null> =>
      lat === PORT_CARROW.lat ? { city: "  Port Carrow " } : null
    );
    const named = await nameClusters(
      [
        cluster("c1", NORTHVALE, { immichCity: "Northvale" }),
        cluster("c2", PORT_CARROW),
        cluster("c3", { lat: -44.2, lon: 170.1 }),
      ],
      { existingTitles: [], reverseGeocode, home: null }
    );
    expect(named.map((c) => [c.title, c.titleSource])).toEqual([
      ["Northvale", "immich"],
      ["Port Carrow", "geocode"],
      ["-44.20, 170.10", "coords"],
    ]);
  });

  it("treats a geocoder that throws as having no answer", async () => {
    const reverseGeocode = jest.fn(async (): Promise<GeocodeParts | null> => {
      throw new Error("Nominatim is down");
    });
    const [named] = await nameClusters([cluster("c1", PORT_CARROW)], {
      existingTitles: [],
      reverseGeocode,
      home: null,
    });
    expect(named.titleSource).toBe("coords");
  });

  it("makes at most 20 lookups and spends them on the biggest clusters", async () => {
    const many = Array.from({ length: 22 }, (_, i) =>
      cluster(
        `c${i + 1}`,
        { lat: -40 - i * 0.5, lon: 170 },
        {
          photoIds: Array.from({ length: i + 1 }, (_, j) => `c${i + 1}-${j}`),
        }
      )
    );
    const reverseGeocode = jest.fn(async (lat: number): Promise<GeocodeParts | null> => ({
      city: `Town ${Math.abs(lat)}`,
    }));
    const named = await nameClusters(many, { existingTitles: [], reverseGeocode, home: null });
    expect(reverseGeocode).toHaveBeenCalledTimes(20);
    expect(named.slice(0, 2).map((c) => c.titleSource)).toEqual(["coords", "coords"]);
    expect(named.slice(2).every((c) => c.titleSource === "geocode")).toBe(true);
  });

  it("names nothing for no clusters", async () => {
    expect(
      await nameClusters([], { existingTitles: [], reverseGeocode: noGeocoder(), home: null })
    ).toEqual([]);
  });
});

describe("nameClusters: home", () => {
  it("flags the home cluster and titles it with the residence's town, without a lookup", async () => {
    const reverseGeocode = noGeocoder();
    const named = await nameClusters(
      [cluster("c1", { lat: KELMORE.lat + 0.1, lon: KELMORE.lon }), cluster("c2", NORTHVALE)],
      { existingTitles: [], reverseGeocode, home: HOME }
    );
    expect(named.map((c) => [c.isHome, c.title, c.titleSource])).toEqual([
      [true, "Kelmore", "home"],
      [false, "-45.05, 168.70", "coords"],
    ]);
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it("still prefers Immich's city for the home cluster", async () => {
    const [named] = await nameClusters([cluster("c1", KELMORE, { immichCity: "Kelmore East" })], {
      existingTitles: [],
      reverseGeocode: noGeocoder(),
      home: HOME,
    });
    expect([named.isHome, named.title, named.titleSource]).toEqual([
      true,
      "Kelmore East",
      "immich",
    ]);
  });

  it("flags nothing without a home", async () => {
    const [named] = await nameClusters([cluster("c1", KELMORE, { immichCity: "Kelmore" })], {
      existingTitles: [],
      reverseGeocode: noGeocoder(),
      home: null,
    });
    expect(named.isHome).toBe(false);
  });
});
