import { describe, expect, it } from "vitest";

import {
  applyEdit,
  buildCommitBody,
  initialReviewState,
  reapplyEdits,
  type DraftEdit,
} from "../draftEdits";
import { COMMIT_KEY, AREAS, FLIGHT_OUT, STOPOVER, stopoverDraft } from "./reviewFixtures";

const draft = stopoverDraft();
const start = initialReviewState(draft);

function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

describe("initialReviewState with a stopover", () => {
  it("starts both switches off", () => {
    expect(start.stopoverTicks).toEqual({ [STOPOVER.key]: { roadtrip: false, album: false } });
  });

  it("locks a stopover the re-sync already wrote, both switches on", () => {
    const synced = stopoverDraft({
      stopovers: [{ ...STOPOVER, roadtripId: "r-9", storedPhotoCount: 22 }],
    });
    expect(initialReviewState(synced).stopoverTicks).toEqual({
      [STOPOVER.key]: { roadtrip: true, album: true },
    });
  });

  it("has no ticks for a draft the scan offered no stopover", () => {
    expect(initialReviewState(stopoverDraft({ stopovers: [] })).stopoverTicks).toEqual({});
  });
});

describe("setStopoverTick", () => {
  it("turns the roadtrip switch on and off", () => {
    const on = run({ type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: false });
    expect(on.stopoverTicks[STOPOVER.key]).toEqual({ roadtrip: true, album: false });
    const off = applyEdit(draft, on, {
      type: "setStopoverTick",
      key: STOPOVER.key,
      roadtrip: false,
      album: false,
    });
    expect(off.stopoverTicks[STOPOVER.key]).toEqual({ roadtrip: false, album: false });
  });

  it("refuses an album the roadtrip switch is not on for", () => {
    const next = run({ type: "setStopoverTick", key: STOPOVER.key, roadtrip: false, album: true });
    expect(next.stopoverTicks[STOPOVER.key]).toEqual({ roadtrip: false, album: false });
  });

  it("refuses a stopover the draft does not offer, and one that is already synced", () => {
    expect(
      applyEdit(draft, start, { type: "setStopoverTick", key: "gone", roadtrip: true, album: true })
    ).toBe(start);
    const synced = stopoverDraft({ stopovers: [{ ...STOPOVER, roadtripId: "r-9" }] });
    const locked = initialReviewState(synced);
    expect(
      applyEdit(synced, locked, {
        type: "setStopoverTick",
        key: STOPOVER.key,
        roadtrip: true,
        album: true,
      })
    ).toBe(locked);
  });

  it("keeps one log line per stopover, however often the switches are flipped", () => {
    const state = run(
      { type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: false },
      { type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: true },
      { type: "setStopoverTick", key: STOPOVER.key, roadtrip: false, album: false }
    );
    expect(state.edits).toEqual([
      { type: "setStopoverTick", key: STOPOVER.key, roadtrip: false, album: false },
    ]);
  });
});

describe("setTripName with a stopover offered", () => {
  it("counts the stopover with the areas, so an area keeps its journey-and-city name", () => {
    // The scan's one naming pass counts both kinds when it decides the
    // single-trip case (owner ruling 2026-10-12), so the review's recompute
    // must too: with one roadtrip area and one stopover offered, the area is
    // one of TWO trips and its name keeps its "<Journey> · <City>" form after
    // a rename — it must not collapse to the bare journey name.
    const oneArea = stopoverDraft({ areas: [AREAS[0]] });
    const state = initialReviewState(oneArea);
    const renamed = applyEdit(oneArea, state, { type: "setTripName", name: "Autumn loop" });
    expect(renamed.areas.map((area) => area.name)).toEqual(["Autumn loop · Northvale"]);
  });
});

describe("the stopovers in the commit body", () => {
  const form = { name: "Southern loop" };

  it("sends only the toggled-on stopovers, both switches or neither", () => {
    const off = buildCommitBody(draft, start, form, COMMIT_KEY);
    expect(off.stopovers).toEqual([]);
    const on = buildCommitBody(
      draft,
      run({ type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: true }),
      form,
      COMMIT_KEY
    );
    expect(on.stopovers).toEqual([{ key: STOPOVER.key, roadtrip: true, album: true }]);
  });

  it("sends a locked stopover, so a re-sync keeps it in step", () => {
    const synced = stopoverDraft({ stopovers: [{ ...STOPOVER, roadtripId: "r-9" }] });
    const body = buildCommitBody(synced, initialReviewState(synced), form, COMMIT_KEY);
    expect(body.stopovers).toEqual([{ key: STOPOVER.key, roadtrip: true, album: true }]);
  });

  it("carries exactly the fields the schema takes", () => {
    const body = buildCommitBody(draft, start, form, COMMIT_KEY);
    expect(Object.keys(body).sort()).toContain("stopovers");
    expect(
      Object.keys(body.stopovers[0] ?? { key: "", roadtrip: false, album: false }).sort()
    ).toEqual(["album", "key", "roadtrip"]);
    expect(body.flightIds).toContain(FLIGHT_OUT);
  });
});

describe("replaying a stopover edit", () => {
  it("rebuilds the same ticks on the same draft", () => {
    const state = run(
      { type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: true },
      { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false }
    );
    const again = reapplyEdits(draft, state.edits);
    expect(again.state).toEqual(state);
    expect(again.kept).toBe(2);
  });

  it("drops a stopover edit a re-scan no longer offers", () => {
    const without = stopoverDraft({ stopovers: [] });
    const { kept, total } = reapplyEdits(without, [
      { type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: true },
      { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false },
    ]);
    expect([kept, total]).toEqual([1, 2]);
  });
});

// The real wire never sends the flat `roadtripId`; a matched stopover arrives as
// `stored` (spec §6). Pin the arm the wire actually takes.
describe("a stopover the wire reports as stored", () => {
  it("seeds both switches on, refuses an edit and travels in the commit body", () => {
    const synced = stopoverDraft({
      stopovers: [
        {
          ...STOPOVER,
          stored: { roadtripId: "r-9", name: "Sundhavn 2031 Road Trip", albumAssetCount: 22 },
        },
      ],
    });
    const state = initialReviewState(synced);
    expect(state.stopoverTicks).toEqual({ [STOPOVER.key]: { roadtrip: true, album: true } });
    expect(
      applyEdit(synced, state, {
        type: "setStopoverTick",
        key: STOPOVER.key,
        roadtrip: true,
        album: true,
      })
    ).toBe(state);
    expect(buildCommitBody(synced, state, { name: "Southern loop" }, COMMIT_KEY).stopovers).toEqual(
      [{ key: STOPOVER.key, roadtrip: true, album: true }]
    );
  });
});
