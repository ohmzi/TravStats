import { classifyInFlight, splitIntoAreas } from "../flightAnchors";
import type { FlightAnchor, PhotoPoint } from "../types";
import {
  at,
  beside,
  between,
  datedFlight,
  KEL,
  NVL,
  offsetKm,
  PCR,
  photo,
  preciseFlight,
  seaPhoto,
} from "./flightFixtures";

/** What the pipeline does: classify, drop the photos in the air, split what is left. */
function split(photos: PhotoPoint[], flights: FlightAnchor[]) {
  const classes = classifyInFlight(photos, flights);
  const ground = photos.filter((shot) => !classes.get(shot.id)?.inFlight);
  return splitIntoAreas(ground, flights, classes);
}

describe("splitIntoAreas: a precise flight", () => {
  // ZZ101 leaves Northvale at 08:30 and lands at Port Carrow at 09:30 on 2031-05-02.
  const zz101 = preciseFlight("zz101", "2031-05-02 08:30", "2031-05-02 09:30", NVL, PCR);
  const northvale = [
    photo("nvl-1", "2031-05-02 06:10", offsetKm(NVL, 12, 0)),
    photo("nvl-2", "2031-05-02 07:40", offsetKm(NVL, 8, 2)),
  ];
  const lounge = photo("lounge", "2031-05-02 08:40", offsetKm(NVL, 3, 0)); // departure grace
  const inTheAir = photo("air", "2031-05-02 09:00", between(NVL, PCR, 0.5));
  const approach = photo("approach", "2031-05-02 09:22", offsetKm(PCR, 40, 0)); // 40 km out
  const early = photo("early", "2031-05-02 09:22", offsetKm(PCR, 5, 0)); // arrival tolerance
  const carrow = [
    photo("pcr-1", "2031-05-02 10:30", offsetKm(PCR, 8, 0)),
    photo("pcr-2", "2031-05-02 15:00", offsetKm(PCR, 9, 1)),
  ];
  const day = [...northvale, lounge, inTheAir, approach, early, ...carrow];

  it("cuts the ground at the flight into the area before it and the area after it", () => {
    const { areas, layovers } = split(day, [zz101]);
    expect(areas).toEqual([
      {
        photoIds: ["nvl-1", "nvl-2", "lounge"],
        seaPhotoIds: [],
        afterFlightId: null,
        beforeFlightId: "zz101",
        startMs: at("2031-05-02 06:10"),
        endMs: at("2031-05-02 08:40"),
        startDay: "2031-05-02",
        endDay: "2031-05-02",
      },
      {
        photoIds: ["early", "pcr-1", "pcr-2"],
        seaPhotoIds: [],
        afterFlightId: "zz101",
        beforeFlightId: null,
        startMs: at("2031-05-02 09:22"),
        endMs: at("2031-05-02 15:00"),
        startDay: "2031-05-02",
        endDay: "2031-05-02",
      },
    ]);
    expect(layovers).toEqual([]);
  });

  it("puts a photo 8 minutes before landing and 5 km out in the later area", () => {
    const { areas } = split(day, [zz101]);
    expect(areas[0].photoIds).not.toContain("early");
    expect(areas[1].photoIds[0]).toBe("early");
  });

  it("puts a photo in the departure grace in the earlier area", () => {
    const { areas } = split(day, [zz101]);
    expect(areas[0].photoIds).toContain("lounge");
    expect(areas[1].photoIds).not.toContain("lounge");
  });

  it("puts the photos taken in the air, and the one 40 km out on approach, in no area", () => {
    const { areas } = split(day, [zz101]);
    const every = areas.flatMap((area) => area.photoIds);
    expect(every).not.toContain("air");
    expect(every).not.toContain("approach");
  });

  it("does not care in which order the photos arrive", () => {
    const { areas } = split([...day].reverse(), [zz101]);
    expect(areas.map((area) => area.photoIds)).toEqual([
      ["nvl-1", "nvl-2", "lounge"],
      ["early", "pcr-1", "pcr-2"],
    ]);
  });

  it("answers one area, with no flight on the open side, when every photo is on one side", () => {
    const { areas } = split([...northvale, lounge], [zz101]);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ afterFlightId: null, beforeFlightId: "zz101" });
  });

  it("answers no area for no photos", () => {
    expect(split([], [zz101])).toEqual({ areas: [], layovers: [] });
  });

  it("answers one area, bounded by the flight before it, when the flight left before the window", () => {
    const earlier = preciseFlight("zz100", "2031-04-30 10:00", "2031-04-30 11:00", NVL, PCR);
    const { areas } = split(carrow, [earlier]);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ afterFlightId: "zz100", beforeFlightId: null });
  });

  it("makes one area, with no flight on either side, when there are no flights", () => {
    const { areas } = split(day, []);
    expect(
      areas.map((area) => [area.photoIds.length, area.afterFlightId, area.beforeFlightId])
    ).toEqual([[8, null, null]]);
  });

  it("falls back to the nearer airport for a photo inside the flight that nobody classified", () => {
    const loose = photo("loose", "2031-05-02 09:00", offsetKm(PCR, 5, 0));
    const { areas } = splitIntoAreas([loose], [zz101], new Map());
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ photoIds: ["loose"], afterFlightId: "zz101" });
  });

  it("ignores a photo the classifier called in the air even when it is handed over", () => {
    const classes = classifyInFlight(day, [zz101]);
    const { areas } = splitIntoAreas(day, [zz101], classes);
    expect(areas.flatMap((area) => area.photoIds)).not.toContain("air");
  });
});

