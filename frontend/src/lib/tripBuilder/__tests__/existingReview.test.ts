import { describe, expect, it } from "vitest";

import { applyEdit, buildCommitBody, initialReviewState, reapplyEdits } from "../draftEdits";
import {
  applyExistingEdit,
  initialExistingState,
  liveStatus,
  nightCount,
  notSeenStations,
  refusesExistingEdit,
  rowFactsFor,
} from "../existingReview";
import { existingDraft, KEY } from "./existingFixture";

const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";

describe("initialExistingState", () => {
  it("is absent for a new trip", () => {
    expect(initialExistingState(existingDraft({ target: { kind: "new" } }))).toBeNull();
  });

  it("starts each not-seen station on the draft's default, and removal on when TravStats wrote the album", () => {
    expect(initialExistingState(existingDraft())).toEqual({
      keepNotSeen: { "st-c": true, "st-d": false, "stop-h": true },
      removeOutside: true,
    });
  });

  it("keeps removal off when the key may not remove", () => {
    const draft = existingDraft();
    const sync = draft.album!.sync!;
    const blocked = {
      ...draft,
      album: {
        ...draft.album!,
        sync: { ...sync, removable: { ...sync.removable, allowed: false } },
      },
    };
    expect(initialExistingState(blocked)?.removeOutside).toBe(false);
  });

  it("lists the not-seen stations of every area and of the timeline", () => {
    expect(notSeenStations(existingDraft()).map((s) => s.existingId)).toEqual([
      "st-c",
      "st-d",
      "stop-h",
    ]);
  });
});

describe("applyExistingEdit", () => {
  const draft = existingDraft();
  const start = initialExistingState(draft);

  it("flips a not-seen station", () => {
    const next = applyExistingEdit(start, draft, {
      type: "setKeepNotSeen",
      existingId: "st-d",
      keep: true,
    });
    expect(next?.keepNotSeen["st-d"]).toBe(true);
  });

  it("ignores a station the draft never offered", () => {
    expect(
      applyExistingEdit(start, draft, { type: "setKeepNotSeen", existingId: "nope", keep: false })
    ).toBe(start);
  });

  it("switches album removal, unless the key may not", () => {
    expect(
      applyExistingEdit(start, draft, { type: "setRemoveOutside", remove: false })?.removeOutside
    ).toBe(false);
    const sync = draft.album!.sync!;
    const blocked = {
      ...draft,
      album: {
        ...draft.album!,
        sync: { ...sync, removable: { ...sync.removable, allowed: false } },
      },
    };
    expect(applyExistingEdit(start, blocked, { type: "setRemoveOutside", remove: true })).toBe(
      start
    );
  });

  it("does nothing for a new trip", () => {
    expect(applyExistingEdit(null, draft, { type: "setRemoveOutside", remove: true })).toBeNull();
  });
});

describe("refusesExistingEdit", () => {
  const draft = existingDraft();
  it("will not turn a stored roadtrip into timeline stops", () => {
    expect(
      refusesExistingEdit(draft, { type: "setAreaKind", areaKey: "2031-05-02#1", as: "stops" })
    ).toBe(true);
    expect(
      refusesExistingEdit(draft, { type: "setAreaKind", areaKey: "2031-05-02#1", as: "skip" })
    ).toBe(false);
    expect(refusesExistingEdit(draft, { type: "setAreaKind", areaKey: "other", as: "stops" })).toBe(
      false
    );
    expect(refusesExistingEdit(draft, { type: "setTripName", name: "x" })).toBe(false);
  });
});

describe("live status", () => {
  const draft = existingDraft();
  const state = initialReviewState(draft);
  const [northvale, portCarrow, southbridge] = draft.areas[0].stations;

  it("derives each station's first row from the current night answers", () => {
    const facts = rowFactsFor(state.areas[0], state.nights);
    expect(facts.get(KEY.northvale)).toEqual({
      startDate: "2031-05-02",
      endDate: "2031-05-04",
      slept: true,
    });
    expect(facts.get(KEY.portCarrow)).toEqual({
      startDate: "2031-05-04",
      endDate: "2031-05-05",
      slept: true,
    });
  });

  it("agrees with the server: same, changed, new", () => {
    const facts = rowFactsFor(state.areas[0], state.nights);
    expect(liveStatus(northvale, facts.get(northvale.key))).toBe("same");
    expect(liveStatus(portCarrow, facts.get(portCarrow.key))).toBe("changed");
    expect(liveStatus(southbridge, facts.get(southbridge.key))).toBe("new");
  });

  it("follows an edit: moving the night away makes a same station changed", () => {
    const edited = applyEdit(draft, state, {
      type: "assignNight",
      day: "2031-05-03",
      assign: KEY.portCarrow,
    });
    const facts = rowFactsFor(edited.areas[0], edited.nights);
    expect(liveStatus(northvale, facts.get(northvale.key))).toBe("changed");
  });

  it("lets a stored stay agree with any night", () => {
    const stay = {
      ...portCarrow,
      before: { startDate: "2031-05-04", endDate: "2031-05-05", slept: true, stay: true },
    };
    expect(liveStatus(stay, { startDate: "2031-05-04", endDate: "2031-05-05", slept: false })).toBe(
      "same"
    );
  });

  it("has no status for a new trip's station", () => {
    expect(liveStatus({ ...northvale, status: undefined }, undefined)).toBeNull();
  });

  it("counts nights like the roadtrip does: a slept stay of no span is one night, a pass none", () => {
    expect(nightCount("2031-05-02", "2031-05-04", true)).toBe(2);
    expect(nightCount("2031-05-02", "2031-05-02", true)).toBe(1);
    expect(nightCount("2031-05-02", "2031-05-04", false)).toBe(0);
    expect(nightCount(null, null, true)).toBe(1);
  });
});

