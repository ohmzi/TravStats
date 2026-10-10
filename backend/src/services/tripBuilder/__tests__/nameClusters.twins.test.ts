import type { GeocodeParts } from "../../geo/nominatim";
import { nameClusters } from "../nameClusters";
import type { CityCluster, ExistingTitle } from "../types";
import { NORTHVALE } from "./placeFixtures";

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

const deps = (existingTitles: ExistingTitle[] = []) => ({
  existingTitles,
  reverseGeocode: jest.fn(async (): Promise<GeocodeParts | null> => null),
  home: null,
});

// A degree of latitude, about 111 km, north of Northvale.
const SECOND = { lat: NORTHVALE.lat + 1, lon: NORTHVALE.lon };

describe("nameClusters: two places with one name", () => {
  it("tells them apart by state when they lie more than 30 km apart", async () => {
    const named = await nameClusters(
      [
        cluster("c1", NORTHVALE, { immichCity: "Northvale", immichState: "Westshire" }),
        cluster("c2", SECOND, { immichCity: "Northvale", immichState: "Eastshire" }),
      ],
      deps()
    );
    expect(named.map((c) => c.title)).toEqual(["Northvale, Westshire", "Northvale, Eastshire"]);
  });

  it("falls back to the country, and leaves a pair with nothing to tell them apart", async () => {
    const byCountry = await nameClusters(
      [
        cluster("c1", NORTHVALE, { immichCity: "Northvale", immichCountry: "NZ" }),
        cluster("c2", SECOND, { immichCity: "Northvale", immichCountry: "AU" }),
      ],
      deps()
    );
    expect(byCountry.map((c) => c.title)).toEqual(["Northvale, NZ", "Northvale, AU"]);
    const bare = await nameClusters(
      [
        cluster("c1", NORTHVALE, { immichCity: "Northvale" }),
        cluster("c2", SECOND, { immichCity: "Northvale" }),
      ],
      deps()
    );
    expect(bare.map((c) => c.title)).toEqual(["Northvale", "Northvale"]);
  });

  it("keeps the plain title when the twins are within 30 km of each other", async () => {
    const named = await nameClusters(
      [
        cluster("c1", NORTHVALE, { immichCity: "Northvale", immichState: "Westshire" }),
        cluster(
          "c2",
          { lat: NORTHVALE.lat + 0.1, lon: NORTHVALE.lon },
          {
            immichCity: "Northvale",
            immichState: "Westshire",
          }
        ),
      ],
      deps()
    );
    expect(named.map((c) => c.title)).toEqual(["Northvale", "Northvale"]);
  });

  it("never rewrites a title the user already had", async () => {
    const existing: ExistingTitle[] = [
      { title: "Northvale", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
      { title: "Northvale", lat: SECOND.lat, lon: SECOND.lon },
    ];
    const named = await nameClusters(
      [
        cluster("c1", NORTHVALE, { immichState: "Westshire" }),
        cluster("c2", SECOND, { immichState: "Eastshire" }),
      ],
      deps(existing)
    );
    expect(named.map((c) => c.title)).toEqual(["Northvale", "Northvale"]);
  });
});
