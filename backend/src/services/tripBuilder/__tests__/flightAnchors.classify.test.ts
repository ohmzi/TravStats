import { classifyInFlight } from "../flightAnchors";
import type { FlightAnchor, PhotoPoint } from "../types";
import {
  beside,
  between,
  datedFlight,
  NVL,
  offsetKm,
  PCR,
  photo,
  preciseFlight,
} from "./flightFixtures";

// ZZ101 leaves Northvale at 08:30 and lands at Port Carrow at 09:30 on 2031-05-02
// (Pacific/Auckland wall clock); `midAir` is half way along its track.
const zz101 = preciseFlight("zz101", "2031-05-02 08:30", "2031-05-02 09:30", NVL, PCR);
const midAir = between(NVL, PCR, 0.5);
const GROUND = { inFlight: false, flightId: null, rule: null, side: null };

function verdict(shot: PhotoPoint, flights: FlightAnchor[], others: PhotoPoint[] = []) {
  return classifyInFlight([shot, ...others], flights).get(shot.id);
}

describe("classifyInFlight: a precise flight", () => {
  it("puts a photo taken between departure and arrival in the air", () => {
    expect(verdict(photo("air", "2031-05-02 09:00", midAir), [zz101])).toEqual({
      inFlight: true,
      flightId: "zz101",
      rule: "precise",
      side: null,
    });
  });

  it("leaves photos before the departure and after the arrival on the ground", () => {
    const before = photo("before", "2031-05-02 08:00", offsetKm(NVL, 5, 0));
    const after = photo("after", "2031-05-02 10:00", offsetKm(PCR, 5, 0));
    expect(verdict(before, [zz101])).toEqual(GROUND);
    expect(verdict(after, [zz101])).toEqual(GROUND);
  });

  it("counts a photo 8 minutes before landing and 5 km from the airport as ground, after the flight", () => {
    expect(verdict(photo("early", "2031-05-02 09:22", offsetKm(PCR, 5, 0)), [zz101])).toEqual({
      inFlight: false,
      flightId: "zz101",
      rule: "arrivalTolerance",
      side: "after",
    });
  });

  it("keeps a photo at the same time 40 km out on approach in the air", () => {
    expect(verdict(photo("approach", "2031-05-02 09:22", offsetKm(PCR, 40, 0)), [zz101])).toEqual({
      inFlight: true,
      flightId: "zz101",
      rule: "precise",
      side: null,
    });
  });

  it("starts the arrival tolerance exactly 30 minutes before landing", () => {
    const edge = photo("edge", "2031-05-02 09:00", offsetKm(PCR, 5, 0));
    expect(verdict(edge, [zz101])?.rule).toBe("arrivalTolerance");
    const sooner = photo("sooner", "2031-05-02 08:59", offsetKm(PCR, 5, 0));
    expect(verdict(sooner, [zz101])?.inFlight).toBe(true);
  });

  it("counts a photo 10 minutes after departure and 3 km from the airport as ground, before the flight", () => {
    expect(verdict(photo("lounge", "2031-05-02 08:40", offsetKm(NVL, 3, 0)), [zz101])).toEqual({
      inFlight: false,
      flightId: "zz101",
      rule: "departureGrace",
      side: "before",
    });
  });

  it("ends the departure grace 45 minutes after the scheduled departure", () => {
    const edge = photo("edge", "2031-05-02 09:15", offsetKm(NVL, 3, 0));
    expect(verdict(edge, [zz101])?.rule).toBe("departureGrace");
    const later = photo("later", "2031-05-02 09:16", offsetKm(NVL, 3, 0));
    expect(verdict(later, [zz101])?.inFlight).toBe(true);
  });

  it("gives no grace once the flight has an actual departure", () => {
    const left = { ...zz101, hasActualDep: true };
    const lounge = photo("lounge", "2031-05-02 08:40", offsetKm(NVL, 3, 0));
    expect(verdict(lounge, [left])?.inFlight).toBe(true);
  });

  it("calls a photo without a position ground", () => {
    expect(verdict(photo("nogps", "2031-05-02 09:00", null), [zz101])).toEqual(GROUND);
  });

  it("calls every photo ground when there are no flights", () => {
    expect(verdict(photo("any", "2031-05-02 09:00", midAir), [])).toEqual(GROUND);
  });

  it("answers an entry for each photo it was given", () => {
    const shots = [
      photo("a", "2031-05-02 07:00", offsetKm(NVL, 5, 0)),
      photo("b", "2031-05-02 09:00", midAir),
      photo("c", "2031-05-02 11:00", offsetKm(PCR, 5, 0)),
    ];
    const verdicts = classifyInFlight(shots, [zz101]);
    expect([...verdicts.keys()]).toEqual(["a", "b", "c"]);
    expect(verdicts.get("b")?.inFlight).toBe(true);
  });
});

