import { spanOf, type StationRow } from "../roadtripSummary";

/**
 * The span a roadtrip covers (owner 2026-10-13): its OWN stored days where it
 * has them, the stations' derivation on the sides where it does not. The rule
 * is PER SIDE — a trip that set only a start keeps the derived end — and with
 * neither stored day set the derivation is byte-identical to what every
 * existing trip already showed.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function station(over: Partial<StationRow> & Pick<StationRow, "id">): StationRow {
  return {
    title: over.id,
    lat: null,
    lon: null,
    startDate: null,
    endDate: null,
    startUtc: null,
    endUtc: null,
    stopZone: null,
    notes: null,
    routeOrderIdx: 0,
    overnight: false,
    viaPoint: false,
    placeId: null,
    place: null,
    lodgingStayId: null,
    lodgingStay: null,
    ...over,
  };
}

/** One derived stop, five days, with a stay whose check-in precedes it. */
const stops: StationRow[] = [
  station({ id: "a", startDate: d("2031-05-02"), endDate: d("2031-05-03") }),
  station({ id: "b", startDate: d("2031-05-04"), endDate: d("2031-05-06") }),
];

describe("spanOf with a trip's own days", () => {
  it("keeps today's derivation when neither stored day is set", () => {
    expect(spanOf(stops)).toEqual({
      startDate: "2031-05-02T00:00:00.000Z",
      endDate: "2031-05-06T00:00:00.000Z",
    });
    expect(spanOf(stops, { startDay: null, endDay: null })).toEqual({
      startDate: "2031-05-02T00:00:00.000Z",
      endDate: "2031-05-06T00:00:00.000Z",
    });
  });

  it("lets a stored day win over the stations on its side", () => {
    const span = spanOf(stops, { startDay: d("2031-05-05"), endDay: d("2031-05-09") });
    expect(span).toEqual({
      startDate: "2031-05-05T00:00:00.000Z",
      endDate: "2031-05-09T00:00:00.000Z",
    });
  });

  it("falls back per side: a stored start keeps the stations' end", () => {
    expect(spanOf(stops, { startDay: d("2031-05-05"), endDay: null })).toEqual({
      startDate: "2031-05-05T00:00:00.000Z",
      endDate: "2031-05-06T00:00:00.000Z",
    });
  });

  it("falls back per side: a stored end keeps the stations' start", () => {
    expect(spanOf(stops, { startDay: null, endDay: d("2031-05-01") })).toEqual({
      startDate: "2031-05-02T00:00:00.000Z",
      endDate: "2031-05-01T00:00:00.000Z",
    });
  });

  it("still takes a linked stay's dates where a station has none, and still abstains on null", () => {
    const viaStay = [
      station({
        id: "c",
        lodgingStayId: "stay-1",
        lodgingStay: {
          id: "stay-1",
          lodgingId: "l-1",
          checkIn: d("2031-04-28"),
          checkOut: d("2031-04-30"),
          checkInDate: null,
          checkOutDate: null,
          checkInAt: null,
          checkOutAt: null,
          stayZone: null,
          datePrecision: "day",
          nights: null,
          status: "confirmed",
          freeCancellationUntil: null,
          freeCancellationOn: null,
          freeCancellationZone: null,
          paymentDueOn: null,
          lodging: {
            id: "l-1",
            name: "Kelmore Camp",
            type: "campsite",
            city: null,
            country: null,
            isoCountryCode: null,
          },
        },
      }),
      station({ id: "via", viaPoint: true, startDate: d("2031-03-01") }),
    ];
    expect(spanOf(viaStay)).toEqual({
      startDate: "2031-04-28T00:00:00.000Z",
      endDate: "2031-04-30T00:00:00.000Z",
    });
    // A stored start with no stations at all still answers just its own side.
    expect(spanOf([], { startDay: d("2031-06-01"), endDay: null })).toEqual({
      startDate: "2031-06-01T00:00:00.000Z",
      endDate: null,
    });
  });
});
