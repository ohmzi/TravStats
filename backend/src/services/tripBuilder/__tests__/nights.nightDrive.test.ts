import { attributeNights } from "../nights";
import type { FlightAnchor } from "../types";
import {
  area,
  flight,
  KELMORE,
  KEY_KELMORE,
  KEY_NORTHVALE,
  KEY_EASTMERE,
  leg,
  nightInputs,
  NORTHVALE,
  photo,
  preciseFlight,
  EASTMERE,
  ROADSIDE,
  station,
  type Place,
} from "./nightsFixtures";

// Synthetic fixtures only (public repository): invented towns, shifted years.

/**
 * One drive in one area: Northvale on the 2nd, then a photo at `to` the next
 * morning (and a last one that evening). `leave` and `arrive` are the times of
 * the evening photo at Northvale and the first photo at `to`.
 */
function drive(
  leave: string,
  arrive: string,
  to: Place = EASTMERE,
  legMode: "road" | "ferry" = "road"
) {
  const arrivalDay = arrive.slice(0, 10);
  const trip = area({
    startDay: "2031-05-02",
    endDay: arrivalDay,
    stations: [
      station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
      station(KEY_EASTMERE, "Eastmere", to, arrivalDay, arrivalDay),
    ],
    photos: [
      photo("a1", "2031-05-02 10:00", NORTHVALE),
      photo("a2", leave, NORTHVALE),
      photo("b1", arrive, to),
      photo("b2", `${arrivalDay} 20:00`, to),
    ],
    placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE, b1: KEY_EASTMERE, b2: KEY_EASTMERE },
    legs: [leg(KEY_NORTHVALE, KEY_EASTMERE, legMode)],
  });
  return attributeNights(nightInputs("2031-05-02", "2031-05-04", [trip]));
}

/**
 * The 19:10 evening photo at Northvale and the 07:30 morning one at Eastmere,
 * both in ONE area, with whatever flights `anchors` lists. Only the take-off
 * times can come between the photos. `afterFlightId` names the flight that
 * opened the area, which keeps the landing rule from answering for it.
 */
function oneAreaDrive(anchors: FlightAnchor[], afterFlightId?: string) {
  const trip = area({
    startDay: "2031-05-02",
    endDay: "2031-05-03",
    stations: [
      station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
      station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-03", "2031-05-03"),
    ],
    photos: [
      photo("a1", "2031-05-02 19:10", NORTHVALE),
      photo("b1", "2031-05-03 07:30", EASTMERE),
      photo("b2", "2031-05-03 20:00", EASTMERE),
    ],
    placeOf: { a1: KEY_NORTHVALE, b1: KEY_EASTMERE, b2: KEY_EASTMERE },
    afterFlightId,
  });
  return attributeNights(nightInputs("2031-05-02", "2031-05-04", [trip], { anchors }));
}