describe("classifyInFlight: a red-eye that leaves the evening before the window", () => {
  // ZZ102 leaves at 22:30 on 2031-05-01 (S - 1) and lands at 00:45 on 2031-05-02 (S).
  const redEye = preciseFlight("zz102", "2031-05-01 22:30", "2031-05-02 00:45", NVL, PCR);

  it("keeps the photos taken after midnight but before landing in the air", () => {
    expect(verdict(photo("night", "2031-05-02 00:20", midAir), [redEye])).toEqual({
      inFlight: true,
      flightId: "zz102",
      rule: "precise",
      side: null,
    });
  });

  it("counts a photo at the airport 10 minutes before landing as ground, after the flight", () => {
    const shot = photo("gate", "2031-05-02 00:35", offsetKm(PCR, 5, 0));
    expect(verdict(shot, [redEye])?.side).toBe("after");
  });

  it("leaves the first photo after landing on the ground", () => {
    expect(verdict(photo("taxi", "2031-05-02 01:10", offsetKm(PCR, 2, 0)), [redEye])).toEqual(
      GROUND
    );
  });
});

describe("classifyInFlight: a delayed arrival", () => {
  it("keeps a photo on the corridor within 3 hours after the scheduled arrival in the air", () => {
    expect(verdict(photo("late", "2031-05-02 10:15", midAir), [zz101])).toEqual({
      inFlight: true,
      flightId: "zz101",
      rule: "delay",
      side: null,
    });
    expect(verdict(photo("limit", "2031-05-02 12:30", midAir), [zz101])?.rule).toBe("delay");
  });

  it("ends the corridor 3 hours after the scheduled arrival", () => {
    expect(verdict(photo("gone", "2031-05-02 12:31", midAir), [zz101])).toEqual(GROUND);
  });

  it("lets the photo go once the flight has an actual arrival", () => {
    const landed = { ...zz101, hasActualArr: true };
    expect(verdict(photo("late", "2031-05-02 10:15", midAir), [landed])).toEqual(GROUND);
  });

  it("does not catch a photo within 50 km of the arrival airport", () => {
    expect(verdict(photo("town", "2031-05-02 10:15", offsetKm(PCR, 30, 0)), [zz101])).toEqual(
      GROUND
    );
  });

  it("does not catch a photo more than 50 km off the corridor", () => {
    const aside = beside(NVL, PCR, 0.5, 80);
    expect(verdict(photo("aside", "2031-05-02 10:15", aside), [zz101])).toEqual(GROUND);
  });

  it("does not catch a photo past either end of the track", () => {
    const beyond = between(NVL, PCR, 1.3);
    expect(verdict(photo("beyond", "2031-05-02 10:15", beyond), [zz101])).toEqual(GROUND);
  });

  it("never calls three photos standing in one place in the air", () => {
    const stop = [
      photo("s1", "2031-05-02 10:00", midAir),
      photo("s2", "2031-05-02 10:20", offsetKm(midAir, 0.3, 0)),
      photo("s3", "2031-05-02 10:40", offsetKm(midAir, 0, 0.3)),
    ];
    const verdicts = classifyInFlight(stop, [zz101]);
    for (const shot of stop) expect(verdicts.get(shot.id)).toEqual(GROUND);
  });
});

