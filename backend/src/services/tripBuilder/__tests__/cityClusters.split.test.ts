import { clusterCities } from "../cityClusters";
import { KELMORE, photo } from "./placeFixtures";

const WESTSHIRE = "Westshire";

/** `count` photos on one meridian, an hour apart from `startHour`, all named `city`. */
const row = (prefix: string, lat: number, count: number, city: string, startHour: number) =>
  Array.from({ length: count }, (_, i) =>
    photo(
      `${prefix}${i + 1}`,
      `2031-05-05 ${String(startHour + i).padStart(2, "0")}:00`,
      { lat, lon: 168.7 },
      { city, state: WESTSHIRE }
    )
  );

// n -> e 7.8 km, e -> p 25.6 km, p -> q 27.8 km: one chain 61 km long.
const chain = () => [
  ...row("n", -45.0, 3, "Northvale", 6),
  ...row("e", -44.93, 3, "Northvale East", 9),
  ...row("p", -44.7, 2, "Port Carrow", 12),
  ...row("q", -44.45, 2, "Port Carrow", 14),
];

describe("clusterCities: a chain that runs two cities together", () => {
  it("splits by Immich city and state, and merges names that are the same place", () => {
    const clusters = clusterCities(chain());
    expect(clusters.map((c) => [c.id, c.immichCity, c.photoIds.length])).toEqual([
      ["c1", "Northvale", 6],
      ["c2", "Port Carrow", 4],
    ]);
    expect(clusters[0].photoIds).toEqual(["n1", "n2", "n3", "e1", "e2", "e3"]);
  });

  it("sends a stray one-photo name to the nearest group", () => {
    const stray = photo(
      "s1",
      "2031-05-05 11:30",
      { lat: -44.8, lon: 168.7 },
      { city: "Stray Hollow", state: WESTSHIRE }
    );
    const clusters = clusterCities([...chain(), stray]);
    expect(clusters.map((c) => c.photoIds.length)).toEqual([7, 4]);
    expect(clusters[0].photoIds).toContain("s1");
  });

  it("leaves the cluster whole when Immich names all of it one place", () => {
    const oneName = chain().map((p) => ({ ...p, city: "Northvale" }));
    const clusters = clusterCities(oneName);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].spreadKm).toBeGreaterThan(60);
  });

  it("leaves the cluster whole when only one name has enough photos to stand alone", () => {
    // Four links of about 27 km: 80 km end to end, but only Northvale has 3 photos.
    const lone = [
      ...row("n", -45.0, 4, "Northvale", 6),
      ...row("p", -44.76, 2, "Port Carrow", 12),
      ...row("q", -44.52, 1, "Hillside", 14),
      ...row("r", -44.28, 1, "Dunmore", 15),
    ];
    const clusters = clusterCities(lone);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].spreadKm).toBeGreaterThan(60);
  });

  it("does not split a cluster under 60 km however many names it carries", () => {
    const compact = [
      ...row("n", -45.0, 3, "Northvale", 6),
      ...row("e", -44.75, 3, "Port Carrow", 9),
    ];
    expect(clusterCities(compact)).toHaveLength(1);
  });

  it("numbers the pieces of a split in discovery order among the other clusters", () => {
    const home = photo("h1", "2031-05-04 08:00", KELMORE);
    const clusters = clusterCities([home, ...chain()]);
    expect(clusters.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(clusters[0].photoIds).toEqual(["h1"]);
  });
});
