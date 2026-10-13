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

  it("splits two named places farther apart than one place's link, however compact the chain", () => {
    // The live "Sumayya's wedding" shape (synthetic places, 2026-10-13): the
    // city's photos chain through a handful of drive-by photos to a place
    // 33 km out, so the whole cluster stays under 60 km wide and carries the
    // two names the stay stood in — the city's 8 photos and the place's 4.
    // The names' medians are farther apart than CITY_LINK_KM, the cluster's
    // own "one place" scale, so the chain is cut along them.
    const bridged = [
      ...row("n", -45.0, 6, "Northvale", 6),
      photo(
        "d1",
        "2031-05-05 12:00",
        { lat: -44.85, lon: 168.7 },
        { city: "Northvale", state: WESTSHIRE }
      ),
      photo(
        "d2",
        "2031-05-05 13:00",
        { lat: -44.85, lon: 168.7 },
        { city: "Northvale", state: WESTSHIRE }
      ),
      ...row("p", -44.7, 4, "Port Carrow", 14),
    ];
    expect(clusterCities(bridged).map((c) => [c.id, c.immichCity, c.photoIds.length])).toEqual([
      ["c1", "Northvale", 8],
      ["c2", "Port Carrow", 4],
    ]);
  });

  it("merges the names of a cluster whose groups lie within one place's link", () => {
    // Northvale and Port Carrow 27.8 km apart: closer than CITY_LINK_KM, so
    // the split merges them back — a metro area with two names is one place.
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

  it("numbers a split's pieces around a cluster whose first photo falls between theirs", () => {
    // Time order: the north piece (n, e), a home photo at 11:30, then the south piece (p, q).
    // The chain is one linkage group, so its two pieces come out of the split side by side;
    // only sorting by first photo puts the home photo between them.
    const input = [
      ...row("n", -45.0, 3, "Northvale", 6),
      ...row("e", -44.93, 3, "Northvale East", 9),
      photo("h1", "2031-05-05 11:30", KELMORE),
      ...row("p", -44.7, 2, "Port Carrow", 12),
      ...row("q", -44.45, 2, "Port Carrow", 14),
    ];
    const clusters = clusterCities(input);
    expect(clusters.map((c) => [c.id, c.photoIds[0], c.photoIds.length])).toEqual([
      ["c1", "n1", 6],
      ["c2", "h1", 1],
      ["c3", "p1", 4],
    ]);
  });
});
