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
  WMT,
} from "./flightFixtures";

/** What the pipeline does: classify, drop the photos in the air, split what is left. */
function split(photos: PhotoPoint[], flights: FlightAnchor[]) {
  const classes = classifyInFlight(photos, flights);
  const ground = photos.filter((shot) => !classes.get(shot.id)?.inFlight);
  return splitIntoAreas(ground, flights, classes);
}

/** Every order the items can arrive in. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

/** Test names for `it.each`: the ids of the flights in the order they are handed over. */
function arrivals(flights: FlightAnchor[]): [string, FlightAnchor[]][] {
  return permutations(flights).map((order) => [order.map((flight) => flight.id).join(", "), order]);
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

describe("splitIntoAreas: a layover between flights known only by their day", () => {
  // The ids sort the outbound flight first: only the connection can put them in order.
  const inbound = datedFlight("b-in", "2031-05-03", "2031-05-03", NVL, PCR);
  const outbound = datedFlight("a-out", "2031-05-03", "2031-05-03", PCR, KEL);
  const before = photo("nvl-1", "2031-05-03 07:00", offsetKm(NVL, 10, 0));
  const terminal = [
    photo("terminal-1", "2031-05-03 11:00", offsetKm(PCR, 3, 0)),
    photo("terminal-2", "2031-05-03 12:30", offsetKm(PCR, 4, 2)),
  ];
  const kelmore = photo("kel-1", "2031-05-03 19:00", offsetKm(KEL, 6, 0));

  it("reports the stretch at the shared airport on one day as a layover", () => {
    const { areas, layovers } = split([before, ...terminal, kelmore], [outbound, inbound]);
    expect(layovers).toEqual([
      {
        inFlightId: "b-in",
        outFlightId: "a-out",
        airportIata: "PCR",
        photoIds: ["terminal-1", "terminal-2"],
      },
    ]);
    expect(areas.map((area) => area.photoIds)).toEqual([["nvl-1"], ["kel-1"]]);
  });

  it("makes an area of it when the traveller stayed the night", () => {
    const nextDay = datedFlight("a-out", "2031-05-04", "2031-05-04", PCR, KEL);
    const tomorrow = photo("kel-1", "2031-05-04 19:00", offsetKm(KEL, 6, 0));
    const { areas, layovers } = split([before, ...terminal, tomorrow], [inbound, nextDay]);
    expect(layovers).toEqual([]);
    expect(areas.map((area) => area.photoIds)).toEqual([
      ["nvl-1"],
      ["terminal-1", "terminal-2"],
      ["kel-1"],
    ]);
  });

  it("makes an area of it when a photo is more than 30 km from the airport", () => {
    const wander = photo("terminal-2", "2031-05-03 12:30", offsetKm(PCR, 45, 0));
    const { areas, layovers } = split([before, terminal[0], wander, kelmore], [inbound, outbound]);
    expect(layovers).toEqual([]);
    expect(areas).toHaveLength(3);
  });
});

describe("splitIntoAreas: the order of the flights does not depend on how they arrive", () => {
  const day = "2031-05-03";
  const before = photo("nvl-1", `${day} 06:10`, offsetKm(NVL, 10, 0));
  const carrow = [
    photo("pcr-1", `${day} 10:40`, offsetKm(PCR, 3, 0)),
    photo("pcr-2", `${day} 11:30`, offsetKm(PCR, 2, 1)),
  ];
  const kelmore = [
    photo("kel-1", `${day} 15:30`, offsetKm(KEL, 3, 0)),
    photo("kel-2", `${day} 16:30`, offsetKm(KEL, 2, 1)),
  ];
  const westmouth = photo("wmt-1", `${day} 19:00`, offsetKm(WMT, 6, 0));
  const photos = [before, ...carrow, ...kelmore, westmouth];

  // Three legs, NVL to PCR to KEL to WMT, whose ids run against the chain: sorted by id they
  // come last leg first, so only the connections can put them right.
  const first = datedFlight("c-first", day, day, NVL, PCR);
  const second = datedFlight("b-second", day, day, PCR, KEL);
  const third = datedFlight("a-third", day, day, KEL, WMT);

  it.each(arrivals([first, second, third]))(
    "reads three day-level legs of one day in the order they connect when handed over as %s",
    (_order, flights) => {
      const { areas, layovers } = split(photos, flights);
      expect(layovers).toEqual([
        {
          inFlightId: "c-first",
          outFlightId: "b-second",
          airportIata: "PCR",
          photoIds: ["pcr-1", "pcr-2"],
        },
        {
          inFlightId: "b-second",
          outFlightId: "a-third",
          airportIata: "KEL",
          photoIds: ["kel-1", "kel-2"],
        },
      ]);
      expect(areas.map((area) => [area.photoIds, area.afterFlightId, area.beforeFlightId])).toEqual(
        [
          [["nvl-1"], null, "c-first"],
          [["wmt-1"], "a-third", null],
        ]
      );
    }
  );

  // A precise flight beside day-level ones: the first two legs have instants, but the ids run
  // against both the times and the chain.
  const timedFirst = preciseFlight("c-first", `${day} 08:30`, `${day} 09:30`, NVL, PCR);
  const timedSecond = preciseFlight("a-second", `${day} 13:00`, `${day} 14:10`, PCR, KEL);
  const datedThird = datedFlight("b-third", day, day, KEL, WMT);

  it.each(arrivals([timedFirst, timedSecond, datedThird]))(
    "puts a day-level last leg after the precise legs it connects from when handed over as %s",
    (_order, flights) => {
      const { areas, layovers } = split(photos, flights);
      expect(layovers.map((layover) => [layover.inFlightId, layover.outFlightId])).toEqual([
        ["c-first", "a-second"],
        ["a-second", "b-third"],
      ]);
      expect(areas.map((area) => [area.photoIds, area.afterFlightId, area.beforeFlightId])).toEqual(
        [
          [["nvl-1"], null, "c-first"],
          [["wmt-1"], "b-third", null],
        ]
      );
    }
  );

  // A day-level leg between two precise ones: it comes second because it connects, or because of
  // its clock, and not because it is the one without an instant.
  describe.each([
    ["no clock", null],
    ["a clock of 12:00", "12:00"],
  ])("a day-level middle leg with %s", (_clock, depClock) => {
    const outbound = preciseFlight("c-first", `${day} 08:30`, `${day} 09:30`, NVL, PCR);
    const middle = datedFlight("b-middle", day, day, PCR, KEL, { depClock });
    const onward = preciseFlight("a-last", `${day} 17:30`, `${day} 18:40`, KEL, WMT);

    it.each(arrivals([outbound, middle, onward]))(
      "sits between the precise legs it connects when handed over as %s",
      (_order, flights) => {
        const { areas, layovers } = split(photos, flights);
        expect(layovers.map((layover) => [layover.inFlightId, layover.outFlightId])).toEqual([
          ["c-first", "b-middle"],
          ["b-middle", "a-last"],
        ]);
        expect(
          areas.map((area) => [area.photoIds, area.afterFlightId, area.beforeFlightId])
        ).toEqual([
          [["nvl-1"], null, "c-first"],
          [["wmt-1"], "a-last", null],
        ]);
      }
    );
  });

  // Two legs of one day, NVL to PCR then PCR to KEL, one known only by its day: the legs connect
  // in both directions of the ids and of the arrival, with the day-level leg's clock (when it has
  // one) agreeing with the precise leg's time.
  const landed = photo("kel-1", `${day} 17:30`, offsetKm(KEL, 6, 0));
  const twoLegs: [string, (first: string, second: string) => FlightAnchor[]][] = [
    [
      "a day-level first leg with no clock",
      (first, second) => [
        datedFlight(first, day, day, NVL, PCR),
        preciseFlight(second, `${day} 15:00`, `${day} 16:10`, PCR, KEL),
      ],
    ],
    [
      "a day-level first leg at 07:00",
      (first, second) => [
        datedFlight(first, day, day, NVL, PCR, { depClock: "07:00" }),
        preciseFlight(second, `${day} 15:00`, `${day} 16:10`, PCR, KEL),
      ],
    ],
    [
      "a day-level second leg with no clock",
      (first, second) => [
        preciseFlight(first, `${day} 08:30`, `${day} 09:30`, NVL, PCR),
        datedFlight(second, day, day, PCR, KEL),
      ],
    ],
    [
      "a day-level second leg at 16:00",
      (first, second) => [
        preciseFlight(first, `${day} 08:30`, `${day} 09:30`, NVL, PCR),
        datedFlight(second, day, day, PCR, KEL, { depClock: "16:00" }),
      ],
    ],
  ];
  const twoLegCases: [string, FlightAnchor[], string, string][] = twoLegs.flatMap(
    ([label, build]) =>
      [
        ["a-first", "b-second"],
        ["b-first", "a-second"],
      ].flatMap(([first, second]) =>
        arrivals(build(first, second)).map(
          ([order, flights]): [string, FlightAnchor[], string, string] => [
            `${label}, ids ${first} and ${second}, handed over as ${order}`,
            flights,
            first,
            second,
          ]
        )
      )
  );

  it.each(twoLegCases)("reads %s as a connection", (_name, flights, first, second) => {
    const { areas, layovers } = split([before, ...carrow, landed], flights);
    expect(layovers).toEqual([
      { inFlightId: first, outFlightId: second, airportIata: "PCR", photoIds: ["pcr-1", "pcr-2"] },
    ]);
    expect(areas.map((area) => [area.photoIds, area.afterFlightId, area.beforeFlightId])).toEqual([
      [["nvl-1"], null, first],
      [["kel-1"], second, null],
    ]);
  });

  // In the four tests below the ids sort the legs against the evidence, so only the evidence can
  // put them right. Each area comes out as [photo ids, afterFlightId, beforeFlightId].
  const legsAreas = (flights: FlightAnchor[], shots: PhotoPoint[]) =>
    split(shots, flights).areas.map((area) => [
      area.photoIds,
      area.afterFlightId,
      area.beforeFlightId,
    ]);

  it.each(
    arrivals([
      preciseFlight("b-out", `${day} 08:30`, `${day} 09:30`, NVL, PCR),
      // Leaves later, but from a place whose clock runs hours behind: it reads 02:00.
      preciseFlight("a-on", `${day} 13:00`, `${day} 14:10`, PCR, KEL, { depClock: "02:00" }),
    ])
  )(
    "orders precise legs by their instants, not their clocks, when handed over as %s",
    (_order, flights) => {
      expect(legsAreas(flights, [before, ...carrow, landed])).toEqual([
        [["nvl-1"], null, "b-out"],
        [["kel-1"], "a-on", null],
      ]);
    }
  );

  it.each(
    arrivals([
      datedFlight("a-later", "2031-05-04", "2031-05-04", NVL, PCR),
      datedFlight("b-earlier", "2031-05-03", "2031-05-03", PCR, KEL),
    ])
  )(
    "orders day-level legs by their day before their connection when handed over as %s",
    (_order, flights) => {
      // a-later lands where b-earlier leaves, but it flies a day after it.
      const shots = [
        photo("start", "2031-05-03 08:00", offsetKm(PCR, 4, 0)),
        photo("k", "2031-05-03 18:00", offsetKm(KEL, 3, 0)),
        photo("n", "2031-05-04 07:00", offsetKm(NVL, 5, 0)),
        photo("p", "2031-05-04 16:00", offsetKm(PCR, 6, 0)),
      ];
      expect(legsAreas(flights, shots)).toEqual([
        [["start"], null, "b-earlier"],
        [["k", "n"], "b-earlier", "a-later"],
        [["p"], "a-later", null],
      ]);
    }
  );

  it.each(
    arrivals([
      datedFlight("a-late-leg", day, day, KEL, WMT, { depClock: "16:00" }),
      datedFlight("b-early-leg", day, day, NVL, PCR, { depClock: "07:00" }),
    ])
  )(
    "orders day-level legs of one day by their clocks when handed over as %s",
    (_order, flights) => {
      const shots = [before, carrow[0], kelmore[0], westmouth];
      expect(legsAreas(flights, shots)).toEqual([
        [["nvl-1"], null, "b-early-leg"],
        [["pcr-1", "kel-1"], "b-early-leg", "a-late-leg"],
        [["wmt-1"], "a-late-leg", null],
      ]);
    }
  );

  it.each(
    arrivals([
      datedFlight("b-ring", day, day, NVL, PCR),
      datedFlight("c-ring", day, day, PCR, KEL),
      datedFlight("d-ring", day, day, KEL, NVL),
      datedFlight("a-after", "2031-05-04", "2031-05-04", KEL, WMT),
    ])
  )(
    "keeps the day order when a circle leaves nothing to go first, handed over as %s",
    (_order, flights) => {
      // The circle holds the first three legs; the leg of the next day, whose id sorts first, is last.
      const shots = [before, ...carrow, ...kelmore, photo("wmt-2", "2031-05-04 10:00", WMT)];
      const areas = legsAreas(flights, shots);
      expect(areas[areas.length - 1]).toEqual([["wmt-2"], "a-after", null]);
    }
  );

  it.each(
    arrivals([
      datedFlight("a-ring", day, day, NVL, PCR),
      datedFlight("b-ring", day, day, PCR, KEL),
      datedFlight("c-ring", day, day, KEL, NVL),
    ])
  )(
    "reads day-level legs whose connections run in a circle the same way when handed over as %s",
    (_order, flights) => {
      // Each leg lands where the next one leaves and the last lands where the first leaves: no
      // leg comes first by its connections, so the id order stands. The photos of a round trip
      // are as ambiguous as its flights; what matters is one answer for every arrival order.
      const { areas, layovers } = split([before, ...carrow, ...kelmore], flights);
      expect(layovers).toEqual([
        {
          inFlightId: "b-ring",
          outFlightId: "c-ring",
          airportIata: "KEL",
          photoIds: ["kel-1", "kel-2"],
        },
      ]);
      expect(areas.map((area) => [area.photoIds, area.afterFlightId, area.beforeFlightId])).toEqual(
        [[["nvl-1", "pcr-1", "pcr-2"], "a-ring", "b-ring"]]
      );
    }
  );
});
