import {
  entrySpanDays,
  journeySpanDays,
  withJourneySpan,
  type JourneyFlightRow,
} from "../journeySpan";

/**
 * A journey's effective span (owner 2026-10-13): the stored `startDay`/
 * `endDay` where the trip has them, the entries' own days on the sides where it
 * does not — the journey-level mirror of the roadtrip's `spanOf`. Verified live:
 * a flight-only journey (NYC 2020) had `startDay`/`endDay` NULL and no
 * roadtrips, so its Dates cell, timeline and edit form had nothing while its
 * flights carried the real days.
 *
 * The entries rule is the one the web already used for the form's "use entry
 * dates" suggestion (`frontend/src/lib/tripEntrySpan.ts`): flights, cruises and
 * stays, a cancelled entry never counted, a one-ended entry standing for its
 * single day, and a flight read on the clock at its own airport. It lives here
 * now so the server serves ONE answer every surface reads.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A flight row, as narrow selects and full rows both carry it. */
const flight = (over: Partial<JourneyFlightRow> = {}) => ({
  departureTime: null as Date | null,
  arrivalTime: null as Date | null,
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  depTimezone: null as string | null,
  arrTimezone: null as string | null,
  status: "flown",
  ...over,
});

describe("entrySpanDays — the days a journey's own entries cover", () => {
  it("abstains when no entry carries a day", () => {
    expect(entrySpanDays({})).toBeNull();
    expect(entrySpanDays({ flights: [flight()], cruises: [], lodgingStays: [] })).toBeNull();
    // A flight whose departure day is unknown contributes nothing, even with
    // an arrival stored.
    expect(
      entrySpanDays({
        flights: [flight({ arrivalTime: new Date("2031-05-02T10:00:00Z") })],
      })
    ).toBeNull();
  });

  it("spans the earliest departure day to the latest arrival day across flights, cruises and stays", () => {
    expect(
      entrySpanDays({
        flights: [
          flight({
            departureTime: new Date("2031-05-02T08:00:00Z"),
            arrivalTime: new Date("2031-05-02T11:00:00Z"),
            depTimezone: "UTC",
            arrTimezone: "UTC",
          }),
        ],
        cruises: [{ startDate: d("2031-05-03"), endDate: d("2031-05-10"), status: "completed" }],
        lodgingStays: [
          { checkIn: d("2031-05-01"), checkOut: d("2031-05-03"), status: "completed" },
        ],
      })
    ).toEqual({
      start: { date: "2031-05-01", zone: null, precision: "day" },
      end: { date: "2031-05-10", zone: null, precision: "day" },
    });
  });

  it("reads a flight's day on the clock at its own airport, and carries that zone", () => {
    // 23:30 in New York is 03:30 UTC the next day; the journey starts that evening.
    expect(
      entrySpanDays({
        flights: [
          flight({
            departureTime: new Date("2025-05-02T03:30:00Z"),
            depTimezone: "America/New_York",
            arrivalTime: new Date("2025-05-02T15:00:00Z"),
            arrTimezone: "Europe/Berlin",
          }),
        ],
      })
    ).toEqual({
      start: { date: "2025-05-01", zone: "America/New_York", precision: "day" },
      end: { date: "2025-05-02", zone: "Europe/Berlin", precision: "day" },
    });
  });

  it("lets a one-ended entry count as a single day, and ignores cancelled ones", () => {
    expect(
      entrySpanDays({
        flights: [flight({ departureTime: new Date("2031-01-01T08:00:00Z"), status: "cancelled" })],
        cruises: [{ startDate: d("2031-06-05"), endDate: null, status: "completed" }],
        lodgingStays: [
          { checkIn: null, checkOut: d("2031-06-04"), status: "completed" },
          { checkIn: d("2031-07-01"), checkOut: d("2031-07-09"), status: "cancelled" },
        ],
      })
    ).toEqual({
      start: { date: "2031-06-04", zone: null, precision: "day" },
      end: { date: "2031-06-05", zone: null, precision: "day" },
    });
  });

  it("falls a flight's missing arrival back to its departure day", () => {
    expect(
      entrySpanDays({
        flights: [
          flight({
            departureTime: new Date("2031-05-02T08:00:00Z"),
            depTimezone: "UTC",
            arrTimezone: null,
          }),
        ],
      })
    ).toEqual({
      start: { date: "2031-05-02", zone: "UTC", precision: "day" },
      end: { date: "2031-05-02", zone: "UTC", precision: "day" },
    });
  });
});

