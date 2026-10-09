import { toFlightAnchor } from "../loadFlights";
import { flightRow, WINDOW } from "./flightRows";

const NO_CATALOGUE: ReadonlyMap<string, string> = new Map();

describe("toFlightAnchor: what a stored flight is", () => {
  it("reads a real-instant flight on the clock of each airport", () => {
    const anchor = toFlightAnchor(flightRow(), NO_CATALOGUE, WINDOW, null);
    expect(anchor).toMatchObject({
      id: "fl-1",
      label: "ZZ101 NVL→PCR",
      depIata: "NVL",
      arrIata: "PCR",
      dep: { lat: -45.021, lon: 168.739 },
      arr: { lat: -43.489, lon: 172.532 },
      depZone: "Pacific/Auckland",
      arrZone: "Pacific/Auckland",
      depDay: "2031-05-02",
      arrDay: "2031-05-02",
      depClock: "08:30",
      arrClock: "09:30",
      precise: true,
      depMs: Date.parse("2031-05-01T20:30:00Z"),
      arrMs: Date.parse("2031-05-01T21:30:00Z"),
      hasActualDep: false,
      hasActualArr: false,
    });
  });

  it("flies the airborne interval on the actual times, and says so", () => {
    const anchor = toFlightAnchor(
      flightRow({
        actualDeparture: new Date("2031-05-01T20:41:00Z"),
        actualArrival: new Date("2031-05-01T21:22:00Z"),
      }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    expect(anchor.depMs).toBe(Date.parse("2031-05-01T20:41:00Z"));
    expect(anchor.arrMs).toBe(Date.parse("2031-05-01T21:22:00Z"));
    expect(anchor.hasActualDep).toBe(true);
    expect(anchor.hasActualArr).toBe(true);
    expect(anchor.depClock).toBe("08:30");
  });

  it("reads a legacy fake-UTC row as the wall clock it stores, and is not precise", () => {
    const anchor = toFlightAnchor(
      flightRow({
        depTimeSemantics: "LEGACY_FAKE_UTC",
        arrTimeSemantics: "LEGACY_FAKE_UTC",
        departureTime: new Date("2031-05-02T08:30:00Z"),
        arrivalTime: new Date("2031-05-02T09:30:00Z"),
      }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    expect(anchor).toMatchObject({
      depDay: "2031-05-02",
      depClock: "08:30",
      arrClock: "09:30",
      precise: false,
      depMs: null,
      arrMs: null,
    });
  });

  it("reads a date-only row as the date it stores, whatever the zone", () => {
    const anchor = toFlightAnchor(
      flightRow({
        depTimeSemantics: "DATE_ONLY",
        arrTimeSemantics: "DATE_ONLY",
        depPrecision: "day",
        arrPrecision: "day",
        departureTime: new Date("2031-05-03T12:00:00Z"),
        arrivalTime: new Date("2031-05-03T12:00:00Z"),
      }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    // Noon UTC is already 00:00 on the 4th in Pacific/Auckland; the stored date wins.
    expect(anchor).toMatchObject({
      depDay: "2031-05-03",
      arrDay: "2031-05-03",
      depClock: null,
      arrClock: null,
      precise: false,
    });
  });

  it("is not precise when either end only knows the day, even on a real instant", () => {
    const anchor = toFlightAnchor(
      flightRow({
        depPrecision: "day",
        departureTime: new Date("2031-05-01T12:00:00Z"),
      }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    expect(anchor).toMatchObject({ depDay: "2031-05-02", depClock: null, precise: false });
  });

  it("falls back to the airport catalogue for a row stored without a zone", () => {
    const anchor = toFlightAnchor(
      flightRow({ depTimezone: null, arrTimezone: null }),
      new Map([["NVL", "Pacific/Auckland"]]),
      WINDOW,
      null
    );
    expect(anchor.depZone).toBe("Pacific/Auckland");
    expect(anchor.depClock).toBe("08:30");
    // No zone for PCR anywhere: the stored UTC components are the best reading left.
    expect(anchor.arrZone).toBeNull();
    expect(anchor.arrDay).toBe("2031-05-01");
    expect(anchor.arrClock).toBe("21:30");
  });

  it("ignores a zone name the runtime does not know", () => {
    const anchor = toFlightAnchor(
      flightRow({ depTimezone: "Not/AZone" }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    expect(anchor.depZone).toBeNull();
    expect(anchor.depDay).toBe("2031-05-01");
  });

  it("has no airborne interval without an arrival after the departure", () => {
    const missing = toFlightAnchor(flightRow({ arrivalTime: null }), NO_CATALOGUE, WINDOW, null);
    expect(missing).toMatchObject({
      precise: false,
      depMs: null,
      arrMs: null,
      arrDay: "2031-05-02",
      arrClock: null,
    });
    const reversed = toFlightAnchor(
      flightRow({ arrivalTime: new Date("2031-05-01T20:00:00Z") }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    expect(reversed.precise).toBe(false);
  });

  it("labels a flight by number, else airline, else route alone", () => {
    const labelOf = (over: Parameters<typeof flightRow>[0]) =>
      toFlightAnchor(flightRow(over), NO_CATALOGUE, WINDOW, null).label;
    expect(labelOf({})).toBe("ZZ101 NVL→PCR");
    expect(labelOf({ flightNumber: null })).toBe("Zephyr Air NVL→PCR");
    expect(labelOf({ flightNumber: null, airline: null })).toBe("NVL→PCR");
    expect(labelOf({ flightNumber: null, airline: null, depIata: null, depIcao: "ZZNV" })).toBe(
      "ZZNV→PCR"
    );
    expect(labelOf({ flightNumber: null, airline: null, arrIata: null })).toBe("NVL→?");
  });

  it("refuses a row without a departure time instead of guessing its day", () => {
    expect(() =>
      toFlightAnchor(flightRow({ departureTime: null }), NO_CATALOGUE, WINDOW, null)
    ).toThrow("Flight fl-1 has no departure time");
  });
});

describe("toFlightAnchor: listed", () => {
  const listedFor = (depUtc: string, arrUtc: string) =>
    toFlightAnchor(
      flightRow({ departureTime: new Date(depUtc), arrivalTime: new Date(arrUtc) }),
      NO_CATALOGUE,
      WINDOW,
      null
    ).listed;

  it("lists a flight inside the window", () => {
    expect(listedFor("2031-05-04T20:30:00Z", "2031-05-04T21:30:00Z")).toBe(true);
  });

  it("lists a red-eye that leaves the evening before the window and lands inside it", () => {
    // 22:30 on 2031-05-01 → 00:45 on 2031-05-02, Pacific/Auckland.
    expect(listedFor("2031-05-01T10:30:00Z", "2031-05-01T12:45:00Z")).toBe(true);
  });

  it("does not list a flight that left two days before the window", () => {
    expect(listedFor("2031-04-29T10:30:00Z", "2031-05-01T12:45:00Z")).toBe(false);
  });

  it("does not list a flight that landed the day before the window", () => {
    expect(listedFor("2031-04-30T20:30:00Z", "2031-04-30T21:30:00Z")).toBe(false);
  });

  it("lists a flight on the last day and not one on the day after", () => {
    expect(listedFor("2031-05-08T20:30:00Z", "2031-05-08T21:30:00Z")).toBe(true);
    expect(listedFor("2031-05-09T20:30:00Z", "2031-05-09T21:30:00Z")).toBe(false);
  });
});

describe("toFlightAnchor: ticks", () => {
  const trip = { id: "trip-a", name: "Northvale loop" };

  it("ticks a flight that is on no trip", () => {
    const anchor = toFlightAnchor(flightRow(), NO_CATALOGUE, WINDOW, "trip-b");
    expect(anchor).toMatchObject({
      tripId: null,
      tripName: null,
      defaultAssign: true,
      locked: false,
    });
  });

  it("leaves a flight filed on another trip unticked and names that trip", () => {
    const anchor = toFlightAnchor(
      flightRow({ tripId: "trip-a", trip }),
      NO_CATALOGUE,
      WINDOW,
      "trip-b"
    );
    expect(anchor).toMatchObject({
      tripId: "trip-a",
      tripName: "Northvale loop",
      defaultAssign: false,
      locked: false,
    });
  });

  it("shows a flight already on the target trip ticked and locked", () => {
    const anchor = toFlightAnchor(
      flightRow({ tripId: "trip-a", trip }),
      NO_CATALOGUE,
      WINDOW,
      "trip-a"
    );
    expect(anchor).toMatchObject({ defaultAssign: true, locked: true });
  });

  it("locks nothing for a new trip", () => {
    const anchor = toFlightAnchor(
      flightRow({ tripId: "trip-a", trip }),
      NO_CATALOGUE,
      WINDOW,
      null
    );
    expect(anchor).toMatchObject({ defaultAssign: false, locked: false });
  });
});
