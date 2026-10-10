import type { ExistingRoadtrip, ExistingStation, ExistingStop } from "../existingTypes";
import {
  derivedStopOf,
  interleaveKept,
  isCoordinateTitle,
  liesOutsideWindow,
  matchAreasToRoadtrips,
  matchStatus,
  reconcileStations,
  reconcileStops,
  reconcileTrip,
  type DerivedStation,
  type ReconcileArea,
  type StopArea,
} from "../reconcile";

// Synthetic fixtures only (public repository). Port Carrow lies about 52 km from
// Northvale, Kelmore about 44 km, Tarnside about 57 km; Northvale Heights 7 km.
const NORTHVALE = { lat: -45.05, lon: 168.7 };
const NORTHVALE_HEIGHTS = { lat: -45.1, lon: 168.75 };
const PORT_CARROW = { lat: -44.7, lon: 169.15 };
const KELMORE = { lat: -45.42, lon: 168.52 };
const TARNSIDE = { lat: -45.2, lon: 169.4 };
const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-09" };
const STAY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function stored(
  over: Partial<ExistingStation> & Pick<ExistingStation, "id" | "title">
): ExistingStation {
  return {
    ...NORTHVALE,
    startDate: "2031-05-02",
    endDate: "2031-05-04",
    night: "free",
    lodgingStayId: null,
    placeId: null,
    notes: null,
    ...over,
  };
}

function derived(key: string, title: string, over: Partial<DerivedStation> = {}): DerivedStation {
  return {
    key,
    title,
    titleSource: "geocode",
    ...NORTHVALE,
    startDate: "2031-05-02",
    endDate: "2031-05-04",
    slept: true,
    ...over,
  };
}

describe("isCoordinateTitle", () => {
  it("recognises a title that is only a coordinate", () => {
    expect(isCoordinateTitle("-45.05, 168.70")).toBe(true);
    expect(isCoordinateTitle("-45.05 168.7")).toBe(true);
    expect(isCoordinateTitle("45.05° S, 168.70° E")).toBe(true);
    expect(isCoordinateTitle("Northvale")).toBe(false);
    expect(isCoordinateTitle("Route 66")).toBe(false);
  });
});

describe("reconcileStations: classification", () => {
  it("tells same, changed, new and not seen apart", () => {
    const a = stored({ id: "a", title: "Northvale" });
    const b = stored({
      id: "b",
      title: "Port Carrow",
      ...PORT_CARROW,
      startDate: "2031-05-04",
      endDate: "2031-05-06",
      night: "pass",
    });
    const c = stored({
      id: "c",
      title: "Kelmore",
      ...KELMORE,
      startDate: "2031-05-06",
      endDate: "2031-05-07",
    });
    const result = reconcileStations(
      [
        derived("k1", "Northvale"),
        derived("k2", "Port Carrow", {
          ...PORT_CARROW,
          startDate: "2031-05-04",
          endDate: "2031-05-07",
          slept: false,
        }),
        derived("k3", "Tarnside", { ...TARNSIDE, startDate: "2031-05-07", endDate: "2031-05-08" }),
      ],
      [a, b, c],
      WINDOW
    );
    expect(result.derived.map((d) => [d.key, d.status, d.existing?.id])).toEqual([
      ["k1", "same", "a"],
      ["k2", "changed", "b"],
      ["k3", "new", undefined],
    ]);
    expect(result.notSeen.map((n) => [n.stored.id, n.defaultKeep, n.reason])).toEqual([
      ["c", true, "notInPhotos"],
    ]);
  });

  it("reports what is stored beside a matched station", () => {
    const a = stored({ id: "a", title: "Northvale", night: "stay", lodgingStayId: STAY_ID });
    const [rec] = reconcileStations([derived("k1", "Northvale")], [a], WINDOW).derived;
    expect(rec.before).toEqual({
      startDate: "2031-05-02",
      endDate: "2031-05-04",
      slept: true,
      stay: true,
    });
  });
});