describe("journeySpanDays — stored days win their side, the entries answer the rest", () => {
  const stored = {
    startDate: d("2031-05-02"),
    endDate: d("2031-05-09"),
    startDay: null,
    endDay: null,
    startZone: null,
    endZone: null,
  };

  it("derives both sides from the entries when nothing is stored", () => {
    const span = journeySpanDays({
      ...stored,
      startDate: null,
      endDate: null,
      flights: [
        flight({
          departureTime: new Date("2031-05-02T08:00:00Z"),
          depTimezone: "UTC",
          arrivalTime: new Date("2031-05-06T18:00:00Z"),
          arrTimezone: "UTC",
        }),
      ],
    });
    expect(span).toEqual({
      start: { date: "2031-05-02", zone: "UTC", precision: "day" },
      end: { date: "2031-05-06", zone: "UTC", precision: "day" },
    });
  });

  it("derives each stored-null side on its own and keeps the stored side untouched", () => {
    const span = journeySpanDays({
      ...stored,
      endDate: null,
      flights: [
        flight({
          departureTime: new Date("2031-05-01T08:00:00Z"),
          depTimezone: "UTC",
          arrivalTime: new Date("2031-05-06T18:00:00Z"),
          arrTimezone: "UTC",
        }),
      ],
    });
    expect(span.start).toEqual({ date: "2031-05-02", zone: null, precision: "day" });
    expect(span.end).toEqual({ date: "2031-05-06", zone: "UTC", precision: "day" });
  });

  it("answers null on both sides with neither stored days nor entries", () => {
    expect(journeySpanDays({ ...stored, startDate: null, endDate: null })).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("withJourneySpan — what the trip DTO serves", () => {
  it("serves the derived days as the DATE anchors and the times, without touching the row", () => {
    const row = {
      startDate: null as Date | null,
      endDate: null as Date | null,
      startDay: null as Date | null,
      endDay: null as Date | null,
      startZone: null as string | null,
      endZone: null as string | null,
      flights: [
        flight({
          departureTime: new Date("2025-05-02T03:30:00Z"),
          depTimezone: "America/New_York",
          arrivalTime: new Date("2025-05-02T15:00:00Z"),
          arrTimezone: "Europe/Berlin",
        }),
      ],
      times: { start: null, end: null },
    };
    const served = withJourneySpan(row);
    expect(served.startDate?.toISOString()).toBe("2025-05-01T00:00:00.000Z");
    expect(served.endDate?.toISOString()).toBe("2025-05-02T00:00:00.000Z");
    expect(served.times).toEqual({
      start: { date: "2025-05-01", zone: "America/New_York", precision: "day" },
      end: { date: "2025-05-02", zone: "Europe/Berlin", precision: "day" },
    });
  });

  it("leaves a stored span byte-identical, anchors and zones included", () => {
    const row = {
      startDate: new Date("2031-05-02T22:00:00Z"),
      endDate: new Date("2031-05-09T00:00:00Z"),
      startDay: d("2031-05-03"),
      endDay: d("2031-05-09"),
      startZone: "Asia/Tokyo",
      endZone: null,
      flights: [
        flight({
          departureTime: new Date("2031-04-01T08:00:00Z"),
          depTimezone: "UTC",
          arrivalTime: new Date("2031-04-02T18:00:00Z"),
          arrTimezone: "UTC",
        }),
      ],
      times: {
        start: { date: "2031-05-03", zone: "Asia/Tokyo", precision: "day" },
        end: { date: "2031-05-09", zone: null, precision: "day" },
      },
    };
    const served = withJourneySpan(row);
    expect(served.startDate).toBe(row.startDate);
    expect(served.endDate).toBe(row.endDate);
    expect(served.times).toEqual(row.times);
  });

  it("does not write anything into the row it derives from", () => {
    const row = {
      startDate: null as Date | null,
      endDate: null as Date | null,
      startDay: null as Date | null,
      endDay: null as Date | null,
      startZone: null as string | null,
      endZone: null as string | null,
      flights: [
        flight({
          departureTime: new Date("2031-05-02T08:00:00Z"),
          depTimezone: "UTC",
          arrivalTime: new Date("2031-05-03T08:00:00Z"),
          arrTimezone: "UTC",
        }),
      ],
      times: { start: null, end: null },
    };
    withJourneySpan(row);
    expect(row.startDate).toBeNull();
    expect(row.endDate).toBeNull();
    expect(row.startDay).toBeNull();
    expect(row.endDay).toBeNull();
  });
});