describe("the commit body for an existing trip", () => {
  const draft = existingDraft();
  const form = { name: "Northvale loop" };

  it("names the roadtrip, the stored stations, the decisions and the album switch", () => {
    const body = buildCommitBody(draft, initialReviewState(draft), form, COMMIT_KEY);
    const [area] = body.areas;
    expect(area.roadtripId).toBe("r1");
    expect(area.stations.map((s) => s.existingId)).toEqual(["st-a", "st-b", undefined]);
    expect(area.keepNotSeen).toEqual(["st-c"]);
    expect(area.removeNotSeen).toEqual(["st-d"]);
    expect(body.stops).toEqual({ keep: ["stop-h"], remove: [] });
    expect(body.album.removeOutside).toBe(true);
  });

  it("follows the user's choices", () => {
    let state = initialReviewState(draft);
    state = applyEdit(draft, state, { type: "setKeepNotSeen", existingId: "st-c", keep: false });
    state = applyEdit(draft, state, { type: "setKeepNotSeen", existingId: "stop-h", keep: false });
    state = applyEdit(draft, state, { type: "setRemoveOutside", remove: false });
    const body = buildCommitBody(draft, state, form, COMMIT_KEY);
    expect(body.areas[0].keepNotSeen).toEqual([]);
    expect(body.areas[0].removeNotSeen).toEqual(["st-c", "st-d"]);
    expect(body.stops).toEqual({ keep: [], remove: ["stop-h"] });
    expect(body.album.removeOutside).toBe(false);
  });

  it("adds nothing for a new trip", () => {
    const fresh = existingDraft({ target: { kind: "new" } });
    const body = buildCommitBody(fresh, initialReviewState(fresh), form, COMMIT_KEY);
    expect(body.areas[0].roadtripId).toBeUndefined();
    expect(body.stops).toBeUndefined();
  });

  it("refuses to turn a stored roadtrip into timeline stops", () => {
    const state = initialReviewState(draft);
    expect(
      applyEdit(draft, state, { type: "setAreaKind", areaKey: "2031-05-02#1", as: "stops" })
    ).toBe(state);
  });
});

describe("the review state of an existing trip", () => {
  const draft = existingDraft();

  it("logs the keep and removal choices so a reload can replay them", () => {
    let state = initialReviewState(draft);
    state = applyEdit(draft, state, { type: "setKeepNotSeen", existingId: "st-d", keep: true });
    state = applyEdit(draft, state, { type: "setRemoveOutside", remove: false });
    expect(state.edits).toEqual([
      { type: "setKeepNotSeen", existingId: "st-d", keep: true },
      { type: "setRemoveOutside", remove: false },
    ]);
    expect(state.existing).toEqual({
      keepNotSeen: { "st-c": true, "st-d": true, "stop-h": true },
      removeOutside: false,
    });
  });

  it("returns the same state for a choice it refuses, so a replay can count it as dropped", () => {
    const state = initialReviewState(draft);
    expect(
      applyEdit(draft, state, { type: "setKeepNotSeen", existingId: "nope", keep: false })
    ).toBe(state);
    const fresh = existingDraft({ target: { kind: "new" } });
    const freshState = initialReviewState(fresh);
    expect(applyEdit(fresh, freshState, { type: "setRemoveOutside", remove: true })).toBe(
      freshState
    );
  });

  it("replays a keep choice after a re-scan, and drops one the new draft no longer offers", () => {
    let state = initialReviewState(draft);
    state = applyEdit(draft, state, { type: "setKeepNotSeen", existingId: "st-d", keep: true });
    state = applyEdit(draft, state, { type: "setKeepNotSeen", existingId: "st-c", keep: false });
    state = applyEdit(draft, state, { type: "setRemoveOutside", remove: false });
    const stored = JSON.parse(JSON.stringify(state.edits)) as typeof state.edits;

    const [area] = draft.areas;
    const rescanned = existingDraft({
      id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
      areas: [{ ...area, notSeen: (area.notSeen ?? []).filter((s) => s.existingId !== "st-c") }],
    });
    const again = reapplyEdits(rescanned, stored);
    expect(again.kept).toBe(2);
    expect(again.total).toBe(3);
    expect(again.state.existing).toEqual({
      keepNotSeen: { "st-d": true, "stop-h": true },
      removeOutside: false,
    });
    const body = buildCommitBody(rescanned, again.state, { name: "Northvale loop" }, COMMIT_KEY);
    expect(body.areas[0].keepNotSeen).toEqual(["st-d"]);
    expect(body.album.removeOutside).toBe(false);
  });
});