describe("classifyInFlight: a flight known only by its day", () => {
  const zz104 = datedFlight("zz104", "2031-05-03", "2031-05-03", NVL, PCR);
  // The traveller photographed Northvale until 09:00 and Port Carrow from 13:00.
  const lastAtNorthvale = photo("nvl-last", "2031-05-03 09:00", offsetKm(NVL, 3, 0));
  const firstAtCarrow = photo("pcr-first", "2031-05-03 13:00", offsetKm(PCR, 3, 0));
  const references = [lastAtNorthvale, firstAtCarrow];

  it("puts a photo on the corridor, between the two reference photos, in the air", () => {
    const mid = photo("mid", "2031-05-03 11:00", midAir);
    expect(verdict(mid, [zz104], references)).toEqual({
      inFlight: true,
      flightId: "zz104",
      rule: "corridor",
      side: null,
    });
  });

  it("keeps a photo from before the last photo at the departure airport on the ground", () => {
    const early = photo("early", "2031-05-03 08:00", midAir);
    expect(verdict(early, [zz104], references)).toEqual(GROUND);
  });

  it("keeps a photo from after the first photo at the arrival airport on the ground", () => {
    const late = photo("late", "2031-05-03 14:00", midAir);
    expect(verdict(late, [zz104], references)).toEqual(GROUND);
  });

  it("leaves a bound open when its reference photo is missing", () => {
    const mid = photo("mid", "2031-05-03 11:00", midAir);
    expect(verdict(mid, [zz104])?.inFlight).toBe(true);
    expect(verdict(mid, [zz104], [lastAtNorthvale])?.inFlight).toBe(true);
    expect(verdict(mid, [zz104], [firstAtCarrow])?.inFlight).toBe(true);
    const beforeDeparture = photo("early", "2031-05-03 08:00", midAir);
    expect(verdict(beforeDeparture, [zz104], [lastAtNorthvale])?.inFlight).toBe(false);
    const afterArrival = photo("late", "2031-05-03 14:00", midAir);
    expect(verdict(afterArrival, [zz104], [firstAtCarrow])?.inFlight).toBe(false);
  });

  it("ignores photos on other days", () => {
    expect(verdict(photo("eve", "2031-05-02 11:00", midAir), [zz104])).toEqual(GROUND);
    expect(verdict(photo("morrow", "2031-05-04 11:00", midAir), [zz104])).toEqual(GROUND);
  });

  it("takes the reference photos from the flight's days only", () => {
    const nextDay = photo("nvl-next", "2031-05-04 15:00", offsetKm(NVL, 3, 0));
    const mid = photo("mid", "2031-05-03 11:00", midAir);
    expect(verdict(mid, [zz104], [...references, nextDay])?.inFlight).toBe(true);
  });

  it("keeps a photo within 50 km of an airport on the ground", () => {
    const nearNorthvale = between(NVL, PCR, 0.0865);
    expect(verdict(photo("near", "2031-05-03 11:00", nearNorthvale), [zz104])).toEqual(GROUND);
  });

  it("keeps a photo more than 50 km off the corridor on the ground", () => {
    const aside = beside(NVL, PCR, 0.5, 60);
    expect(verdict(photo("aside", "2031-05-03 11:00", aside), [zz104])).toEqual(GROUND);
  });

  it("keeps a photo past either end of the track on the ground", () => {
    const beyond = between(NVL, PCR, 1.3);
    expect(verdict(photo("beyond", "2031-05-03 11:00", beyond), [zz104])).toEqual(GROUND);
  });

  it("keeps a highway town 34 km off the track on the ground when photos show a stop there", () => {
    const town = beside(NVL, PCR, 0.5, 34);
    const stop = [
      photo("town-1", "2031-05-03 11:10", town),
      photo("town-2", "2031-05-03 11:25", offsetKm(town, 0.3, 0)),
      photo("town-3", "2031-05-03 11:40", offsetKm(town, 0, 0.3)),
    ];
    const verdicts = classifyInFlight([...references, ...stop], [zz104]);
    for (const shot of stop) expect(verdicts.get(shot.id)).toEqual(GROUND);
    // Without the stop, a lone photo in that town would pass for a window seat.
    expect(verdict(photo("lone", "2031-05-03 11:25", town), [zz104], references)?.inFlight).toBe(
      true
    );
  });
});