describe("reconcileStations: what survives", () => {
  it("keeps the stored title, notes and coordinates", () => {
    const lodge = stored({ id: "a", title: "Northvale Lodge", notes: "Booked by phone" });
    const [rec] = reconcileStations(
      [derived("k1", "Northvale", { lat: -45.0502, lon: 168.7003 })],
      [lodge],
      WINDOW
    ).derived;
    expect(rec).toMatchObject({
      title: "Northvale Lodge",
      lat: -45.05,
      lon: 168.7,
      status: "same",
    });
    expect(rec.existing?.notes).toBe("Booked by phone");
  });

  it("replaces a title that is only the old coordinate fallback, unless the new one is too", () => {
    const fallback = stored({ id: "a", title: "-45.05, 168.70" });
    expect(
      reconcileStations([derived("k1", "Northvale")], [fallback], WINDOW).derived[0].title
    ).toBe("Northvale");
    const stillCoords = derived("k1", "-45.05, 168.70", { titleSource: "coords" });
    expect(reconcileStations([stillCoords], [fallback], WINDOW).derived[0].title).toBe(
      "-45.05, 168.70"
    );
  });

  it("lets a stored stay own the night, and keeps its link", () => {
    const stay = stored({
      id: "a",
      title: "Northvale Lodge",
      night: "stay",
      lodgingStayId: STAY_ID,
    });
    const asPass = reconcileStations([derived("k1", "Northvale", { slept: false })], [stay], WINDOW)
      .derived[0];
    expect(asPass.status).toBe("same");
    expect(asPass.existing?.lodgingStayId).toBe(STAY_ID);
    const moved = reconcileStations(
      [derived("k1", "Northvale", { slept: false, endDate: "2031-05-05" })],
      [stay],
      WINDOW
    ).derived[0];
    expect(moved.status).toBe("changed");
  });

  it("never matches or lists a route correction, and hands it back to be kept", () => {
    const via = stored({ id: "v", title: "", night: "via", startDate: null, endDate: null });
    const result = reconcileStations([derived("k1", "Northvale")], [via], WINDOW);
    expect(result.derived[0].status).toBe("new");
    expect(result.notSeen).toEqual([]);
    expect(result.vias.map((v) => v.id)).toEqual(["v"]);
  });
});

describe("reconcileStations: matching rules", () => {
  it("matches within the link distance on overlapping days", () => {
    const near = stored({ id: "a", title: "Elsewhere", ...NORTHVALE_HEIGHTS });
    expect(
      reconcileStations([derived("k1", "Northvale")], [near], WINDOW).derived[0].existing?.id
    ).toBe("a");
  });

  it("matches an equal title without overlapping days", () => {
    const early = stored({ id: "a", title: "Northvale" });
    const later = derived("k1", "Northvale", { startDate: "2031-06-01", endDate: "2031-06-02" });
    const rec = reconcileStations([later], [early], {
      startDay: "2031-05-02",
      endDay: "2031-06-05",
    }).derived[0];
    expect(rec).toMatchObject({ status: "changed" });
    expect(rec.existing?.id).toBe("a");
  });

  it("does not match different titles on different days", () => {
    const early = stored({ id: "a", title: "Northvale" });
    const later = derived("k1", "Northvale Heights", {
      startDate: "2031-06-01",
      endDate: "2031-06-02",
    });
    expect(reconcileStations([later], [early], WINDOW).derived[0].status).toBe("new");
  });

  it("does not match beyond the link distance, even on the same title", () => {
    const far = stored({ id: "a", title: "Port Carrow", ...NORTHVALE });
    const rec = reconcileStations([derived("k1", "Port Carrow", PORT_CARROW)], [far], WINDOW)
      .derived[0];
    expect(rec.status).toBe("new");
  });

  it("gives a stored station to the derived one with the equal title, not the nearest", () => {
    const near = stored({ id: "near", title: "Elsewhere" });
    const titled = stored({ id: "titled", title: "Northvale", ...NORTHVALE_HEIGHTS });
    const result = reconcileStations([derived("k1", "Northvale")], [near, titled], WINDOW);
    expect(result.derived[0].existing?.id).toBe("titled");
    expect(result.notSeen.map((n) => n.stored.id)).toEqual(["near"]);
  });

  it("uses each stored station once", () => {
    const only = stored({ id: "a", title: "Northvale" });
    const result = reconcileStations(
      [derived("k1", "Northvale"), derived("k2", "Northvale")],
      [only],
      WINDOW
    );
    expect(result.derived.map((d) => d.status)).toEqual(["same", "new"]);
  });
});

