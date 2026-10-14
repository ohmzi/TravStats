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

/** Minutes after 06:00 on 2031-06-01 — one clock for a whole island's photos. */
const minute = (sinceSix: number): string => {
  const [hours, mins] = [Math.floor((360 + sinceSix) / 60), (360 + sinceSix) % 60];
  return `2031-06-01 ${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

// n -> e 7.8 km, e -> p 25.6 km, p -> q 27.8 km: one chain 61 km long.
const chain = () => [
  ...row("n", -45.0, 3, "Northvale", 6),
  ...row("e", -44.93, 3, "Northvale East", 9),
  ...row("p", -44.7, 2, "Port Carrow", 12),
  ...row("q", -44.45, 2, "Port Carrow", 14),
];

describe("clusterCities: a chain that runs named places together", () => {
  it("splits by Immich city and state, each named place standing alone", () => {
    const clusters = clusterCities(chain());
    expect(clusters.map((c) => [c.id, c.immichCity, c.photoIds.length])).toEqual([
      ["c1", "Northvale", 3],
      ["c2", "Northvale East", 3],
      ["c3", "Port Carrow", 4],
    ]);
    expect(clusters[0].photoIds).toEqual(["n1", "n2", "n3"]);
    expect(clusters[1].photoIds).toEqual(["e1", "e2", "e3"]);
  });

  it("sends a stray one-photo name to the nearest group", () => {
    const stray = photo(
      "s1",
      "2031-05-05 11:30",
      { lat: -44.8, lon: 168.7 },
      { city: "Stray Hollow", state: WESTSHIRE }
    );
    // Stray Hollow's median sits nearest Northvale East (14.5 km) — not
    // Northvale (22.2 km) or Port Carrow (25 km) — so it joins its four.
    const clusters = clusterCities([...chain(), stray]);
    expect(clusters.map((c) => c.photoIds.length)).toEqual([3, 4, 4]);
    expect(clusters[1].photoIds).toContain("s1");
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
    // The live multi-place stay shape (synthetic places, 2026-10-13): the
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

  it("stands the names of a cluster apart even when they lie within one place's link", () => {
    // Northvale and Port Carrow 27.8 km apart: closer than CITY_LINK_KM, but
    // each named place is its own stop (owner ruling 2026-10-14) — a metro
    // area's neighbouring names split too, and merge again in the review.
    const compact = [
      ...row("n", -45.0, 3, "Northvale", 6),
      ...row("e", -44.75, 3, "Port Carrow", 9),
    ];
    expect(clusterCities(compact).map((c) => [c.immichCity, c.photoIds.length])).toEqual([
      ["Northvale", 3],
      ["Port Carrow", 3],
    ]);
  });

  it("keeps nine named places of one island apart, each its own station", () => {
    // The nine-place island the owner ruled on (2026-10-14): nine named places,
    // every pair within CITY_LINK_KM, each with three photos, so single linkage
    // makes one cluster and the whole stay would read as a single station. The
    // names stand apart instead, each keeping its own, and the unnamed pocket
    // of two joins the place it sits at.
    const names = [
      "Cove Head",
      "Tern Bay",
      "Gull Point",
      "Moss Landing",
      "Fern Hollow",
      "Reed Flats",
      "Stone Beach",
      "Bramble Wick",
      "Yarrow Point",
    ];
    // 3.3 km apart on one meridian: 26.7 km end to end, every link well within
    // 30 km, so a single named place is all single linkage would see.
    const named = names.flatMap((city, i) =>
      Array.from({ length: 3 }, (_, j) =>
        photo(
          `p${i}${j}`,
          minute((i * 3 + j) * 5),
          { lat: -21 - i * 0.03, lon: 175 },
          {
            city,
            state: "Marloweshire",
            country: "Marlowe",
          }
        )
      )
    );
    const pocket = [
      photo("u1", minute(27 * 5), { lat: -21.06, lon: 175 }),
      photo("u2", minute(28 * 5), { lat: -21.06, lon: 175 }),
    ];
    const clusters = clusterCities([...named, ...pocket]);
    expect(clusters.map((c) => [c.immichCity, c.photoIds.length])).toEqual([
      ["Cove Head", 3],
      ["Tern Bay", 3],
      ["Gull Point", 5],
      ["Moss Landing", 3],
      ["Fern Hollow", 3],
      ["Reed Flats", 3],
      ["Stone Beach", 3],
      ["Bramble Wick", 3],
      ["Yarrow Point", 3],
    ]);
  });

  it("numbers the pieces of a split in discovery order among the other clusters", () => {
    const home = photo("h1", "2031-05-04 08:00", KELMORE);
    const clusters = clusterCities([home, ...chain()]);
    expect(clusters.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(clusters[0].photoIds).toEqual(["h1"]);
  });

  it("numbers a split's pieces around a cluster whose first photo falls between theirs", () => {
    // Time order: the north pieces (n, then e), a home photo at 11:30, then the south
    // piece (p, q). The chain is one linkage group, so its three named pieces come out
    // of the split side by side; only sorting by first photo puts the home photo between them.
    const input = [
      ...row("n", -45.0, 3, "Northvale", 6),
      ...row("e", -44.93, 3, "Northvale East", 9),
      photo("h1", "2031-05-05 11:30", KELMORE),
      ...row("p", -44.7, 2, "Port Carrow", 12),
      ...row("q", -44.45, 2, "Port Carrow", 14),
    ];
    const clusters = clusterCities(input);
    expect(clusters.map((c) => [c.id, c.photoIds[0], c.photoIds.length])).toEqual([
      ["c1", "n1", 3],
      ["c2", "e1", 3],
      ["c3", "h1", 1],
      ["c4", "p1", 4],
    ]);
  });

  it("does not let unnamed photos found a split of their own", () => {
    // Immich's reverse-geocoding can be partial: photos with neither city nor
    // state group together, and they used to count as a place that could
    // stand alone — a pocket of them past CITY_LINK_KM split off into a
    // station of its own. Four named photos and six unnamed chained to 38.9
    // km end to end (one bridging photo 27.8 km out, five more 11.1 km
    // beyond): one place, one cluster, the unnamed pocket joins the name.
    const mixed = [
      ...row("n", -45.0, 4, "Northvale", 6),
      photo("u1", "2031-05-05 12:00", { lat: -45.25, lon: 168.7 }),
      ...Array.from({ length: 5 }, (_, i) =>
        photo(`u${i + 2}`, `2031-05-05 ${String(13 + i).padStart(2, "0")}:00`, {
          lat: -45.35,
          lon: 168.7,
        })
      ),
    ];
    const clusters = clusterCities(mixed);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].photoIds).toHaveLength(10);
  });

  it("sends a pocket of unnamed photos with the nearest named place when two places do split", () => {
    // The same principle when the split is genuine: Northvale and Port Carrow
    // 33.4 km apart, with five unnamed photos 2.2 km from Carrow's median —
    // the pocket joins the place it sits at, never a third station.
    const twoPlaces = [
      ...row("n", -45.0, 4, "Northvale", 6),
      photo("u1", "2031-05-05 11:00", { lat: -45.25, lon: 168.7 }),
      ...Array.from({ length: 4 }, (_, i) =>
        photo(`u${i + 2}`, `2031-05-05 ${String(12 + i).padStart(2, "0")}:00`, {
          lat: -45.28,
          lon: 168.7,
        })
      ),
      ...row("p", -45.3, 4, "Port Carrow", 16),
    ];
    const clusters = clusterCities(twoPlaces);
    expect(clusters.map((c) => [c.immichCity, c.photoIds.length])).toEqual([
      ["Northvale", 4],
      ["Port Carrow", 9],
    ]);
  });
});
