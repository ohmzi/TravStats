import type { Coord } from "../../tour/tourDistance";
import { splitImplicitFlights } from "../flightAnchors";
import type { AreaSegments, CityCluster, GroundArea, RawSegment } from "../types";
import { at, KEL, NVL, offsetKm, PCR } from "./flightFixtures";

function cluster(id: string, where: Coord): CityCluster {
  return {
    id,
    photoIds: [],
    lat: where.lat,
    lon: where.lon,
    spreadKm: 3,
    immichCity: null,
    immichState: null,
    immichCountry: null,
  };
}

function segment(
  id: string,
  clusterId: string,
  fromLocal: string,
  toLocal: string,
  photoIds: string[]
): RawSegment {
  return {
    id,
    clusterId,
    photoIds,
    startMs: at(fromLocal),
    endMs: at(toLocal),
    firstDay: fromLocal.slice(0, 10),
    lastDay: toLocal.slice(0, 10),
    firstLocal: fromLocal,
    lastLocal: toLocal,
  };
}

// Northvale and Kelmore are 638 km apart; Port Carrow is 346 km from Northvale.
const clusters = new Map([
  ["north", cluster("north", offsetKm(NVL, 10, 0))],
  ["kelmore", cluster("kelmore", offsetKm(KEL, 6, 0))],
  ["carrow", cluster("carrow", offsetKm(PCR, 8, 0))],
]);

const area: GroundArea = {
  photoIds: ["a1", "a2", "b1", "c1"],
  seaPhotoIds: ["sea-1"],
  afterFlightId: "zz101",
  beforeFlightId: "zz109",
  startMs: at("2031-05-04 09:00"),
  endMs: at("2031-05-06 12:00"),
  startDay: "2031-05-04",
  endDay: "2031-05-06",
};

function partOf(segments: RawSegment[]): AreaSegments {
  return { area, segments };
}

describe("splitImplicitFlights", () => {
  it("splits an area at a jump of 638 km in two and a half hours", () => {
    const s1 = segment("s1", "north", "2031-05-04 09:00", "2031-05-04 18:00", ["a1", "a2"]);
    const s2 = segment("s2", "kelmore", "2031-05-04 20:30", "2031-05-04 22:00", ["b1"]);
    const { parts, gaps } = splitImplicitFlights(partOf([s1, s2]), clusters);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      area: {
        photoIds: ["a1", "a2"],
        seaPhotoIds: ["sea-1"],
        afterFlightId: "zz101",
        beforeFlightId: null,
        startMs: s1.startMs,
        endMs: s1.endMs,
        startDay: "2031-05-04",
        endDay: "2031-05-04",
      },
      segments: [s1],
    });
    expect(parts[1].area).toMatchObject({
      photoIds: ["b1"],
      afterFlightId: null,
      beforeFlightId: "zz109",
      startMs: s2.startMs,
      endMs: s2.endMs,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ fromDay: "2031-05-04", toDay: "2031-05-04" });
    expect(gaps[0].km).toBeCloseTo(638.42, 1);
    expect(gaps[0].kmh).toBeCloseTo(255.37, 1);
    expect(gaps[0].from.lat).toBeCloseTo(offsetKm(NVL, 10, 0).lat, 6);
    expect(gaps[0].to.lat).toBeCloseTo(offsetKm(KEL, 6, 0).lat, 6);
  });

  it("leaves an area alone when the same distance took 14 hours", () => {
    const s1 = segment("s1", "north", "2031-05-04 09:00", "2031-05-04 18:00", ["a1", "a2"]);
    const s2 = segment("s2", "kelmore", "2031-05-05 08:00", "2031-05-05 12:00", ["b1"]);
    const part = partOf([s1, s2]);
    const result = splitImplicitFlights(part, clusters);
    expect(result.gaps).toEqual([]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toBe(part);
  });

  it("leaves an area alone when a fast jump is shorter than 400 km", () => {
    const s1 = segment("s1", "north", "2031-05-04 09:00", "2031-05-04 18:00", ["a1", "a2"]);
    const s2 = segment("s2", "carrow", "2031-05-04 19:30", "2031-05-04 22:00", ["b1"]);
    expect(splitImplicitFlights(partOf([s1, s2]), clusters).gaps).toEqual([]);
  });

  it("splits at every jump and hands the open flights to the outer parts only", () => {
    const s1 = segment("s1", "north", "2031-05-04 09:00", "2031-05-04 18:00", ["a1"]);
    const s2 = segment("s2", "kelmore", "2031-05-04 20:30", "2031-05-04 22:00", ["b1"]);
    const s3 = segment("s3", "north", "2031-05-05 00:30", "2031-05-05 09:00", ["c1"]);
    const { parts, gaps } = splitImplicitFlights(partOf([s1, s2, s3]), clusters);
    expect(gaps.map((gap) => [gap.fromDay, gap.toDay])).toEqual([
      ["2031-05-04", "2031-05-04"],
      ["2031-05-04", "2031-05-05"],
    ]);
    expect(
      parts.map((p) => [p.area.photoIds, p.area.afterFlightId, p.area.beforeFlightId])
    ).toEqual([
      [["a1"], "zz101", null],
      [["b1"], null, null],
      [["c1"], null, "zz109"],
    ]);
  });

  it("keeps the segments of a part that has several", () => {
    const s1 = segment("s1", "north", "2031-05-04 09:00", "2031-05-04 12:00", ["a1"]);
    const s2 = segment("s2", "north", "2031-05-04 14:00", "2031-05-04 18:00", ["a2"]);
    const s3 = segment("s3", "kelmore", "2031-05-04 20:30", "2031-05-04 22:00", ["b1"]);
    const { parts } = splitImplicitFlights(partOf([s1, s2, s3]), clusters);
    expect(parts[0].segments).toEqual([s1, s2]);
    expect(parts[0].area.photoIds).toEqual(["a1", "a2"]);
    expect(parts[0].area.endMs).toBe(s2.endMs);
  });

  it("does not judge a jump whose cluster it does not know", () => {
    const s1 = segment("s1", "north", "2031-05-04 09:00", "2031-05-04 18:00", ["a1"]);
    const s2 = segment("s2", "elsewhere", "2031-05-04 20:30", "2031-05-04 22:00", ["b1"]);
    expect(splitImplicitFlights(partOf([s1, s2]), clusters).gaps).toEqual([]);
  });

  it("answers an area without segments unchanged", () => {
    const part = partOf([]);
    expect(splitImplicitFlights(part, clusters)).toEqual({ parts: [part], gaps: [] });
  });
});