describe("splitIntoAreas: a red-eye that leaves the evening before the window", () => {
  // ZZ102 leaves at 22:30 on 2031-05-01 (S - 1) and lands at 00:45 on 2031-05-02 (S).
  const redEye = preciseFlight("zz102", "2031-05-01 22:30", "2031-05-02 00:45", NVL, PCR);

  it("opens the window's only area at the gate, after the flight", () => {
    const photos = [
      photo("night", "2031-05-02 00:20", between(NVL, PCR, 0.5)),
      photo("gate", "2031-05-02 00:35", offsetKm(PCR, 5, 0)),
      photo("breakfast", "2031-05-02 08:00", offsetKm(PCR, 6, 0)),
      photo("lunch", "2031-05-02 12:00", offsetKm(PCR, 7, 1)),
    ];
    const { areas, layovers } = split(photos, [redEye]);
    expect(layovers).toEqual([]);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      photoIds: ["gate", "breakfast", "lunch"],
      afterFlightId: "zz102",
      beforeFlightId: null,
      startDay: "2031-05-02",
    });
  });
});

describe("splitIntoAreas: sea photos", () => {
  const zz101 = preciseFlight("zz101", "2031-05-02 08:30", "2031-05-02 09:30", NVL, PCR);
  const arrival = photo("early", "2031-05-02 09:22", offsetKm(PCR, 5, 0));
  const town = photo("pcr-1", "2031-05-02 10:30", offsetKm(PCR, 8, 0));

  it("keeps an at-sea photo out of the movement photos but on its side of the flight", () => {
    const deck = seaPhoto("deck", "2031-05-02 14:00", offsetKm(PCR, 20, 20));
    const { areas } = split([arrival, town, deck], [zz101]);
    expect(areas).toHaveLength(1);
    expect(areas[0].photoIds).toEqual(["early", "pcr-1"]);
    expect(areas[0].seaPhotoIds).toEqual(["deck"]);
    expect(areas[0].endMs).toBe(at("2031-05-02 10:30"));
  });

  it("drops a stretch that holds only sea photos", () => {
    const strait = seaPhoto("strait", "2031-05-02 06:00", offsetKm(NVL, 30, 30));
    const { areas } = split([strait, arrival, town], [zz101]);
    expect(areas).toHaveLength(1);
    expect(areas[0].afterFlightId).toBe("zz101");
  });
});