describe("not-seen defaults", () => {
  it("removes by default only what lies entirely outside the new window", () => {
    const window = { startDay: "2031-05-02", endDay: "2031-05-05" };
    const inside = stored({
      id: "in",
      title: "Kelmore",
      ...KELMORE,
      startDate: "2031-05-03",
      endDate: "2031-05-04",
    });
    const after = stored({
      id: "after",
      title: "Tarnside",
      ...TARNSIDE,
      startDate: "2031-05-08",
      endDate: "2031-05-09",
    });
    const before = stored({
      id: "before",
      title: "Port Carrow",
      ...PORT_CARROW,
      startDate: "2031-04-28",
      endDate: "2031-04-30",
    });
    const undated = stored({
      id: "undated",
      title: "Somewhere",
      lat: -44.0,
      lon: 170.0,
      startDate: null,
      endDate: null,
    });
    const { notSeen } = reconcileStations([], [inside, after, before, undated], window);
    expect(notSeen.map((n) => [n.stored.id, n.defaultKeep, n.reason])).toEqual([
      ["in", true, "notInPhotos"],
      ["after", false, "outsideWindow"],
      ["before", false, "outsideWindow"],
      ["undated", true, "notInPhotos"],
    ]);
  });

  it("counts the last day of the window as inside", () => {
    const window = { startDay: "2031-05-02", endDay: "2031-05-05" };
    expect(liesOutsideWindow({ startDate: "2031-05-05", endDate: "2031-05-06" }, window)).toBe(
      false
    );
    expect(liesOutsideWindow({ startDate: "2031-05-06", endDate: "2031-05-07" }, window)).toBe(
      true
    );
  });
});

describe("matchStatus", () => {
  it("compares dates and night, and lets a stay agree with any night", () => {
    const free = stored({ id: "a", title: "x" });
    expect(matchStatus({ startDate: "2031-05-02", endDate: "2031-05-04", slept: true }, free)).toBe(
      "same"
    );
    expect(
      matchStatus({ startDate: "2031-05-02", endDate: "2031-05-04", slept: false }, free)
    ).toBe("changed");
    expect(matchStatus({ startDate: "2031-05-02", endDate: "2031-05-05", slept: true }, free)).toBe(
      "changed"
    );
    const stay = stored({ id: "s", title: "x", night: "stay", lodgingStayId: STAY_ID });
    expect(
      matchStatus({ startDate: "2031-05-02", endDate: "2031-05-04", slept: false }, stay)
    ).toBe("same");
  });
});

describe("interleaveKept", () => {
  const a = stored({ id: "a", title: "A" });
  const b = stored({ id: "b", title: "B" });
  const v = stored({ id: "v", title: "", night: "via", startDate: null, endDate: null });
  const c = stored({ id: "c", title: "C" });
  const d = stored({ id: "d", title: "D" });

  it("puts a kept station right after the stored station before it, and always keeps route corrections", () => {
    const order = interleaveKept(["a", undefined, "d"], [a, b, v, c, d], new Set(["b"]));
    expect(order).toEqual([
      { kind: "derived", index: 0 },
      { kind: "kept", stored: b },
      { kind: "kept", stored: v },
      { kind: "derived", index: 1 },
      { kind: "derived", index: 2 },
    ]);
  });

  it("puts a kept station with nothing before it first", () => {
    const order = interleaveKept(["a"], [b, a], new Set(["b"]));
    expect(order).toEqual([
      { kind: "kept", stored: b },
      { kind: "derived", index: 0 },
    ]);
  });

  it("drops a stored station that is neither matched nor kept", () => {
    const order = interleaveKept(["a"], [a, c], new Set());
    expect(order).toEqual([{ kind: "derived", index: 0 }]);
  });
});

