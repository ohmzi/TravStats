import { describe, expect, it } from "vitest";

import {
  deriveStationRows,
  validateNightPlan,
  type NightPlanArea,
} from "../../../shared/tour/builderNightPlan";
import type { CommitBody, TripBuilderDraft } from "../../../types/tripBuilder";
import type { CreateTripInput } from "../../api/trips";
import { applyEdit, buildCommitBody, initialReviewState, type DraftEdit } from "../draftEdits";
import { toPlanStation } from "../stationOps";
import {
  COMMIT_KEY,
  FLIGHT_ELSEWHERE,
  FLIGHT_OUT,
  JOURNEY,
  KEY,
  PITSTOP_KEY,
  STOPOVER,
  pitstopDraft,
  reviewDraft,
  stopoverDraft,
} from "./reviewFixtures";

const draft = reviewDraft();
const FORM: CreateTripInput = { name: "Southern loop", description: "Autumn", tags: ["photos"] };

function bodyAfter(
  edits: DraftEdit[],
  d: TripBuilderDraft = draft,
  form: CreateTripInput = FORM
): CommitBody {
  const state = edits.reduce((s, edit) => applyEdit(d, s, edit), initialReviewState(d));
  return buildCommitBody(d, state, form, COMMIT_KEY);
}

describe("buildCommitBody for a new trip", () => {
  const body = bodyAfter([]);

  it("names the window, the key and exactly the fields the schema takes", () => {
    expect(body.commitKey).toBe(COMMIT_KEY);
    expect(body.window).toEqual({ startDay: "2031-05-02", endDay: "2031-05-07" });
    expect(Object.keys(body).sort()).toEqual(
      [
        "album",
        "areas",
        "commitKey",
        "flightIds",
        "nights",
        "photoJourneyIds",
        "stopovers",
        "target",
        "window",
      ].sort()
    );
    expect(Object.keys(body.areas[0]).sort()).toEqual(
      [
        "album",
        "as",
        "homeEnd",
        "homeStart",
        "key",
        "legModes",
        "name",
        "stations",
        "vehicle",
      ].sort()
    );
    expect(Object.keys(body.areas[0].stations[0]).sort()).toEqual(
      ["firstDay", "key", "kind", "lastDay", "lat", "lon", "notes", "title"].sort()
    );
  });

  it("puts the window, the countries and the edited name into the trip the form describes", () => {
    expect(body.target).toEqual({
      kind: "new",
      trip: {
        name: "Southern loop",
        description: "Autumn",
        tags: ["photos"],
        startDate: "2031-05-02",
        endDate: "2031-05-07",
        countries: ["NZ"],
      },
    });
  });

  it("sends the ticked flights and journeys, the nights and the album", () => {
    expect(body.flightIds).toEqual([FLIGHT_OUT]);
    expect(body.photoJourneyIds).toEqual([JOURNEY]);
    expect(body.nights).toEqual({
      "2031-05-02": KEY.northvale,
      "2031-05-03": KEY.northvaleAgain,
      "2031-05-04": "flight",
      "2031-05-05": KEY.southbridge,
      "2031-05-06": "unknown",
    });
    expect(body.album).toEqual({ create: true, name: "Southern loop" });
  });

  it("sends every area with one leg mode per pair of stations and the home flags its stations imply", () => {
    expect(body.areas.map((a) => [a.key, a.as, a.stations.length, a.legModes.length])).toEqual([
      ["2031-05-02#1", "roadtrip", 4, 3],
      ["2031-05-05#1", "roadtrip", 2, 1],
    ]);
    expect(body.areas.map((a) => [a.homeStart, a.homeEnd])).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it("is a plan the commit would accept: valid nights and two rows for every roadtrip", () => {
    const included = body.areas.filter((a) => a.as !== "skip");
    const areas: NightPlanArea[] = included.map((a) => ({
      key: a.key,
      startDay: draft.areas.find((d) => d.key === a.key)?.startDay ?? "",
      endDay: draft.areas.find((d) => d.key === a.key)?.endDay ?? "",
      stationKeys: a.stations.map((s) => s.key),
    }));
    const stations = included.flatMap((a) => a.stations.map(toPlanStation));
    expect(validateNightPlan(stations, body.nights, areas, body.window)).toEqual([]);
    for (const area of included) {
      expect(
        deriveStationRows(area.stations.map(toPlanStation), body.nights).length
      ).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("buildCommitBody after edits", () => {
  it("sends a skipped area, with its nights read as unknown", () => {
    const body = bodyAfter([{ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" }]);
    expect(body.areas[1].as).toBe("skip");
    expect(body.areas[1].stations).toHaveLength(2);
    expect(body.nights["2031-05-05"]).toBe("unknown");
  });

  it("follows the user's choices: flights, journeys, album, name, countries, vehicle", () => {
    const body = bodyAfter([
      { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false },
      { type: "setFlightTick", flightId: FLIGHT_ELSEWHERE, ticked: true },
      { type: "togglePhotoJourney", id: JOURNEY, ticked: false },
      { type: "setAlbum", create: false, name: "Photos" },
      { type: "setTripName", name: " Autumn loop " },
      { type: "setCountries", countries: ["nz", "au"] },
      { type: "setVehicle", areaKey: "2031-05-05#1", vehicle: "motorhome" },
    ]);
    expect(body.flightIds).toEqual([FLIGHT_ELSEWHERE]);
    expect(body.photoJourneyIds).toEqual([]);
    expect(body.album).toEqual({ create: false, name: "Photos" });
    expect(body.target).toMatchObject({
      kind: "new",
      trip: { name: "Autumn loop", countries: ["NZ", "AU"] },
    });
    expect(body.areas[1].vehicle).toBe("motorhome");
    expect(body.areas[0].name).toBe("Autumn loop · Northvale");
  });

  it("sends the merged, folded and deleted chain, not the scan's", () => {
    const body = bodyAfter([
      { type: "foldDayTrip", stationKey: KEY.portCarrow },
      { type: "delete", stationKey: KEY.tarnside },
    ]);
    expect(body.areas.map((a) => a.stations.map((s) => s.key))).toEqual([
      [KEY.home, KEY.northvale],
      [KEY.southbridge],
    ]);
    expect(body.areas.map((a) => a.legModes)).toEqual([["road"], []]);
    expect(body.nights["2031-05-06"]).toBe("unknown");
  });

  it("falls back to the trip's name for a blank album or area name", () => {
    const body = bodyAfter([
      { type: "setAlbum", create: true, name: "  " },
      { type: "setAreaName", areaKey: "2031-05-02#1", name: "" },
    ]);
    expect(body.album.name).toBe("Southern loop");
    expect(body.areas[0].name).toBe("Southern loop");
  });

  it("asks for no album when the scan described none", () => {
    const body = bodyAfter([], reviewDraft({ album: null }));
    expect(body.album).toEqual({ create: false, name: "Southern loop" });
  });

  it("leaves a flight that is already on the trip where it is", () => {
    const locked = reviewDraft({
      flights: draft.flights.map((f) => (f.id === FLIGHT_OUT ? { ...f, locked: true } : f)),
    });
    expect(bodyAfter([], locked).flightIds).toEqual([]);
  });
});

describe("buildCommitBody for an existing trip", () => {
  const existing = reviewDraft({
    target: {
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      tripName: "Southern loop",
    },
  });

  it("names the trip and the countries, and moves its dates only when the window differs", () => {
    const same = bodyAfter([], existing, {
      name: "Southern loop",
      startDate: "2031-05-02",
      endDate: "2031-05-07",
    });
    expect(same.target).toEqual({
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      applyWindow: false,
      countries: ["NZ"],
    });
    const longer = bodyAfter([], existing, {
      name: "Southern loop",
      startDate: "2031-05-02",
      endDate: "2031-05-06",
    });
    expect(longer.target).toMatchObject({ kind: "existing", applyWindow: true });
  });

  it("does not move the dates of a trip whose saved dates it was not told", () => {
    expect(bodyAfter([], existing, { name: "Southern loop" }).target).toMatchObject({
      applyWindow: false,
    });
  });

  it("names the route, and writes neither the journey's countries nor its dates", () => {
    const scoped = reviewDraft({
      target: {
        kind: "existing",
        tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
        tripName: "Northvale loop",
        routeId: "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
        routeName: "Northvale loop",
      },
    });
    // The form's dates EQUAL the draft's window (the trip's saved days a
    // scoped scan started from): nothing moved, so the commit writes no date
    // at all — a re-sync that re-dated nothing stores what it stored before.
    const same = bodyAfter([], scoped, {
      name: "Northvale loop",
      startDate: "2031-05-02",
      endDate: "2031-05-07",
    });
    expect(same.target).toEqual({
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      routeId: "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
      applyWindow: false,
    });

    // Dates the review changed travel as `applyWindow` — the journey flow's
    // `moved`, one level down, and the server writes them onto the TRIP's own
    // days (owner 2026-10-13). The journey's countries still never go.
    const moved = bodyAfter([], scoped, {
      name: "Northvale loop",
      startDate: "2031-05-03",
      endDate: "2031-05-06",
    });
    expect(moved.target).toEqual({
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      routeId: "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
      applyWindow: true,
    });

    // The trip-scoped commit writes the trip alone: no flight moves.
    expect(moved.flightIds).toEqual([]);
    expect(moved.photoJourneyIds).toEqual([]);
  });

  it("keeps the stopover switches through the re-sync fields", () => {
    const existingStopover = stopoverDraft({ target: existing.target });
    const body = bodyAfter(
      [{ type: "setStopoverTick", key: STOPOVER.key, roadtrip: true, album: true }],
      existingStopover,
      { name: "Southern loop" }
    );
    expect(body.stopovers).toEqual([{ key: STOPOVER.key, roadtrip: true, album: true }]);
    expect(body.stops).toEqual({ keep: [], remove: [] });
  });

  it("keeps a pitstop's album through the re-sync fields", () => {
    const existingPitstop = pitstopDraft({ target: existing.target });
    const body = bodyAfter([], existingPitstop, { name: "Southern loop" });
    expect(body.areas.find((area) => area.key === PITSTOP_KEY)?.album).toBe(true);
    expect(body.stops).toEqual({ keep: [], remove: [] });
  });
});
