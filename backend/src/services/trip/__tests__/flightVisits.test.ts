import { flownCountries, type VisitableFlight } from "../flightVisits";

/**
 * The rule's own cases, with no logbook in them.
 *
 * The shape being fixed: a trip that flew out of one country and changed planes
 * in another used to count the country it left from — "we only flew out of
 * there" — while the owner counts the plane change itself as a place he was in
 * ("Istanbul shoild count"). So the cases below pin what counts and what does
 * not: the start never, a layover always, and a trip that never leaves its own
 * country must not be erased by a rule about leaving.
 */

const facts = new Map(
  [
    ["YYZ", "CA"], // home
    ["YYT", "CA"],
    ["IST", "TR"],
    ["KHI", "PK"],
    ["EWR", "US"],
    ["AUA", "AW"],
  ].map(([iata, country]) => [iata, { country }])
);

/** A leg, with the clock a real one carries. */
function leg(
  depIata: string,
  arrIata: string,
  departsAt: string,
  arrivesAt: string
): VisitableFlight {
  return {
    depIata,
    arrIata,
    departureTime: new Date(departsAt),
    arrivalTime: new Date(arrivesAt),
  };
}

describe("flownCountries", () => {
  it("counts the layover, drops the country the trip started in", () => {
    // Home -> Türkiye -> Pakistan and back the same way. Canada is only ever
    // departed from and returned to; Türkiye is a plane change, and a plane
    // change is somewhere the trip was.
    const countries = flownCountries(
      [
        leg("YYZ", "IST", "2025-11-26T18:00:00Z", "2025-11-27T06:00:00Z"),
        leg("IST", "KHI", "2025-11-27T09:00:00Z", "2025-11-27T17:00:00Z"),
        leg("KHI", "IST", "2025-12-03T20:00:00Z", "2025-12-04T02:00:00Z"),
        leg("IST", "YYZ", "2025-12-04T05:00:00Z", "2025-12-04T14:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["PK", "TR"]);
  });

  it("keeps a trip that never leaves the country it started in", () => {
    // Out and back inside one country: the origin is all the trip touched, and
    // dropping it would leave the card with no countries and no flags at all.
    const countries = flownCountries(
      [
        leg("YYZ", "YYT", "2026-06-13T09:00:00Z", "2026-06-13T12:00:00Z"),
        leg("YYT", "YYZ", "2026-06-22T10:00:00Z", "2026-06-22T13:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["CA"]);
  });

  it("drops a start it returns to, and keeps everything in between", () => {
    const countries = flownCountries(
      [
        leg("YYZ", "EWR", "2024-10-27T08:00:00Z", "2024-10-27T10:00:00Z"),
        leg("EWR", "AUA", "2024-10-27T12:00:00Z", "2024-10-27T16:00:00Z"),
        leg("AUA", "EWR", "2024-10-28T12:00:00Z", "2024-10-28T16:00:00Z"),
        leg("EWR", "YYZ", "2024-10-28T20:00:00Z", "2024-10-28T22:00:00Z"),
      ],
      facts
    );

    // The plane-change country counts; the country departed from does not.
    expect(countries).toEqual(["AW", "US"]);
  });

  it("keeps the country a one-way trip ended in, because the end differs from the start", () => {
    const countries = flownCountries(
      [
        leg("YYZ", "IST", "2019-01-04T18:00:00Z", "2019-01-05T08:00:00Z"),
        leg("IST", "KHI", "2019-01-05T12:00:00Z", "2019-01-05T20:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["PK", "TR"]);
  });

  it("ignores the start wherever it appears, including mid-trip", () => {
    // A connection at home is still the country the trip started in, so it does
    // not become a visited country by being touched again.
    const countries = flownCountries(
      [
        leg("YYZ", "EWR", "2024-05-01T08:00:00Z", "2024-05-01T10:00:00Z"),
        leg("EWR", "YYZ", "2024-05-04T08:00:00Z", "2024-05-04T10:00:00Z"),
        leg("YYZ", "AUA", "2024-05-04T14:00:00Z", "2024-05-04T20:00:00Z"),
        leg("AUA", "YYZ", "2024-05-10T14:00:00Z", "2024-05-10T20:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["AW", "US"]);
  });

  it("does not depend on the order the caller hands the legs in", () => {
    const legs = [
      leg("YYZ", "IST", "2025-11-26T18:00:00Z", "2025-11-27T06:00:00Z"),
      leg("IST", "KHI", "2025-11-27T09:00:00Z", "2025-11-27T17:00:00Z"),
      leg("KHI", "IST", "2025-12-03T20:00:00Z", "2025-12-04T02:00:00Z"),
      leg("IST", "YYZ", "2025-12-04T05:00:00Z", "2025-12-04T14:00:00Z"),
    ];

    expect(flownCountries([...legs].reverse(), facts)).toEqual(flownCountries(legs, facts));
    expect(flownCountries(legs, facts)).toEqual(["PK", "TR"]);
  });

  it("still reads a trip whose legs carry no times, rather than erasing it", () => {
    // Imported rows often have dates only. The start is then simply the first
    // leg the caller hands over, which is the order the logbook shows.
    const countries = flownCountries(
      [
        { depIata: "YYZ", arrIata: "KHI" },
        { depIata: "KHI", arrIata: "YYZ" },
      ],
      facts
    );

    expect(countries).toEqual(["PK"]);
  });

  it("says nothing when it cannot place an airport, and nothing at all with no legs", () => {
    expect(flownCountries([], facts)).toEqual([]);
    expect(
      flownCountries(
        [
          { depIata: "ZZZ", arrIata: null, departureTime: null, arrivalTime: null },
          { depIata: null, arrIata: "QQQ", departureTime: null, arrivalTime: null },
        ],
        facts
      )
    ).toEqual([]);
  });

  it("returns each country once, however often the trip touches it", () => {
    const countries = flownCountries(
      [
        leg("YYZ", "EWR", "2024-10-27T08:00:00Z", "2024-10-27T10:00:00Z"),
        leg("EWR", "AUA", "2024-10-28T12:00:00Z", "2024-10-28T16:00:00Z"),
        leg("AUA", "EWR", "2024-11-02T12:00:00Z", "2024-11-02T16:00:00Z"),
        leg("EWR", "YYZ", "2024-11-03T12:00:00Z", "2024-11-03T14:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["AW", "US"]);
  });
});
