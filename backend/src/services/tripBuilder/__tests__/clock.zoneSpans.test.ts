import { areaZoneSpans, clockAssets } from "../clock";
import { makeAnchor, makeAsset, NORTHVALE, SALTMERE } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, flights ZZ101/ZZ102, shifted years.

/** ZZ101 leaves Northvale at 13:00 NZST on 4 May. */
const DEP = Date.parse("2031-05-04T01:00:00Z");
const NZ = "Pacific/Auckland";
const LA_PAZ = "America/La_Paz";
/** A third zone, named by flights whose own zones a test must not be able to pass on. */
const TOKYO = "Asia/Tokyo";
const OPEN_START = Number.NEGATIVE_INFINITY;
const OPEN_END = Number.POSITIVE_INFINITY;

/** A located photo whose instant is `iso` (case A). */
const fix = (id: string, iso: string, place: { lat: number; lon: number }) =>
  makeAsset({ id, timeZone: "UTC", fileCreatedAt: iso, ...place });

describe("areaZoneSpans", () => {
  it("gives each side of a flight the zone its photos show", () => {
    const spans = areaZoneSpans(
      [
        fix("n1", "2031-05-03T00:00:00.000Z", NORTHVALE),
        fix("n2", "2031-05-03T05:00:00.000Z", NORTHVALE),
        fix("s1", "2031-05-04T15:00:00.000Z", SALTMERE),
        fix("s2", "2031-05-05T00:00:00.000Z", SALTMERE),
      ],
      [makeAnchor()]
    );
    expect(spans).toEqual([
      { fromMs: OPEN_START, toMs: DEP, zone: NZ },
      { fromMs: DEP, toMs: OPEN_END, zone: LA_PAZ },
    ]);
  });

  it("takes each side's zone from its own photos when the flight names none", () => {
    const spans = areaZoneSpans(
      [
        fix("n1", "2031-05-03T00:00:00.000Z", NORTHVALE),
        fix("s1", "2031-05-04T15:00:00.000Z", SALTMERE),
      ],
      [makeAnchor({ depZone: null, arrZone: null })]
    );
    expect(spans).toEqual([
      { fromMs: OPEN_START, toMs: DEP, zone: NZ },
      { fromMs: DEP, toMs: OPEN_END, zone: LA_PAZ },
    ]);
  });

  it("goes with the zone most of a stretch's photos show, not the first, the last or the flight's", () => {
    // The minority zone comes first and last, and the flight names a third zone for both sides.
    const spans = areaZoneSpans(
      [
        fix("s1", "2031-05-02T21:00:00.000Z", SALTMERE),
        fix("n1", "2031-05-02T22:00:00.000Z", NORTHVALE),
        fix("n2", "2031-05-03T00:00:00.000Z", NORTHVALE),
        fix("n3", "2031-05-03T01:00:00.000Z", NORTHVALE),
        fix("s2", "2031-05-03T02:00:00.000Z", SALTMERE),
      ],
      [makeAnchor({ depZone: TOKYO, arrZone: TOKYO })]
    );
    expect(spans).toEqual([
      { fromMs: OPEN_START, toMs: DEP, zone: NZ },
      { fromMs: DEP, toMs: OPEN_END, zone: TOKYO },
    ]);
  });

  it.each([
    ["Northvale first", "snns", NZ],
    ["Saltmere first", "nssn", LA_PAZ],
  ])("on a tie, goes with the zone that reached the count first (%s)", (_name, order, zone) => {
    const times = [
      "2031-05-02T21:00:00.000Z",
      "2031-05-02T22:00:00.000Z",
      "2031-05-02T23:00:00.000Z",
      "2031-05-03T00:00:00.000Z",
    ];
    const fixes = [...order].map((place, i) =>
      fix(`${place}${i}`, times[i], place === "n" ? NORTHVALE : SALTMERE)
    );
    const spans = areaZoneSpans(fixes, [makeAnchor({ depZone: TOKYO, arrZone: TOKYO })]);
    expect(spans[0]).toEqual({ fromMs: OPEN_START, toMs: DEP, zone });
  });

  it("cuts at noon of the departure day on the departure clock when the flight has no times", () => {
    const vague = makeAnchor({
      precise: false,
      depMs: null,
      arrMs: null,
      depClock: null,
      arrClock: null,
    });
    const noon = Date.parse("2031-05-04T00:00:00Z"); // 12:00 NZST
    expect(areaZoneSpans([], [vague])).toEqual([
      { fromMs: OPEN_START, toMs: noon, zone: NZ },
      { fromMs: noon, toMs: OPEN_END, zone: LA_PAZ },
    ]);
  });

  it("lends a stretch without photos the zone its flight landed in, else the zone the next one leaves from", () => {
    const back = Date.parse("2031-05-08T12:00:00Z");
    const zz102 = makeAnchor({
      id: "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a",
      label: "ZZ102 SLM→NVL",
      depIata: "SLM",
      arrIata: "NVL",
      dep: { ...SALTMERE },
      arr: { ...NORTHVALE },
      depZone: LA_PAZ,
      arrZone: NZ,
      depDay: "2031-05-08",
      arrDay: "2031-05-09",
      depClock: "08:00",
      arrClock: "12:00",
      depMs: back,
      arrMs: Date.parse("2031-05-09T00:00:00Z"),
    });
    expect(areaZoneSpans([], [zz102, makeAnchor()])).toEqual([
      { fromMs: OPEN_START, toMs: DEP, zone: NZ },
      { fromMs: DEP, toMs: back, zone: LA_PAZ },
      { fromMs: back, toMs: OPEN_END, zone: NZ },
    ]);
  });

  it("leaves out a stretch nothing names a zone for", () => {
    expect(areaZoneSpans([], [])).toEqual([]);
    expect(areaZoneSpans([], [makeAnchor({ depZone: null, arrZone: null })])).toEqual([]);
  });

  it("dates a photo with no GPS and no neighbour by its stretch (zone rule 4)", () => {
    // The flight names no zone, so only the stretch's photos can say where the video was.
    // The Saltmere photo is 13 h before the video: out of rule 3's reach, inside the stretch.
    const assets = [
      fix("n1", "2031-05-03T00:00:00.000Z", NORTHVALE),
      fix("s1", "2031-05-04T14:00:00.000Z", SALTMERE),
      makeAsset({
        id: "video",
        type: "VIDEO",
        timeZone: "UTC",
        fileCreatedAt: "2031-05-05T03:00:00.000Z",
      }),
    ];
    const anchors = [makeAnchor({ depZone: null, arrZone: null })];
    const ctx = { homeZone: null, areaZones: areaZoneSpans(assets, anchors) };
    const video = clockAssets(assets, ctx).find((p) => p.id === "video");
    expect(video).toMatchObject({ zone: LA_PAZ, local: "2031-05-04 23:00" });
    expect(video?.flags.zoneSource).toBe("area");
  });
});