describe("attributeNights: a night drive", () => {
  it("gives the night to the station driven toward after a long evening-to-morning drive", () => {
    const { nights } = drive("2031-05-02 19:10", "2031-05-03 07:30");

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_EASTMERE,
      reason: "nightDrive",
      suggestedStationKeys: [],
    });
  });

  it("counts a drive that arrives at 02:53 as that night's last photo, by the 04:00 boundary", () => {
    // The 02:53 photo is taken on the 3rd but belongs to the night of the 2nd,
    // so it IS the night's last photo and the night is simply spent there.
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-02", "2031-05-03"),
      ],
      photos: [
        photo("a1", "2031-05-02 19:10", NORTHVALE),
        photo("b1", "2031-05-03 02:53", EASTMERE),
        photo("b2", "2031-05-03 09:30", EASTMERE),
      ],
      placeOf: { a1: KEY_NORTHVALE, b1: KEY_EASTMERE, b2: KEY_EASTMERE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [trip]));

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_EASTMERE,
      reason: "lastPhoto",
      suggestedStationKeys: [],
    });
  });

  it("counts a 01:30 departure as the end of the evening: 00:00-03:59 reads as 24:00-27:59", () => {
    // The 01:30 photo is taken on the 3rd but belongs to the night of the 2nd. On
    // that night's clock it is 25:30, so it is an evening departure; read as a
    // plain 01:30 it would fall before 18:00 and the drive would not count.
    const { nights } = drive("2031-05-03 01:30", "2031-05-03 07:00");

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_EASTMERE,
      reason: "nightDrive",
      suggestedStationKeys: [],
    });
  });

  it("starts the evening at 18:00 sharp", () => {
    expect(drive("2031-05-02 18:00", "2031-05-03 07:30").nights["2031-05-02"].reason).toBe(
      "nightDrive"
    );
    expect(drive("2031-05-02 17:59", "2031-05-03 07:30").nights["2031-05-02"].reason).toBe(
      "lastPhoto"
    );
  });

  it("ends the morning at 09:00 sharp", () => {
    expect(drive("2031-05-02 19:10", "2031-05-03 08:59").nights["2031-05-02"].reason).toBe(
      "nightDrive"
    );
    const late = drive("2031-05-02 19:10", "2031-05-03 09:00").nights["2031-05-02"];
    expect([late.assign, late.reason]).toEqual([KEY_NORTHVALE, "lastPhoto"]);
  });

  it("needs the two photos to be 150 km apart", () => {
    // The roadside is 110 km from Northvale.
    const { nights } = drive("2031-05-02 19:10", "2031-05-03 07:30", ROADSIDE);

    expect([nights["2031-05-02"].assign, nights["2031-05-02"].reason]).toEqual([
      KEY_NORTHVALE,
      "lastPhoto",
    ]);
  });

  it("does not drive through a flight: another area is a flight away", () => {
    const first = area({
      startDay: "2031-05-02",
      endDay: "2031-05-02",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02")],
      photos: [photo("a1", "2031-05-02 22:00", NORTHVALE)],
      placeOf: { a1: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const second = area({
      startDay: "2031-05-03",
      endDay: "2031-05-03",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-03", "2031-05-03")],
      photos: [photo("b1", "2031-05-03 07:30", EASTMERE)],
      placeOf: { b1: KEY_EASTMERE },
      afterFlightId: "f1",
    });
    // An early flight on the 3rd, recorded by day only.
    const early = flight("f1", { depDay: "2031-05-03", arrDay: "2031-05-03" });

    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-04", [first, second], { anchors: [early] })
    );

    expect([nights["2031-05-02"].assign, nights["2031-05-02"].reason]).toEqual([
      KEY_NORTHVALE,
      "lastPhoto",
    ]);
  });

  it("does not drive through a flight inside one area: a precise take-off between the two photos", () => {
    // Northvale at 19:10 on the 2nd, Eastmere at 07:30 on the 3rd, one area. The
    // flight takes off at 02:00 on the 3rd, between them, and lands after 04:00,
    // so it is airborne at no midnight and lands in the night of the 3rd.
    const hop = preciseFlight("f1", "2031-05-03 02:00", "2031-05-03 05:30");

    const { nights } = oneAreaDrive([hop]);

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "lastPhoto",
      suggestedStationKeys: [],
    });
  });

  it("is not stopped by a take-off after the second photo", () => {
    // The same drive, but the flight takes off at 12:00 on the 3rd, after the
    // drive has arrived: nothing lies between the two photos.
    const later = preciseFlight("f1", "2031-05-03 12:00", "2031-05-03 15:30");

    const { nights } = oneAreaDrive([later]);

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_EASTMERE,
      reason: "nightDrive",
      suggestedStationKeys: [],
    });
  });

  it("is not stopped by a take-off before the first photo", () => {
    // The flight took off at 10:00 on the 2nd and landed at 12:00, before the
    // 19:10 photo, and the area opens after it: the drive left after the plane.
    const earlier = preciseFlight("f1", "2031-05-02 10:00", "2031-05-02 12:00");

    const { nights } = oneAreaDrive([earlier], "f1");

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_EASTMERE,
      reason: "nightDrive",
      suggestedStationKeys: [],
    });
  });

  it("gives a drive that ends at home to home", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_KELMORE, "Kelmore", KELMORE, "2031-05-03", "2031-05-03", "home"),
      ],
      photos: [
        photo("a1", "2031-05-02 19:30", NORTHVALE),
        photo("h1", "2031-05-03 07:00", KELMORE),
      ],
      placeOf: { a1: KEY_NORTHVALE, h1: KEY_KELMORE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [trip]));

    expect(nights["2031-05-02"]).toEqual({
      assign: "home",
      reason: "nightDrive",
      suggestedStationKeys: [],
    });
  });

  it("yields to a night spent at home when the evening photo is at home", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_KELMORE, "Kelmore", KELMORE, "2031-05-02", "2031-05-02", "home"),
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-03"),
      ],
      photos: [
        photo("h1", "2031-05-02 19:00", KELMORE),
        photo("a1", "2031-05-03 07:30", NORTHVALE),
      ],
      placeOf: { h1: KEY_KELMORE, a1: KEY_NORTHVALE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [trip]));

    expect([nights["2031-05-02"].assign, nights["2031-05-02"].reason]).toEqual(["home", "home"]);
  });

  it("yields to a ferry leg between the two stations: the boarding station keeps the night", () => {
    const { nights } = drive("2031-05-02 21:00", "2031-05-03 07:00", EASTMERE, "ferry");

    expect([nights["2031-05-02"].assign, nights["2031-05-02"].reason]).toEqual([
      KEY_NORTHVALE,
      "ferry",
    ]);
  });
});