function roadtrip(id: string, name: string, stations: ExistingStation[]): ExistingRoadtrip {
  return { id, name, stations, legs: [] };
}

function area(key: string, name: string, stations: DerivedStation[]): ReconcileArea {
  return { key, kind: "roadtrip", name, stations };
}

describe("matchAreasToRoadtrips", () => {
  const r1 = roadtrip("r1", "Northvale loop", [
    stored({ id: "r1a", title: "Northvale" }),
    stored({
      id: "r1b",
      title: "Kelmore",
      ...KELMORE,
      startDate: "2031-05-04",
      endDate: "2031-05-05",
    }),
  ]);
  const r2 = roadtrip("r2", "Coast run", [
    stored({
      id: "r2a",
      title: "Port Carrow",
      ...PORT_CARROW,
      startDate: "2031-05-06",
      endDate: "2031-05-08",
    }),
    stored({
      id: "r2b",
      title: "Tarnside",
      ...TARNSIDE,
      startDate: "2031-05-08",
      endDate: "2031-05-09",
    }),
  ]);
  const northvaleArea = area("2031-05-02#1", "Northvale loop", [
    derived("k1", "Northvale"),
    derived("k2", "Kelmore", { ...KELMORE, startDate: "2031-05-04", endDate: "2031-05-05" }),
  ]);
  const coastArea = area("2031-05-06#1", "Coast run", [
    derived("k3", "Port Carrow", {
      ...PORT_CARROW,
      startDate: "2031-05-06",
      endDate: "2031-05-08",
    }),
    derived("k4", "Tarnside", { ...TARNSIDE, startDate: "2031-05-08", endDate: "2031-05-09" }),
  ]);

  it("matches each area to the roadtrip it shares most stations with, whatever the order", () => {
    const matches = matchAreasToRoadtrips([coastArea, northvaleArea], [r1, r2], WINDOW);
    expect(matches.map((m) => [m.areaKey, m.roadtripId])).toEqual([
      ["2031-05-06#1", "r2"],
      ["2031-05-02#1", "r1"],
    ]);
  });

  it("uses a roadtrip once: the area with more stations wins", () => {
    const weaker = area("2031-05-03#1", "Other", [derived("k9", "Northvale")]);
    const matches = matchAreasToRoadtrips([weaker, northvaleArea], [r1], WINDOW);
    expect(matches.map((m) => [m.areaKey, m.roadtripId])).toEqual([["2031-05-02#1", "r1"]]);
  });

  it("falls back to the roadtrip's name when no station matches", () => {
    const south = area("2031-05-02#1", "southern loop", [
      derived("k1", "Elsewhere", { lat: -46.5, lon: 169.9 }),
    ]);
    const named = roadtrip("r3", "Southern loop", [
      stored({ id: "r3a", title: "Faraway", lat: -46.9, lon: 171.0 }),
    ]);
    const [match] = matchAreasToRoadtrips([south], [named], WINDOW);
    expect(match.roadtripId).toBe("r3");
    expect(match.reconciled.derived[0].status).toBe("new");
    expect(match.reconciled.notSeen.map((n) => n.stored.id)).toEqual(["r3a"]);
  });

  it("leaves an area with no partner to become a new roadtrip", () => {
    const lonely = area("2031-05-02#1", "Brand new", [
      derived("k1", "Elsewhere", { lat: -46.5, lon: 169.9 }),
    ]);
    expect(matchAreasToRoadtrips([lonely], [r1, r2], WINDOW)).toEqual([]);
  });

  it("only considers areas that would become roadtrips", () => {
    const asStops: ReconcileArea = { ...northvaleArea, kind: "stops" };
    expect(matchAreasToRoadtrips([asStops], [r1], WINDOW)).toEqual([]);
  });
});

