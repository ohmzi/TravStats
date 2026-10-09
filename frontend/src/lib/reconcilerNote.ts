import { z } from "zod";

import { minorUnits } from "../shared/currencies";
import type { TripExpense } from "../types/expense";
import type { CurrencyPair, SpendFigures, SpendSums } from "./tripSpendCurrency";

/**
 * Reading what the host trip-reconciler writes into a trip.
 *
 * The reconciler matches the owner's bank and cash transactions to trips and
 * books, per trip and per original currency, ONE trip-wide expense (kind
 * `other`, `tripId` set, `routeId` null) through the public API. TravStats
 * stores it like any other expense; no schema knows about it. What makes the
 * row the reconciler's is its note:
 *
 * ```
 * [trip-reconciler v1 trip=<trip uuid> cur=<CUR>] <one human sentence>
 * #data {"v":1,"cur":"CAD","state":"verified","spend":{…},"priced":{…},…}
 * ```
 *
 * Amounts in `#data` are integer MINOR units written as decimal strings, so
 * no float ever crosses the wire. The trip-level fields (state, through,
 * priced, spend, cats, receipts, guesses, latestUsdCad) are repeated on every
 * row of the trip; they are read from ONE row — the CAD row when it is
 * readable, else the first readable one.
 *
 * A row whose block is missing or does not validate is not thrown away: its
 * own amount and currency still say what was paid in that currency, so the
 * card can show the money even when it cannot convert it.
 */

export const RECONCILER_MARKER = "[trip-reconciler v1 ";

const MARKER_LINE = /^\[trip-reconciler v1 trip=(\S+) cur=([A-Z]{3})\]/;
const DATA_LINE = /^#data\s+(.+)$/m;

/** Minor units: an integer as a decimal string, inside the safe-integer range. */
const minor = z
  .string()
  .regex(/^-?\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger, "beyond the safe-integer range");

const currencyCode = z.string().regex(/^[A-Z]{3}$/);
const count = z.number().int().nonnegative();

/** Null when a rate was missing for some transaction; absent reads the same. */
const atDateSchema = z.object({
  CAD: minor.nullish().transform((v) => v ?? null),
  USD: minor.nullish().transform((v) => v ?? null),
});

const sumsSchema = z.object({
  atDate: atDateSchema,
  native: z.record(currencyCode, minor),
});

/**
 * The `#data` block. The money (`spend`, `state`) is required; the rest is
 * informational and defaults to "nothing to report", so a reconciler that
 * omits a counter does not cost the reader the totals.
 */
export const reconcilerDataSchema = z.object({
  v: z.literal(1),
  cur: currencyCode,
  state: z.enum(["upcoming", "estimate", "partial", "verified"]),
  /** The verified-through day, `YYYY-MM-DD`. */
  through: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  /** This row's currency's spend. */
  native: minor.nullish().transform((v) => v ?? null),
  spend: sumsSchema,
  priced: sumsSchema.nullish().transform((v) => v ?? null),
  /** `[name, CAD minor units]`, at-date CAD. */
  cats: z.array(z.tuple([z.string().min(1), minor])).default([]),
  receipts: z
    .object({ estimate: count.default(0), pending: count.default(0), review: count.default(0) })
    .default({ estimate: 0, pending: 0, review: 0 }),
  guesses: count.default(0),
  unconverted: count.default(0),
  latestUsdCad: z
    .number()
    .positive()
    .nullish()
    .transform((v) => v ?? null),
  idle: z.array(z.unknown()).default([]),
});

export type ReconcilerData = z.infer<typeof reconcilerDataSchema>;
export type ReconcilerState = ReconcilerData["state"];

export interface ReconcilerNote {
  /** The trip the marker names. */
  tripId: string;
  /** The row's currency, as the marker names it. */
  currency: string;
  /** Null when the `#data` block is missing or does not validate. */
  data: ReconcilerData | null;
}

/** A marker note read apart; null when the note is not the reconciler's. */
export function parseReconcilerNote(note: string | null | undefined): ReconcilerNote | null {
  if (!note?.startsWith(RECONCILER_MARKER)) return null;
  const marker = MARKER_LINE.exec(note);
  if (!marker) return null;
  return { tripId: marker[1], currency: marker[2], data: parseData(note) };
}

function parseData(note: string): ReconcilerData | null {
  const line = DATA_LINE.exec(note);
  if (!line) return null;
  let json: unknown;
  try {
    json = JSON.parse(line[1]);
  } catch {
    return null;
  }
  const parsed = reconcilerDataSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** What one trip's marker rows say, together. */
export interface TripReconciliation {
  /** The trip-level block of the preferred row; null when no row carried a readable one. */
  data: ReconcilerData | null;
  /** The figures the currency view works from (`lib/tripSpendCurrency.ts`). */
  figures: SpendFigures;
  /** Marker rows found for the trip. */
  rowCount: number;
  /** Marker rows whose block could not be read — counted by their own amount only. */
  malformedRows: number;
}

const NO_RATE: CurrencyPair = { CAD: null, USD: null };

const toMinor = (amount: number, currency: string): number =>
  Math.round(amount * 10 ** minorUnits(currency));

/**
 * The reconciler's rows among a trip's expenses, read as one figure set; null
 * when the trip has none (the card then renders nothing).
 *
 * A row counts only when it sits on THIS trip and on no section, and its
 * marker names this trip: a marker naming another trip describes another
 * trip's money, and printing it here would be worse than printing nothing.
 */
export function readTripReconciliation(
  expenses: readonly TripExpense[],
  tripId: string
): TripReconciliation | null {
  const rows = expenses.flatMap((expense) => {
    if (expense.tripId !== tripId || expense.routeId !== null) return [];
    const note = parseReconcilerNote(expense.note);
    if (!note || note.tripId.toLowerCase() !== tripId.toLowerCase()) return [];
    return [{ expense, note }];
  });
  if (rows.length === 0) return null;

  const readable = rows.filter((r) => r.note.data !== null);
  const preferred = readable.find((r) => r.note.currency === "CAD") ?? readable[0];
  const data = preferred?.note.data ?? null;

  // Per-currency spend: the trip-level map first, because it is one snapshot;
  // a currency it does not name is taken from its own row — the row's `native`
  // when its block is readable, else the row's stored amount in the row's
  // stored currency (the one thing a malformed note cannot take away).
  const native: Record<string, number> = { ...(data?.spend.native ?? {}) };
  for (const { expense, note } of rows) {
    const own: [string, number] =
      note.data && note.data.native !== null
        ? [note.data.cur, note.data.native]
        : [expense.currency, toMinor(expense.amount, expense.currency)];
    if (!(own[0] in native)) native[own[0]] = own[1];
  }

  const spend: SpendSums = { atDate: data?.spend.atDate ?? NO_RATE, native };
  return {
    data,
    figures: {
      spend,
      priced: data?.priced ?? null,
      latestUsdCad: data?.latestUsdCad ?? null,
      unconverted: data?.unconverted ?? 0,
    },
    rowCount: rows.length,
    malformedRows: rows.length - readable.length,
  };
}
