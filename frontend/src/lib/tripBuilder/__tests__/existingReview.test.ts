import { describe, expect, it } from "vitest";

import type { TripBuilderDraft } from "../../../types/tripBuilder";
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
import { existingDraft, KEY, matchedStopDraft, STOP_KEY } from "./existingFixture";

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

  it("carries the review's name for a matched roadtrip into the body", () => {
    let state = initialReviewState(draft);
    state = applyEdit(draft, state, {
      type: "setAreaName",
      areaKey: "2031-05-02#1",
      name: "  Westshire circuit  ",
    });
    const body = buildCommitBody(draft, state, form, COMMIT_KEY);
    expect(body.areas[0].roadtripId).toBe("r1");
    expect(body.areas[0].name).toBe("Westshire circuit");
  });

  it("starts the name at the name the scan sent for the area, without recomputing it", () => {
    // For a matched roadtrip the server sends the stored name as `suggestedName`;
    // the review must show exactly that, or the field would not be the name at stake.
    const [area] = draft.areas;
    const named = existingDraft({ areas: [{ ...area, suggestedName: "Southern loop" }] });
    expect(initialReviewState(named).areas[0].name).toBe("Southern loop");
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

describe("the legs of a matched roadtrip", () => {
  /**
   * The trip stores a ferry leg between Northvale and Port Carrow; the photos
   * derive a road one (Finding N3-1). The server sends the stored mode on the leg
   * itself — the mode the commit writes, and leaves alone unless it changes —
   * with the scan's own mode beside it for the review's changed pill.
   */
  const storedFerryDraft = (): TripBuilderDraft => {
    const draft = existingDraft();
    const [area] = draft.areas;
    return {
      ...draft,
      areas: [
        {
          ...area,
          legs: [
            { ...area.legs[0], mode: "ferry", derivedMode: "road", ferryEvidence: null },
            area.legs[1],
          ],
        },
      ],
    };
  };

  it("sends the mode the review shows for each pair, and a toggle's mode in its place", () => {
    const draft = storedFerryDraft();
    const form = { name: "Northvale loop" };
    let state = initialReviewState(draft);
    expect(state.areas[0].legModes).toEqual(["ferry", "road"]);

    let body = buildCommitBody(draft, state, form, COMMIT_KEY);
    expect(body.areas[0].legModes).toEqual(["ferry", "road"]);

    state = applyEdit(draft, state, {
      type: "setLegMode",
      fromKey: KEY.northvale,
      toKey: KEY.portCarrow,
      mode: "road",
    });
    body = buildCommitBody(draft, state, form, COMMIT_KEY);
    expect(body.areas[0].legModes).toEqual(["road", "road"]);
  });
});

describe("the stops area of an existing trip", () => {
  const draft = matchedStopDraft();
  const state = initialReviewState(draft);
  const form = { name: "Port Carrow" };
  const areaKey = "2031-05-04#1";

  it("will not turn a matched stop into a roadtrip, and no body can name one", () => {
    expect(refusesExistingEdit(draft, { type: "setAreaKind", areaKey, as: "roadtrip" })).toBe(true);
    expect(applyEdit(draft, state, { type: "setAreaKind", areaKey, as: "roadtrip" })).toBe(state);
    expect(refusesExistingEdit(draft, { type: "setAreaKind", areaKey, as: "skip" })).toBe(false);

    // The guard makes this shape unreachable through the reducer; the body builder
    // strips the id anyway, so no state can send a stored stop under a new roadtrip.
    const forced = {
      ...state,
      areas: state.areas.map((area) => ({ ...area, as: "roadtrip" as const })),
    };
    const body = buildCommitBody(draft, forced, form, COMMIT_KEY);
    expect(body.areas[0].as).toBe("roadtrip");
    expect(body.areas[0].roadtripId).toBeUndefined();
    expect(body.areas[0].stations.some((s) => s.existingId !== undefined)).toBe(false);
  });

  it("keeps the stored stop's id while the area is stops", () => {
    const body = buildCommitBody(draft, state, form, COMMIT_KEY);
    expect(body.areas[0].stations[0].existingId).toBe("stop-m");
  });

  it("will not remove the anchor: that row is the stored stop", () => {
    expect(refusesExistingEdit(draft, { type: "delete", stationKey: STOP_KEY.harbour })).toBe(true);
    expect(applyEdit(draft, state, { type: "delete", stationKey: STOP_KEY.harbour })).toBe(state);

    // Another run of the stop is still the user's to remove.
    const removed = applyEdit(draft, state, { type: "delete", stationKey: STOP_KEY.market });
    expect(removed).not.toBe(state);
    expect(buildCommitBody(draft, removed, form, COMMIT_KEY).areas[0].stations).toEqual([
      expect.objectContaining({ existingId: "stop-m" }),
    ]);
  });

  it("lets the anchor be merged: the merged row keeps the stop's id", () => {
    const merged = applyEdit(draft, state, { type: "merge", stationKey: STOP_KEY.harbour });
    expect(merged).not.toBe(state);
    expect(buildCommitBody(draft, merged, form, COMMIT_KEY).areas[0].stations).toEqual([
      expect.objectContaining({ key: STOP_KEY.harbour, existingId: "stop-m" }),
    ]);
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