describe("timeline stops", () => {
  const home = {
    key: "k-home",
    title: "Home",
    titleSource: "home" as const,
    kind: "home" as const,
    lat: -45.9,
    lon: 170.5,
    firstDay: "2031-05-02",
    lastDay: "2031-05-02",
  };
  const northvale = (key: string, firstDay: string, lastDay: string) => ({
    key,
    title: "Northvale",
    titleSource: "geocode" as const,
    kind: "visit" as const,
    ...NORTHVALE,
    firstDay,
    lastDay,
  });
  const stopArea: StopArea = {
    key: "2031-05-02#1",
    stations: [
      home,
      northvale("k1", "2031-05-02", "2031-05-04"),
      northvale("k2", "2031-05-04", "2031-05-05"),
    ],
  };

  it("derives one stop over the area's ground days and ignores home and airport stations", () => {
    expect(derivedStopOf(stopArea)).toEqual({
      key: "k1",
      title: "Northvale",
      titleSource: "geocode",
      ...NORTHVALE,
      startDate: "2031-05-02",
      endDate: "2031-05-05",
      slept: false,
    });
    expect(derivedStopOf({ key: "x", stations: [home] })).toBeNull();
  });

  const museum: ExistingStop = {
    id: "s1",
    title: "Northvale",
    ...NORTHVALE,
    startDay: "2031-05-02",
    endDay: "2031-05-04",
    notes: null,
  };
  const harbour: ExistingStop = {
    id: "s2",
    title: "Kelmore Harbour",
    ...KELMORE,
    startDay: "2031-05-06",
    endDay: "2031-05-06",
    notes: "Ferry café",
  };

  it("matches a stop, sees its dates changed, and lists the unmatched one as not seen", () => {
    const result = reconcileStops([stopArea], [museum, harbour], WINDOW);
    const rec = result.matched.get("2031-05-02#1");
    expect(rec).toMatchObject({ key: "k1", status: "changed" });
    expect(rec?.existing?.id).toBe("s1");
    expect(result.notSeen.map((n) => [n.stored.id, n.defaultKeep])).toEqual([["s2", true]]);
  });

  it("reports an area whose stop is not stored yet as new", () => {
    const result = reconcileStops([stopArea], [], WINDOW);
    expect(result.matched.get("2031-05-02#1")?.status).toBe("new");
  });
});

describe("reconcileTrip", () => {
  it("reconciles roadtrip areas and stop areas against the same trip", () => {
    const state = {
      roadtrips: [roadtrip("r1", "Northvale loop", [stored({ id: "r1a", title: "Northvale" })])],
      stops: [
        {
          id: "s1",
          title: "Kelmore",
          ...KELMORE,
          startDay: "2031-05-06",
          endDay: "2031-05-07",
          notes: null,
        },
      ],
    };
    const result = reconcileTrip({
      window: WINDOW,
      roadtripAreas: [area("2031-05-02#1", "Northvale loop", [derived("k1", "Northvale")])],
      stopAreas: [
        {
          key: "2031-05-06#1",
          stations: [
            {
              key: "k5",
              title: "Kelmore",
              titleSource: "geocode",
              kind: "visit",
              ...KELMORE,
              firstDay: "2031-05-06",
              lastDay: "2031-05-07",
            },
          ],
        },
      ],
      state,
    });
    expect(result.roadtrips.map((m) => [m.areaKey, m.roadtripId])).toEqual([
      ["2031-05-02#1", "r1"],
    ]);
    expect(result.stops.matched.get("2031-05-06#1")?.status).toBe("same");
  });
});
