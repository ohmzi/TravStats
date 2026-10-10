import { describe, expect, it } from "vitest";

import type { DraftStation } from "../../../types/tripBuilder";
import {
  addHomeAt,
  chordKmBetween,
  defaultStationNotes,
  foldDayTrip,
  legsFitStations,
  mergeWithNext,
  removeHomeAt,
  removeStationAt,
  repointNights,
  straightLeg,
  type Chain,
} from "../stationOps";

// Synthetic fixtures only (public repository): invented places, shifted years.
function st(
  key: string,
  title: string,
  firstDay: string,
  lastDay: string,
  over: Partial<DraftStation> = {}
): DraftStation {
  return {
    key,
    title,
    titleSource: "geocode",
    kind: "visit",
    lat: -45.05,
    lon: 168.7,
    snappedKm: null,
    firstDay,
    lastDay,
    firstLocal: `${firstDay} 09:00`,
    lastLocal: `${lastDay} 17:30`,
    photoCount: 10,
    previewIdx: [0, 1],
    notes: null,
    ...over,
  };
}

const A = st("a", "Northvale", "2031-05-02", "2031-05-02", { lat: -45.05, lon: 168.7 });
const B = st("b", "Port Carrow", "2031-05-03", "2031-05-03", { lat: -44.7, lon: 169.15 });
const C = st("c", "Southbridge", "2031-05-04", "2031-05-04", { lat: -45.4, lon: 169.1 });

function chainOf(stations: DraftStation[], modes: Array<"road" | "ferry"> = []): Chain {
  return {
    stations,
    legs: stations.slice(1).map((s, i) => straightLeg(stations[i], s, modes[i] ?? "road")),
  };
}

describe("chordKmBetween", () => {
  it("is the great-circle distance to a tenth of a kilometre", () => {
    expect(chordKmBetween(A, B)).toBeCloseTo(52.6, 1);
    expect(chordKmBetween(A, A)).toBe(0);
  });
});

describe("straightLeg", () => {
  it("has no route, and keeps ferry evidence only for a ferry", () => {
    expect(straightLeg(A, B, "ferry", "seaPhotos")).toEqual({
      fromKey: "a",
      toKey: "b",
      chordKm: chordKmBetween(A, B),
      routedKm: null,
      mode: "ferry",
      ferryEvidence: "seaPhotos",
    });
    expect(straightLeg(A, B, "road", "router").ferryEvidence).toBeNull();
  });
});

describe("removeStationAt", () => {
  it("joins the neighbours by one straight leg", () => {
    const next = removeStationAt(chainOf([A, B, C]), 1);
    expect(next?.stations.map((s) => s.key)).toEqual(["a", "c"]);
    expect(next?.legs).toEqual([straightLeg(A, C)]);
    expect(legsFitStations(next as Chain)).toBe(true);
  });

  it("makes the joining leg a ferry when either of the two was", () => {
    const viaFerry = removeStationAt(chainOf([A, B, C], ["road", "ferry"]), 1);
    expect(viaFerry?.legs[0].mode).toBe("ferry");
    const first = removeStationAt(chainOf([A, B, C], ["ferry", "road"]), 1);
    expect(first?.legs[0].mode).toBe("ferry");
  });

  it("drops the one leg of an end station", () => {
    expect(removeStationAt(chainOf([A, B, C]), 0)?.legs.map((l) => l.fromKey)).toEqual(["b"]);
    expect(removeStationAt(chainOf([A, B, C]), 2)?.legs.map((l) => l.toKey)).toEqual(["b"]);
  });

  it("empties a chain of one, and refuses an index that is not there", () => {
    expect(removeStationAt(chainOf([A]), 0)).toEqual({ stations: [], legs: [] });
    expect(removeStationAt(chainOf([A, B]), 2)).toBeNull();
    expect(removeStationAt(chainOf([A, B]), -1)).toBeNull();
  });

  it("leaves an excursion without a base rather than pointing it at nothing", () => {
    const trip = st("x", "Port Carrow", "2031-05-02", "2031-05-02", {
      kind: "dayTrip",
      excursionOf: "a",
    });
    const next = removeStationAt(chainOf([A, trip]), 0);
    expect(next?.stations[0].excursionOf).toBeUndefined();
  });

  it("does not touch the chain it was given", () => {
    const chain = chainOf([A, B, C]);
    const copy = structuredClone(chain);
    removeStationAt(chain, 1);
    expect(chain).toEqual(copy);
  });
});