describe("splitIntoAreas: a flight known only by its day", () => {
  const zz104 = datedFlight("zz104", "2031-05-03", "2031-05-03", NVL, PCR);
  const photos = [
    photo("eve", "2031-05-02 19:00", offsetKm(NVL, 10, 0)), // the day before: before
    photo("dep-1", "2031-05-03 07:30", offsetKm(NVL, 5, 0)),
    // Nearer Port Carrow, but taken before the last photo at Northvale.
    photo("early-far", "2031-05-03 08:30", offsetKm(PCR, 0, -60)),
    photo("dep-2", "2031-05-03 09:00", offsetKm(NVL, 3, 0)), // the last photo at the departure airport
    // Between the two reference photos and off the corridor: the nearer airport decides.
    photo("far-1", "2031-05-03 11:00", beside(NVL, PCR, 0.3, 90)),
    photo("far-2", "2031-05-03 11:30", beside(NVL, PCR, 0.7, 90)),
    photo("arr-1", "2031-05-03 13:00", offsetKm(PCR, 3, 0)), // the first photo at the arrival airport
    // Nearer Northvale, but taken after the first photo at Port Carrow.
    photo("late-far", "2031-05-03 14:00", offsetKm(NVL, 0, 60)),
    photo("arr-2", "2031-05-03 16:00", offsetKm(PCR, 8, 0)),
    photo("morrow", "2031-05-04 10:00", offsetKm(PCR, 5, 0)), // the day after: after
  ];

  it("splits by day, then by the time order of the reference photos, then by the nearer airport", () => {
    const { areas, layovers } = split(photos, [zz104]);
    expect(layovers).toEqual([]);
    expect(areas.map((area) => area.photoIds)).toEqual([
      ["eve", "dep-1", "early-far", "dep-2", "far-1"],
      ["far-2", "arr-1", "late-far", "arr-2", "morrow"],
    ]);
    expect(areas[0]).toMatchObject({ afterFlightId: null, beforeFlightId: "zz104" });
    expect(areas[1]).toMatchObject({ afterFlightId: "zz104", beforeFlightId: null });
  });

  it("splits by day alone when the flight's days hold no photo", () => {
    const { areas } = split([photos[0], photos[9]], [zz104]);
    expect(areas.map((area) => area.photoIds)).toEqual([["eve"], ["morrow"]]);
  });
});

describe("splitIntoAreas: a layover between precise flights", () => {
  const inbound = preciseFlight("zz101", "2031-05-02 08:30", "2031-05-02 09:30", NVL, PCR);
  const outbound = preciseFlight("zz103", "2031-05-02 13:00", "2031-05-02 14:10", PCR, KEL);
  const before = photo("nvl-1", "2031-05-02 06:10", offsetKm(NVL, 12, 0));
  const gate = photo("gate", "2031-05-02 09:22", offsetKm(PCR, 5, 0));
  const terminal = [
    photo("terminal-1", "2031-05-02 10:40", offsetKm(PCR, 2, 1)),
    photo("terminal-2", "2031-05-02 11:30", offsetKm(PCR, 1, 1)),
  ];
  const kelmore = photo("kel-1", "2031-05-02 15:30", offsetKm(KEL, 6, 0));

  it("reports the stretch at the shared airport as a layover and not as an area", () => {
    const { areas, layovers } = split([before, gate, ...terminal, kelmore], [inbound, outbound]);
    expect(layovers).toEqual([
      {
        inFlightId: "zz101",
        outFlightId: "zz103",
        airportIata: "PCR",
        photoIds: ["gate", "terminal-1", "terminal-2"],
      },
    ]);
    expect(areas.map((area) => [area.photoIds, area.afterFlightId, area.beforeFlightId])).toEqual([
      [["nvl-1"], null, "zz101"],
      [["kel-1"], "zz103", null],
    ]);
  });

  it("makes an area of it when a photo wanders more than 30 km from the airport", () => {
    const wander = photo("wander", "2031-05-02 11:30", offsetKm(PCR, 45, 0));
    const { areas, layovers } = split([gate, terminal[0], wander], [inbound, outbound]);
    expect(layovers).toEqual([]);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ afterFlightId: "zz101", beforeFlightId: "zz103" });
  });

  it("makes an area of it when the ground time is 12 hours or more", () => {
    const late = preciseFlight("zz103", "2031-05-02 21:30", "2031-05-02 22:40", PCR, KEL);
    const { areas, layovers } = split([gate, ...terminal], [inbound, late]);
    expect(layovers).toEqual([]);
    expect(areas).toHaveLength(1);
  });

  it("makes an area of it when the next flight leaves from another airport", () => {
    const elsewhere = preciseFlight("zz106", "2031-05-02 13:00", "2031-05-02 15:30", KEL, NVL);
    const { areas, layovers } = split([gate, ...terminal], [inbound, elsewhere]);
    expect(layovers).toEqual([]);
    expect(areas).toHaveLength(1);
  });
});
