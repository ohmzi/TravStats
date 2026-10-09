import { describe, expect, it } from "vitest";

import { RECONCILER_MARKER, parseReconcilerNote, readTripReconciliation } from "../reconcilerNote";
import type { TripExpense } from "../../types/expense";

const TRIP = "6f1c1c3e-2b8e-4a55-9a51-0d6f1e6b2a10";

/** The contract's example block; each test overrides what it is about. */
const block = (over: Record<string, unknown> = {}) => ({
  cats: [
    ["Dining", "61240"],
    ["Transit", "12000"],
  ],
  cur: "CAD",
  guesses: 3,
  idle: [],
  latestUsdCad: 1.3712,
  native: "100000",
  priced: { atDate: { CAD: "98000", USD: "71500" }, native: { CAD: "98000" } },
  receipts: { estimate: 0, pending: 0, review: 1 },
  spend: {
    atDate: { CAD: "123456", USD: "90012" },
    native: { CAD: "100000", USD: "17000" },
  },
  state: "verified",
  through: "2026-11-30",
  unconverted: 0,
  v: 1,
  ...over,
});

const note = (cur: string, data: unknown, trip = TRIP): string =>
  `${RECONCILER_MARKER}trip=${trip} cur=${cur}] Paid from your accounts, matched by the reconciler.\n#data ${
    typeof data === "string" ? data : JSON.stringify(data)
  }`;