describe("mergeWithNext", () => {
  const first = st("a", "Northvale", "2031-05-02", "2031-05-02", {
    firstLocal: "2031-05-02 09:00",
    lastLocal: "2031-05-02 12:00",
    photoCount: 10,
    previewIdx: [0, 1],
    notes: "First photo 09:00 · last 12:00 · 10 photos",
  });
  const second = st("b", "Northvale", "2031-05-03", "2031-05-03", {
    kind: "brief",
    firstLocal: "2031-05-03 08:00",
    lastLocal: "2031-05-03 17:30",
    photoCount: 4,
    previewIdx: [1, 2],
    notes: "First photo 08:00 · last 17:30 · 4 photos",
  });

  it("keeps the first station's key and place and takes in the second's days and photos", () => {
    const next = mergeWithNext(chainOf([first, second, C]), 0);
    expect(next?.stations).toHaveLength(2);
    const [joined] = next?.stations ?? [];
    expect(joined).toMatchObject({
      key: "a",
      kind: "visit",
      firstDay: "2031-05-02",
      lastDay: "2031-05-03",
      lastLocal: "2031-05-03 17:30",
      photoCount: 14,
      previewIdx: [0, 1, 2],
    });
  });

  it("writes the pre-filled note again when neither was edited", () => {
    const [joined] = mergeWithNext(chainOf([first, second]), 0)?.stations ?? [];
    expect(joined.notes).toBe("First photo 09:00 · last 17:30 · 14 photos");
  });

  it("keeps a note the user wrote, whichever station held it", () => {
    const mine = { ...first, notes: "Slept in the van" };
    expect(mergeWithNext(chainOf([mine, second]), 0)?.stations[0].notes).toBe("Slept in the van");
    const theirs = { ...second, notes: "Rain all day" };
    expect(mergeWithNext(chainOf([first, theirs]), 0)?.stations[0].notes).toBe("Rain all day");
  });

  it("keeps both notes, the first above the second, when the user wrote one on each", () => {
    const mine = { ...first, notes: "Slept in the van" };
    const theirs = { ...second, notes: "Rain all day" };
    expect(mergeWithNext(chainOf([mine, theirs]), 0)?.stations[0].notes).toBe(
      "Slept in the van\nRain all day"
    );
  });

  it("writes a note the user typed on both stations once", () => {
    const mine = { ...first, notes: "Slept in the van" };
    const theirs = { ...second, notes: "Slept in the van" };
    expect(mergeWithNext(chainOf([mine, theirs]), 0)?.stations[0].notes).toBe("Slept in the van");
  });

  it("does not let a note the user cleared swallow the other one", () => {
    const cleared = { ...first, notes: "" };
    const theirs = { ...second, notes: "Rain all day" };
    expect(mergeWithNext(chainOf([cleared, theirs]), 0)?.stations[0].notes).toBe("Rain all day");
    expect(mergeWithNext(chainOf([cleared, { ...second, notes: "" }]), 0)?.stations[0].notes).toBe(
      ""
    );
  });

  it("joins the leg that left the second station to the merged one, without its route", () => {
    const chain = chainOf([first, second, C], ["road", "ferry"]);
    const next = mergeWithNext(chain, 0) as Chain;
    expect(next.legs).toEqual([
      { ...straightLeg(next.stations[0], C, "ferry"), ferryEvidence: null },
    ]);
    expect(legsFitStations(next)).toBe(true);
  });

  it("re-points an excursion that left from the absorbed station", () => {
    const trip = st("x", "Port Carrow", "2031-05-03", "2031-05-03", {
      kind: "dayTrip",
      excursionOf: "b",
    });
    const next = mergeWithNext(chainOf([first, second, trip]), 0);
    expect(next?.stations[1].excursionOf).toBe("a");
  });

  it("refuses an anchor, the last station and an index that is not there", () => {
    const home = st("h", "Kelmore", "2031-05-02", "2031-05-02", { kind: "home" });
    expect(mergeWithNext(chainOf([home, first]), 0)).toBeNull();
    expect(mergeWithNext(chainOf([first, home]), 0)).toBeNull();
    expect(mergeWithNext(chainOf([first, second]), 1)).toBeNull();
    expect(mergeWithNext(chainOf([first, second]), 5)).toBeNull();
  });

  it("makes a merged excursion a plain visit once a visit joins it", () => {
    const trip = st("x", "Port Carrow", "2031-05-03", "2031-05-03", {
      kind: "dayTrip",
      excursionOf: "a",
    });
    const next = mergeWithNext(chainOf([first, trip]), 0);
    expect(next?.stations[0].kind).toBe("visit");
    expect(next?.stations[0].excursionOf).toBeUndefined();
  });
});

