import { describe, expect, it } from "vitest";

import { applyEdit, initialReviewState, type DraftEdit } from "../draftEdits";
import { FLIGHT_ELSEWHERE, FLIGHT_OUT, JOURNEY, KEY, reviewDraft } from "./reviewFixtures";

const draft = reviewDraft();
const start = initialReviewState(draft);

/** Applies edits in order against the fixture. */
function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

describe("initialReviewState", () => {
  it("starts every area as the scan proposed it, under the name the scan suggested", () => {
    expect(start.areas.map((a) => [a.key, a.as, a.name, a.nameEdited, a.vehicle])).toEqual([
      ["2031-05-02#1", "roadtrip", "Southern loop · Northvale", false, "car"],
      ["2031-05-05#1", "roadtrip", "Southern loop · Southbridge", false, "car"],
    ]);
    expect(start.tripName).toBe("Southern loop");
    expect(start.countries).toEqual(["NZ"]);
    expect(start.edits).toEqual([]);
  });

  it("reads the home ends and the leg modes from the stations and legs", () => {
    const [first, second] = start.areas;
    expect([first.homeStart, first.homeEnd, second.homeStart, second.homeEnd]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(first.legModes).toEqual(["road", "road", "road"]);
    expect(second.legModes).toEqual(["road"]);
  });

  it("takes the night answers, the default ticks and the album as the scan left them", () => {
    expect(start.nights).toEqual({
      "2031-05-02": KEY.northvale,
      "2031-05-03": KEY.northvaleAgain,
      "2031-05-04": "flight",
      "2031-05-05": KEY.southbridge,
      "2031-05-06": "unknown",
    });
    expect(start.flightTicks).toEqual({ [FLIGHT_OUT]: true, [FLIGHT_ELSEWHERE]: false });
    expect(start.photoJourneyTicks).toEqual({ [JOURNEY]: true });
    expect(start.album).toEqual({ create: true, name: "Southern loop" });
  });

  it("has no album when the scan asked for none, and none to create when the key cannot", () => {
    expect(initialReviewState(reviewDraft({ album: null })).album).toBeNull();
    const blocked = reviewDraft({
      album: { ...(draft.album as NonNullable<typeof draft.album>), allowed: false },
    });
    expect(initialReviewState(blocked).album?.create).toBe(false);
  });

  it("ticks a flight that is already on the trip", () => {
    const locked = reviewDraft({
      flights: draft.flights.map((f) => ({ ...f, locked: true, defaultAssign: false })),
    });
    expect(Object.values(initialReviewState(locked).flightTicks)).toEqual([true, true]);
  });

  it("copies the stations, so the draft is never edited", () => {
    expect(start.areas[0].stations[1]).not.toBe(draft.areas[0].stations[1]);
    expect(start.areas[0].stations[1]).toEqual(draft.areas[0].stations[1]);
  });
});

describe("an edit the reducer refuses", () => {
  it("returns the very same state, and logs nothing", () => {
    const next = applyEdit(draft, start, { type: "rename", stationKey: "nowhere", title: "x" });
    expect(next).toBe(start);
  });

  it("is told apart from an edit that changes nothing, which is accepted", () => {
    const next = applyEdit(draft, start, {
      type: "setFlightTick",
      flightId: FLIGHT_OUT,
      ticked: true,
    });
    expect(next).not.toBe(start);
    expect(next.flightTicks).toEqual(start.flightTicks);
    expect(next.edits).toHaveLength(1);
  });
});

describe("the edit log", () => {
  it("keeps one entry for consecutive edits that set the same thing", () => {
    const next = run(
      { type: "rename", stationKey: KEY.northvale, title: "N" },
      { type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" }
    );
    expect(next.edits).toEqual([
      { type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" },
    ]);
  });

  it("keeps both when the edits are about different things", () => {
    const next = run(
      { type: "rename", stationKey: KEY.northvale, title: "A" },
      { type: "rename", stationKey: KEY.tarnside, title: "B" },
      { type: "setNote", stationKey: KEY.tarnside, notes: "C" }
    );
    expect(next.edits.map((e) => e.type)).toEqual(["rename", "rename", "setNote"]);
  });

  it("does not fold an edit into one that came before another", () => {
    const next = run(
      { type: "setTripName", name: "A" },
      { type: "setCountries", countries: ["NZ"] },
      { type: "setTripName", name: "B" }
    );
    expect(next.edits.map((e) => e.type)).toEqual(["setTripName", "setCountries", "setTripName"]);
  });
});

describe("rename and notes", () => {
  it("renames a station, trimmed, wherever it is", () => {
    const next = run({ type: "rename", stationKey: KEY.tarnside, title: "  Tarnside Lodge " });
    expect(next.areas[1].stations[1].title).toBe("Tarnside Lodge");
  });

  it("refuses a blank title, one past 200 characters, and a station that is not there", () => {
    for (const title of ["", "   ", "x".repeat(201)]) {
      const edit = { type: "rename", stationKey: KEY.northvale, title } as const;
      expect(applyEdit(draft, start, edit)).toBe(start);
    }
  });

  it("stores a note, and reads a blank one as none", () => {
    const set = run({ type: "setNote", stationKey: KEY.northvale, notes: "Slept in the van" });
    expect(set.areas[0].stations[1].notes).toBe("Slept in the van");
    const cleared = applyEdit(draft, set, {
      type: "setNote",
      stationKey: KEY.northvale,
      notes: " ",
    });
    expect(cleared.areas[0].stations[1].notes).toBeNull();
  });

  it("refuses a note longer than the commit takes", () => {
    const edit = { type: "setNote", stationKey: KEY.northvale, notes: "x".repeat(5001) } as const;
    expect(applyEdit(draft, start, edit)).toBe(start);
    expect(run({ ...edit, notes: "x".repeat(5000) }).areas[0].stations[1].notes).toHaveLength(5000);
  });
});

describe("a leg's mode", () => {
  it("is set on the leg between the two stations, and mirrored in legModes", () => {
    const next = run({
      type: "setLegMode",
      fromKey: KEY.northvale,
      toKey: KEY.portCarrow,
      mode: "ferry",
    });
    expect(next.areas[0].legs[1].mode).toBe("ferry");
    expect(next.areas[0].legModes).toEqual(["road", "ferry", "road"]);
  });

  it("is refused for two stations no leg joins", () => {
    const edit = {
      type: "setLegMode",
      fromKey: KEY.northvale,
      toKey: KEY.tarnside,
      mode: "ferry",
    } as const;
    expect(applyEdit(draft, start, edit)).toBe(start);
  });
});

describe("area name and vehicle", () => {
  it("marks a typed name so it is no longer recomputed", () => {
    const next = run({ type: "setAreaName", areaKey: "2031-05-02#1", name: "The long way" });
    expect(next.areas[0]).toMatchObject({ name: "The long way", nameEdited: true });
  });

  it("sets the vehicle of one area", () => {
    const next = run({ type: "setVehicle", areaKey: "2031-05-05#1", vehicle: "motorhome" });
    expect(next.areas.map((a) => a.vehicle)).toEqual(["car", "motorhome"]);
  });

  it("refuses an area that is not there", () => {
    expect(applyEdit(draft, start, { type: "setVehicle", areaKey: "x", vehicle: "car" })).toBe(
      start
    );
    expect(applyEdit(draft, start, { type: "setAreaName", areaKey: "x", name: "y" })).toBe(start);
  });
});

describe("flights, journeys, album, countries and the trip's name", () => {
  it("unticks and ticks a flight", () => {
    const off = run({ type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false });
    expect(off.flightTicks[FLIGHT_OUT]).toBe(false);
    const on = run({ type: "setFlightTick", flightId: FLIGHT_ELSEWHERE, ticked: true });
    expect(on.flightTicks[FLIGHT_ELSEWHERE]).toBe(true);
  });

  it("will not untick a flight that is already on the trip, nor tick one the scan never listed", () => {
    const locked = reviewDraft({ flights: draft.flights.map((f) => ({ ...f, locked: true })) });
    const state = initialReviewState(locked);
    const unticking = { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false } as const;
    expect(applyEdit(locked, state, unticking)).toBe(state);
    const unknown = { type: "setFlightTick", flightId: "nope", ticked: true } as const;
    expect(applyEdit(draft, start, unknown)).toBe(start);
  });

  it("unticks a photo journey, and refuses one the scan did not offer", () => {
    expect(
      run({ type: "togglePhotoJourney", id: JOURNEY, ticked: false }).photoJourneyTicks
    ).toEqual({
      [JOURNEY]: false,
    });
    expect(applyEdit(draft, start, { type: "togglePhotoJourney", id: "x", ticked: true })).toBe(
      start
    );
  });

  it("changes the album's name and whether it is made", () => {
    const next = run({ type: "setAlbum", create: false, name: "Trip photos" });
    expect(next.album).toEqual({ create: false, name: "Trip photos" });
  });

  it("will not make an album the key may not, nor edit one the scan never described", () => {
    const blocked = reviewDraft({
      album: { ...(draft.album as NonNullable<typeof draft.album>), allowed: false },
    });
    const state = initialReviewState(blocked);
    expect(applyEdit(blocked, state, { type: "setAlbum", create: true, name: "x" })).toBe(state);
    const none = reviewDraft({ album: null });
    const bare = initialReviewState(none);
    expect(applyEdit(none, bare, { type: "setAlbum", create: false, name: "x" })).toBe(bare);
  });

  it("keeps the countries that are two capital letters, once each", () => {
    const next = run({
      type: "setCountries",
      countries: ["nz", " AU ", "NZ", "Australia", "", "X1"],
    });
    expect(next.countries).toEqual(["NZ", "AU"]);
  });

  it("renames the trip, and the areas the user did not name follow", () => {
    const next = run(
      { type: "setAreaName", areaKey: "2031-05-05#1", name: "The flight south" },
      { type: "setTripName", name: "Autumn loop" }
    );
    expect(next.tripName).toBe("Autumn loop");
    expect(next.areas.map((a) => a.name)).toEqual(["Autumn loop · Northvale", "The flight south"]);
  });

  it("allows a blank trip name while it is typed, and leaves the area names alone", () => {
    const next = run({ type: "setTripName", name: "" });
    expect(next.tripName).toBe("");
    expect(next.areas.map((a) => a.name)).toEqual(start.areas.map((a) => a.name));
  });
});
