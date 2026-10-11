import { describe, expect, it } from "vitest";

import {
  applyEdit,
  buildCommitBody,
  initialReviewState,
  reapplyEdits,
  type DraftEdit,
  type ReviewState,
} from "../draftEdits";
import { COMMIT_KEY, FLIGHT_OUT, PITSTOP_KEY, pitstopDraft, reviewDraft } from "./reviewFixtures";

const draft = pitstopDraft();
const start = initialReviewState(draft);
const FORM = { name: "Southern loop" };

function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

const reviewArea = (state: ReviewState, key: string) =>
  state.areas.find((area) => area.key === key);

const bodyArea = (body: ReturnType<typeof buildCommitBody>, key: string) =>
  body.areas.find((area) => area.key === key);

describe("initialReviewState with a pitstop", () => {
  it("starts the pitstop area's own album on (spec §3: checked by default)", () => {
    expect(reviewArea(start, PITSTOP_KEY)?.album).toBe(true);
  });

  it("leaves an ordinary area's album off", () => {
    expect(reviewArea(start, "2031-05-02#1")?.album).toBe(false);
  });
});

describe("setAreaAlbum", () => {
  it("unticks the pitstop's album, and ticks it back on", () => {
    const off = run({ type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false });
    expect(reviewArea(off, PITSTOP_KEY)?.album).toBe(false);
    const on = applyEdit(draft, off, { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: true });
    expect(reviewArea(on, PITSTOP_KEY)?.album).toBe(true);
  });

  it("refuses an area the draft does not offer as a pitstop", () => {
    const plain = reviewDraft();
    const state = initialReviewState(plain);
    expect(
      applyEdit(plain, state, { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: true })
    ).toBe(state);
  });

  it("keeps one log line per area, however often the switch is flipped", () => {
    const state = run(
      { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false },
      { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: true },
      { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false }
    );
    expect(state.edits).toEqual([{ type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false }]);
  });
});

describe("the pitstop album in the commit body", () => {
  it("sends the pitstop's album on, and every other area's off", () => {
    const body = buildCommitBody(draft, start, FORM, COMMIT_KEY);
    expect(bodyArea(body, PITSTOP_KEY)?.album).toBe(true);
    expect(bodyArea(body, "2031-05-02#1")?.album).toBe(false);
  });

  it("sends the untick", () => {
    const off = run({ type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false });
    const body = buildCommitBody(draft, off, FORM, COMMIT_KEY);
    expect(bodyArea(body, PITSTOP_KEY)?.album).toBe(false);
  });

  it("never sends the album beside a kind that is not a roadtrip (spec §4)", () => {
    const stops = run({ type: "setAreaKind", areaKey: PITSTOP_KEY, as: "stops" });
    const body = buildCommitBody(draft, stops, FORM, COMMIT_KEY);
    expect(bodyArea(body, PITSTOP_KEY)?.as).toBe("stops");
    expect(bodyArea(body, PITSTOP_KEY)?.album).toBe(false);
  });
});

describe("replaying a pitstop album edit", () => {
  it("rebuilds the same state on the same draft", () => {
    const state = run(
      { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false },
      { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false }
    );
    const again = reapplyEdits(draft, state.edits);
    expect(again.state).toEqual(state);
    expect(again.kept).toBe(2);
  });

  it("drops the edit when a re-scan no longer offers the pitstop", () => {
    const { kept, total } = reapplyEdits(reviewDraft(), [
      { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false },
      { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false },
    ]);
    expect([kept, total]).toEqual([1, 2]);
  });
});