const expense = (over: Partial<TripExpense>): TripExpense => ({
  id: Math.random().toString(36).slice(2),
  tripId: TRIP,
  routeId: null,
  stopId: null,
  legFromStopId: null,
  legToStopId: null,
  kind: "other",
  amount: 1000,
  currency: "CAD",
  date: null,
  note: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("parseReconcilerNote", () => {
  it("reads the marker and the #data block, with amounts as integer minor units", () => {
    const parsed = parseReconcilerNote(note("CAD", block()));
    expect(parsed).toMatchObject({ tripId: TRIP, currency: "CAD" });
    expect(parsed?.data).toMatchObject({
      state: "verified",
      through: "2026-11-30",
      native: 100000,
      spend: { atDate: { CAD: 123456, USD: 90012 }, native: { CAD: 100000, USD: 17000 } },
      priced: { atDate: { CAD: 98000, USD: 71500 }, native: { CAD: 98000 } },
      cats: [
        ["Dining", 61240],
        ["Transit", 12000],
      ],
      receipts: { estimate: 0, pending: 0, review: 1 },
      guesses: 3,
      latestUsdCad: 1.3712,
    });
  });

  it("is not a reconciler note without the marker", () => {
    expect(parseReconcilerNote("Ferry to the island")).toBeNull();
    expect(parseReconcilerNote(null)).toBeNull();
    expect(parseReconcilerNote("[trip-reconciler v2 trip=x cur=CAD] later format")).toBeNull();
  });

  it("keeps a null at-date sum and a null verified-through day as null", () => {
    const parsed = parseReconcilerNote(
      note(
        "CAD",
        block({
          through: null,
          spend: { atDate: { CAD: "123456", USD: null }, native: { CAD: "100000" } },
        })
      )
    );
    expect(parsed?.data?.spend.atDate).toEqual({ CAD: 123456, USD: null });
    expect(parsed?.data?.through).toBeNull();
  });

  it("defaults the informational counters, but never the money", () => {
    const { cats: _c, receipts: _r, guesses: _g, unconverted: _u, ...bare } = block();
    expect(parseReconcilerNote(note("CAD", bare))?.data).toMatchObject({
      cats: [],
      receipts: { estimate: 0, pending: 0, review: 0 },
      guesses: 0,
      unconverted: 0,
    });
    const { spend: _s, ...noSpend } = block();
    expect(parseReconcilerNote(note("CAD", noSpend))?.data).toBeNull();
  });

  it.each([
    ["broken JSON", '{"v":1,'],
    ["a float where minor units belong", block({ native: "1000.50" })],
    ["a number where a decimal string belongs", block({ native: 100000 })],
    ["an unknown state", block({ state: "settled" })],
    ["an amount past the safe-integer range", block({ native: "9007199254740993" })],
    ["a non-day `through`", block({ through: "30.11.2026" })],
  ])("reads a block with %s as no block, keeping the marker", (_label, data) => {
    const parsed = parseReconcilerNote(note("CAD", data));
    expect(parsed).toMatchObject({ tripId: TRIP, currency: "CAD", data: null });
  });

  it("reads a marker with no #data line as no block", () => {
    expect(
      parseReconcilerNote(`${RECONCILER_MARKER}trip=${TRIP} cur=USD] Just a sentence.`)
    ).toMatchObject({ currency: "USD", data: null });
  });
});

describe("readTripReconciliation", () => {
  it("is null for a trip the reconciler never booked on", () => {
    expect(readTripReconciliation([expense({ note: "Toll" })], TRIP)).toBeNull();
    expect(readTripReconciliation([], TRIP)).toBeNull();
  });

  it("ignores a marker row on a section, on another trip, or naming another trip", () => {
    const rows = [
      expense({ tripId: null, routeId: "r1", note: note("CAD", block()) }),
      expense({ tripId: "other-trip", note: note("CAD", block()) }),
      expense({ note: note("CAD", block(), "11111111-1111-1111-1111-111111111111") }),
    ];
    expect(readTripReconciliation(rows, TRIP)).toBeNull();
  });

  it("reads the trip-level fields from the CAD row when there are several currencies", () => {
    const rows = [
      expense({
        currency: "USD",
        amount: 170,
        note: note("USD", block({ cur: "USD", native: "17000", guesses: 9 })),
      }),
      expense({ currency: "CAD", note: note("CAD", block({ guesses: 3 })) }),
    ];
    const result = readTripReconciliation(rows, TRIP);
    expect(result?.rowCount).toBe(2);
    expect(result?.data?.guesses).toBe(3);
    expect(result?.figures.spend.native).toEqual({ CAD: 100000, USD: 17000 });
    expect(result?.figures.latestUsdCad).toBe(1.3712);
  });

  it("takes the first readable row when no CAD row is readable", () => {
    const rows = [
      expense({ currency: "CAD", note: note("CAD", "not json") }),
      expense({
        currency: "USD",
        amount: 170,
        note: note("USD", block({ cur: "USD", native: "17000", guesses: 9 })),
      }),
    ];
    const result = readTripReconciliation(rows, TRIP);
    expect(result?.data?.guesses).toBe(9);
    expect(result?.malformedRows).toBe(1);
  });

  it("completes the per-currency spend from a row the trip-level map does not name", () => {
    const rows = [
      expense({ note: note("CAD", block()) }),
      expense({
        currency: "EUR",
        amount: 50,
        note: note("EUR", block({ cur: "EUR", native: "5000" })),
      }),
    ];
    expect(readTripReconciliation(rows, TRIP)?.figures.spend.native).toEqual({
      CAD: 100000,
      USD: 17000,
      EUR: 5000,
    });
  });

  it("falls back to each row's own amount and currency when no block can be read", () => {
    const rows = [
      expense({ currency: "CAD", amount: 1234.56, note: note("CAD", "{broken") }),
      expense({ currency: "JPY", amount: 15000, note: note("JPY", '{"v":2}') }),
    ];
    const result = readTripReconciliation(rows, TRIP);
    expect(result?.data).toBeNull();
    expect(result?.malformedRows).toBe(2);
    // JPY has no minor unit, so 15000 yen are 15000 minor units.
    expect(result?.figures.spend.native).toEqual({ CAD: 123456, JPY: 15000 });
    expect(result?.figures.spend.atDate).toEqual({ CAD: null, USD: null });
    expect(result?.figures.priced).toBeNull();
  });
});
