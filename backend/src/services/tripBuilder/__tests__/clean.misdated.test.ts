import { addDays } from "../../../shared/tour/builderNightPlan";
import { flagMisdated } from "../clean";
import type { MisdatedReason, PhotoPoint } from "../types";
import { makePhoto, OWNER, PARTNER, PORT_CARROW, type PhotoInput } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

const pad = (n: number, width = 4): string => String(n).padStart(width, "0");

/**
 * iPhone shots IMG_<from> onward, `perDay` a day from 10:00 on `firstDay`,
 * ten minutes apart.
 */
function shots(
  from: number,
  count: number,
  firstDay: string,
  perDay = count,
  over: PhotoInput = {}
): PhotoPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const minutes = 600 + (i % perDay) * 10;
    const day = addDays(firstDay, Math.floor(i / perDay));
    const local = `${day} ${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
    return makePhoto({
      id: `img-${pad(from + i)}`,
      originalFileName: `IMG_${pad(from + i)}.HEIC`,
      local,
      ...over,
    });
  });
}

/** A `searchByFileName` stand-in that answers from a table. */
function lookupFrom(answers: Record<string, readonly PhotoPoint[]>) {
  return jest.fn(
    async (fragment: string): Promise<readonly PhotoPoint[]> => answers[fragment] ?? []
  );
}

/** The trip, 20–29 May 2031: its own run IMG_7600 … IMG_7659, six shots a day. */
const TRIP_RUN = shots(7600, 60, "2031-05-20", 6);
/** A batch taken 4–5 May but stamped 25 May: IMG_7382 … IMG_7429, all at Port Carrow. */
const BATCH = shots(7382, 48, "2031-05-25", 48, { ...PORT_CARROW });
/** The batch's true counter neighbours, three weeks before its stamp. */
const BEFORE_BATCH = shots(7370, 12, "2031-05-04"); // IMG_7370 … IMG_7381
const AFTER_BATCH = shots(7430, 10, "2031-05-05"); // IMG_7430 … IMG_7439
/** What searchByFileName finds: the true neighbours, and the batch itself. */
const ANSWERS = {
  IMG_73: [...BEFORE_BATCH, ...BATCH.filter((p) => p.originalFileName.startsWith("IMG_73"))],
  IMG_74: [...BATCH.filter((p) => p.originalFileName.startsWith("IMG_74")), ...AFTER_BATCH],
};

describe("flagMisdated", () => {
  it("flags a whole 48-photo batch whose counter neighbours lie three weeks earlier", async () => {
    const reasons = await flagMisdated([...TRIP_RUN, ...BATCH], [], lookupFrom(ANSWERS));
    expect(reasons).toEqual(new Map(BATCH.map((p) => [p.id, "batch" as MisdatedReason])));
  });

  it("asks for the batch's neighbours first, and for the trip's own run with what is left", async () => {
    const lookup = lookupFrom(ANSWERS);
    await flagMisdated([...TRIP_RUN, ...BATCH], [], lookup);
    expect(lookup.mock.calls.map(([fragment]) => fragment)).toEqual(["IMG_73", "IMG_74", "IMG_75"]);
  });

  it("finds both neighbours in the context days and asks nothing", async () => {
    const lookup = lookupFrom({});
    const reasons = await flagMisdated(BATCH, [...BEFORE_BATCH, ...AFTER_BATCH], lookup);
    expect(reasons.size).toBe(48);
    expect([...reasons.values()].every((reason) => reason === "batch")).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("leaves a run whose neighbours lie weeks apart: the trip's own edges", async () => {
    const lookup = lookupFrom({
      IMG_75: shots(7590, 10, "2031-05-01"),
      IMG_76: shots(7660, 5, "2031-06-15"),
    });
    expect((await flagMisdated(TRIP_RUN, [], lookup)).size).toBe(0);
  });

  it("ignores a neighbour that belongs to another owner or another camera", async () => {
    // Both neighbours of the batch, answered by one owner. With the caller as that owner
    // they date the batch; the same answers from a partner's library must not.
    const neighboursOf = (ownerId: string) =>
      lookupFrom({
        IMG_73: shots(7370, 12, "2031-05-04", 12, { ownerId }),
        IMG_74: shots(7430, 10, "2031-05-05", 10, { ownerId }),
      });
    const own = await flagMisdated(BATCH, [], neighboursOf(OWNER));
    expect(own).toEqual(new Map(BATCH.map((p) => [p.id, "batch" as MisdatedReason])));
    expect((await flagMisdated(BATCH, [], neighboursOf(PARTNER))).size).toBe(0);
    const otherCamera = lookupFrom({
      IMG_73: BEFORE_BATCH,
      IMG_74: shots(7430, 10, "2031-05-05", 10, { model: "iPhone 12" }),
    });
    expect((await flagMisdated(BATCH, [], otherCamera)).size).toBe(0);
  });

  it("spends at most six lookups a scan", async () => {
    const lonely = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000].map(
      (n) => shots(n, 1, "2031-05-24")[0]
    );
    const lookup = lookupFrom({});
    await flagMisdated(lonely, [], lookup);
    expect(lookup).toHaveBeenCalledTimes(6);
  });

  it("asks each fragment once", async () => {
    const lookup = lookupFrom({});
    await flagMisdated(
      [...shots(7340, 1, "2031-05-24"), ...shots(7380, 1, "2031-05-24")],
      [],
      lookup
    );
    expect(lookup.mock.calls.map(([fragment]) => fragment)).toEqual(["IMG_73"]);
  });

  it("names the first check that caught a photo: straggler, then batch, then filename clock", async () => {
    const smallBatch = [
      ...shots(7382, 3, "2031-05-25"),
      ...shots(7385, 1, "2031-05-29"),
      ...shots(7386, 2, "2031-05-25"),
    ];
    const samsung = makePhoto({
      id: "samsung",
      originalFileName: "20310520_101500.jpg",
      local: "2031-05-24 10:15",
    });
    const lookup = lookupFrom({ IMG_73: [...BEFORE_BATCH, ...shots(7388, 5, "2031-05-05")] });
    const reasons = await flagMisdated([...smallBatch, samsung], [], lookup);
    expect(reasons).toEqual(
      new Map<string, MisdatedReason>([
        ["img-7382", "batch"],
        ["img-7383", "batch"],
        ["img-7384", "batch"],
        ["img-7385", "straggler"],
        ["img-7386", "batch"],
        ["img-7387", "batch"],
        ["samsung", "filenameClock"],
      ])
    );
  });
});