describe("foldDayTrip", () => {
  const base = st("n", "Northvale", "2031-05-02", "2031-05-03", { photoCount: 20 });
  const trip = st("x", "Port Carrow", "2031-05-03", "2031-05-03", {
    kind: "dayTrip",
    excursionOf: "n",
    photoCount: 6,
    lat: -44.7,
    lon: 169.15,
  });
  const back = st("n2", "Northvale", "2031-05-03", "2031-05-04", { kind: "brief", photoCount: 5 });
  const onward = st("s", "Southbridge", "2031-05-05", "2031-05-05", { lat: -45.4, lon: 169.1 });

  it("takes the return into the base and drops the excursion", () => {
    const fold = foldDayTrip(chainOf([base, trip, back, onward], ["road", "road", "ferry"]), 1);
    expect(fold?.into).toBe("n");
    expect(fold?.dropped).toEqual(["x", "n2"]);
    const chain = fold?.chain as Chain;
    expect(chain.stations.map((s) => s.key)).toEqual(["n", "s"]);
    expect(chain.stations[0]).toMatchObject({ lastDay: "2031-05-04", photoCount: 25 });
    expect(chain.legs).toHaveLength(1);
    expect(chain.legs[0]).toMatchObject({
      fromKey: "n",
      toKey: "s",
      mode: "ferry",
      routedKm: null,
    });
    expect(legsFitStations(chain)).toBe(true);
  });

  it("does not mind a rename of the base or of the return", () => {
    const renamed = { ...base, title: "Northvale Lodge" };
    expect(foldDayTrip(chainOf([renamed, trip, back]), 1)?.into).toBe("n");
  });

  it("works when the return is the last station", () => {
    const fold = foldDayTrip(chainOf([base, trip, back]), 1);
    expect(fold?.chain.stations.map((s) => s.key)).toEqual(["n"]);
    expect(fold?.chain.legs).toEqual([]);
  });

  it("refuses what is not the shape the scan makes", () => {
    expect(foldDayTrip(chainOf([base, trip]), 1)).toBeNull();
    expect(foldDayTrip(chainOf([base, back, onward]), 1)).toBeNull();
    expect(foldDayTrip(chainOf([trip, back]), 0)).toBeNull();
    expect(foldDayTrip(chainOf([onward, trip, back]), 1)).toBeNull();
    const stranger = { ...back, lat: -43.5, lon: 172.6 };
    expect(foldDayTrip(chainOf([base, trip, stranger]), 1)).toBeNull();
    expect(foldDayTrip(chainOf([base, trip, back]), 7)).toBeNull();
  });
});

describe("home at an end", () => {
  const home = st("h", "Kelmore", "2031-05-02", "2031-05-02", { kind: "home" });

  it("adds it at the start with a road to the first station", () => {
    const next = addHomeAt(chainOf([A, B]), "start", home) as Chain;
    expect(next.stations.map((s) => s.key)).toEqual(["h", "a", "b"]);
    expect(next.legs[0]).toEqual(straightLeg(home, A));
    expect(legsFitStations(next)).toBe(true);
  });

  it("adds it at the end", () => {
    const next = addHomeAt(chainOf([A, B]), "end", home) as Chain;
    expect(next.stations.map((s) => s.key)).toEqual(["a", "b", "h"]);
    expect(next.legs[1]).toEqual(straightLeg(B, home));
  });

  it("starts a chain with it, and will not add it twice", () => {
    expect(addHomeAt({ stations: [], legs: [] }, "start", home)).toEqual({
      stations: [home],
      legs: [],
    });
    expect(addHomeAt(chainOf([home, A]), "start", home)).toBeNull();
  });

  it("takes it off again, and only when that end is home", () => {
    const withHome = chainOf([home, A, B]);
    expect(removeHomeAt(withHome, "start")?.stations.map((s) => s.key)).toEqual(["a", "b"]);
    expect(removeHomeAt(withHome, "end")).toBeNull();
    expect(removeHomeAt(chainOf([A, B, home]), "end")?.legs).toHaveLength(1);
  });
});

describe("repointNights", () => {
  it("moves every night that names one of the stations, and no other", () => {
    const nights = {
      "2031-05-02": "a",
      "2031-05-03": "b",
      "2031-05-04": "home",
      "2031-05-05": "c",
    };
    expect(repointNights(nights, ["a", "b"], "unknown")).toEqual({
      "2031-05-02": "unknown",
      "2031-05-03": "unknown",
      "2031-05-04": "home",
      "2031-05-05": "c",
    });
  });
});

describe("defaultStationNotes", () => {
  it("reads like the scan's note, and is absent for a station with no photo times", () => {
    expect(
      defaultStationNotes({
        firstLocal: "2031-05-02 08:10",
        lastLocal: "2031-05-02 19:40",
        photoCount: 1,
      })
    ).toBe("First photo 08:10 · last 19:40 · 1 photo");
    expect(defaultStationNotes({ firstLocal: null, lastLocal: null, photoCount: 0 })).toBeNull();
  });
});
