import { flownCountries, type VisitableFlight } from "../flightVisits";

/**
 * The rule's own cases, with no logbook in them.
 *
 * The shape being fixed: a trip that flew out of one country, changed planes in
 * another and stayed in a third used to read as three countries, because both
 * ends of every leg counted. These fixtures pin what it reads as now — and the
 * last two pin the two ways a blunt rule goes wrong: it would erase a trip that
 * never leaves its own country, and it would erase a trip that ends somewhere
 * other than where it started.
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

/** A leg, with the times a real one carries. */
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
  it("counts the country stayed in, not the one flown out of or changed planes in", () => {
    // Home -> Türkiye (same-day plane change) -> Pakistan, six nights, back the
    // same way. Canada is only ever departed from and returned to; Türkiye is
    // only ever a tarmac on the same day.
    const countries = flownCountries(
      [
        leg("YYZ", "IST", "2025-11-26T18:00:00Z", "2025-11-27T06:00:00Z"),
        leg("IST", "KHI", "2025-11-27T09:00:00Z", "2025-11-27T17:00:00Z"),
        leg("KHI", "IST", "2025-12-03T20:00:00Z", "2025-12-04T02:00:00Z"),
        leg("IST", "YYZ", "2025-12-04T05:00:00Z", "2025-12-04T14:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["PK"]);
  });

  it("keeps the country a trip never leaves", () => {
    // Out and back inside one country: its only segment is also its origin, and
    // dropping that would erase the entire trip.
    const countries = flownCountries(
      [
        leg("YYZ", "YYT", "2026-06-13T09:00:00Z", "2026-06-13T12:00:00Z"),
        leg("YYT", "YYZ", "2026-06-22T10:00:00Z", "2026-06-22T13:00:00Z"),
      ],
      facts
    );

    expect(countries).toEqual(["CA"]);
  });

  it("counts where a one-way trip ends, because the trip ended there", () => {
    const countries = flownCountries(
      [
        leg("YYZ", "EWR", "2024-10-27T08:00:00Z", "2024-10-27T10:00:00Z"),
        leg("EWR", "AUA", "2024-10-27T12:00:00Z", "2024-10-27T16:00:00Z"),
      ],
      facts
    );

    // The United States was a same-day plane change, so it drops; Aruba is
    // where the legs run out. The origin is not in the list.
    expect(countries).toEqual(["AW"]);
  });

  it("drops a country reached and left on the same day, and keeps one with a night", () => {
    const sameDay = flownCountries(
      [
        leg("YYZ", "EWR", "2024-10-27T08:00:00Z", "2024-10-27T10:00:00Z"),
        leg("EWR", "YYZ", "2024-10-27T22:00:00Z", "2024-10-28T00:00:00Z"),
      ],
      facts
    );
    // Nothing was slept in: the arrival and the departure share a calendar day.
    expect(sameDay).toEqual([]);

    const overnight = flownCountries(
      [
        leg("YYZ", "EWR", "2024-10-27T08:00:00Z", "2024-10-27T10:00:00Z"),
        leg("EWR", "YYZ", "2024-10-28T22:00:00Z", "2024-10-29T00:00:00Z"),
      ],
      facts
    );
    expect(overnight).toEqual(["US"]);
  });

  it("still counts a stay whose legs carry no times, rather than erasing it", () => {
    // Imported rows often have dates only. "Arrived and later left" is evidence
    // on its own, and the alternative is silently dropping a country.
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

  it("does not depend on the order the caller hands the legs in", () => {
    const legs = [
      leg("YYZ", "IST", "2025-11-26T18:00:00Z", "2025-11-27T06:00:00Z"),
      leg("IST", "KHI", "2025-11-27T09:00:00Z", "2025-11-27T17:00:00Z"),
      leg("KHI", "IST", "2025-12-03T20:00:00Z", "2025-12-04T02:00:00Z"),
      leg("IST", "YYZ", "2025-12-04T05:00:00Z", "2025-12-04T14:00:00Z"),
    ];

    expect(flownCountries([...legs].reverse(), facts)).toEqual(flownCountries(legs, facts));
    expect(flownCountries(legs, facts)).toEqual(["PK"]);
  });

  it("returns each country once, however often the trip comes back to it", () => {
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
