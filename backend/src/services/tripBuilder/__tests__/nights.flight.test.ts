import { attributeNights } from "../nights";
import {
  area,
  flight,
  KEY_NORTHVALE,
  KEY_EASTMERE,
  nightInputs,
  NORTHVALE,
  photo,
  EASTMERE,
  preciseFlight,
  station,
} from "./nightsFixtures";

// Synthetic fixtures only (public repository): invented towns, flight ZZ101, shifted years.

/** Northvale on the 2nd and 3rd, a flight, then Eastmere on the 4th and 5th. */
function withFlight(f: ReturnType<typeof flight>, lastNorthvalePhoto = "2031-05-03 20:30") {
  const before = area({
    startDay: "2031-05-02",
    endDay: "2031-05-03",
    stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03")],
    photos: [
      photo("a1", "2031-05-02 10:00", NORTHVALE),
      photo("a2", lastNorthvalePhoto, NORTHVALE),
    ],
    placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
    beforeFlightId: f.id,
  });
  const after = area({
    startDay: "2031-05-04",
    endDay: "2031-05-05",
    stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-04", "2031-05-05")],
    photos: [photo("b1", "2031-05-04 10:00", EASTMERE), photo("b2", "2031-05-04 20:00", EASTMERE)],
    placeOf: { b1: KEY_EASTMERE, b2: KEY_EASTMERE },
    afterFlightId: f.id,
  });
  return attributeNights(
    nightInputs("2031-05-02", "2031-05-06", [before, after], { anchors: [f] })
  );
}

describe("attributeNights: a night in the air", () => {
  it("is a flight night when a precise flight is airborne across local midnight", () => {
    const { nights } = withFlight(preciseFlight("f1", "2031-05-03 23:10", "2031-05-04 06:20"));

    expect(nights["2031-05-03"]).toEqual({
      assign: "flight",
      reason: "flight",
      suggestedStationKeys: [],
    });
    // The nights either side keep their photos' stations.
    expect(nights["2031-05-02"].assign).toBe(KEY_NORTHVALE);
    expect(nights["2031-05-04"].assign).toBe(KEY_EASTMERE);
  });

  it("is a flight night for a flight recorded by day only that lands the next day", () => {
    const { nights } = withFlight(flight("f1", { depDay: "2031-05-03", arrDay: "2031-05-04" }));

    expect(nights["2031-05-03"].reason).toBe("flight");
  });

  it("is not a flight night when the flight lands the day it leaves", () => {
    const { nights } = withFlight(
      preciseFlight("f1", "2031-05-03 21:00", "2031-05-03 23:30"),
      "2031-05-03 19:00"
    );

    expect(nights["2031-05-03"].reason).not.toBe("flight");
  });

  it("gives every night between a departure and a landing days later to the flight", () => {
    const f = flight("f1", { depDay: "2031-05-02", arrDay: "2031-05-04" });
    const { nights } = withFlight(f);

    expect([nights["2031-05-02"].reason, nights["2031-05-03"].reason]).toEqual([
      "flight",
      "flight",
    ]);
    expect(nights["2031-05-04"].reason).not.toBe("flight");
  });

  it("reads a precise flight's days from its instants, so a delay past midnight is on the ground", () => {
    // Scheduled for 23:30 on the 3rd, it actually took off at 00:40 on the 4th.
    const delayed = preciseFlight("f1", "2031-05-04 00:40", "2031-05-04 07:00", {
      depDay: "2031-05-03",
      depClock: "23:30",
    });

    const { nights } = withFlight(delayed, "2031-05-04 00:10");

    // The 00:10 photo at the airport still belongs to the evening of the 3rd.
    expect(nights["2031-05-03"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "lastPhoto",
      suggestedStationKeys: [],
    });
  });

  it("reads a precise flight's days on the airports' clocks, not in UTC", () => {
    // 10:00Z to 18:30Z on the 3rd is 22:00 on the 3rd to 06:30 on the 4th in Auckland.
    const overnight = preciseFlight("f1", "2031-05-03 10:00", "2031-05-03 18:30", {
      depZone: "Pacific/Auckland",
      arrZone: "Pacific/Auckland",
    });

    const { nights } = withFlight(overnight, "2031-05-03 09:00");

    expect(nights["2031-05-03"].reason).toBe("flight");
  });

  it("falls back to the recorded days when a precise flight's zone is missing", () => {
    const noZone = preciseFlight("f1", "2031-05-03 23:10", "2031-05-04 06:20", {
      depZone: null,
    });

    const { nights } = withFlight(noZone);

    expect(nights["2031-05-03"].reason).toBe("flight");
  });
});
