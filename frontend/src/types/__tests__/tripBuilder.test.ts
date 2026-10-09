import { describe, expect, it } from "vitest";

import {
  NIGHT_SPECIALS,
  TRIP_BUILDER_PHASES,
  type CommitBody,
  type LauncherHandoff,
  type TripBuilderDraft,
} from "../tripBuilder";
import type { TripRoadtripStationDto } from "../tripRoadtripStation";

// Synthetic fixtures only (public repository): invented places, shifted years.

describe("trip builder wire vocabulary", () => {
  it("counts the same seven phases the scan job reports", () => {
    expect(TRIP_BUILDER_PHASES).toEqual([
      "fetch",
      "clean",
      "flights",
      "movement",
      "names",
      "roads",
      "nights",
    ]);
  });

  it("answers a night with a station key or one of three words", () => {
    expect(NIGHT_SPECIALS).toEqual(["home", "unknown", "flight"]);
  });

  it("describes an album-only draft with no movement", () => {
    const draft: TripBuilderDraft = {
      id: "4b9d6f1a-2c3e-4a5b-8d7e-9f0a1b2c3d4e",
      expiresAt: "2031-05-10T14:00:00.000Z",
      window: {
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        checkedFrom: "2031-04-29",
        checkedTo: "2031-05-12",
      },
      options: { inspect: false, createAlbum: true },
      target: { kind: "new" },
      tripName: "Northvale loop",
      countries: [],
      originLabel: null,
      destinationLabel: null,
      stats: {
        assets: 12,
        images: 10,
        videos: 2,
        located: 0,
        excluded: {
          partner: 0,
          hiddenLivePart: 1,
          misdated: 0,
          inFlight: 0,
          atSea: 0,
          unlocated: 12,
          dayGuessed: 0,
        },
        truncated: false,
      },
      flights: [],
      days: [],
      nights: {},
      areas: [],
      photoJourneys: [],
      album: {
        name: "Northvale loop",
        existing: null,
        assetCount: 12,
        images: 10,
        videos: 2,
        allowed: true,
        missingScopes: [],
      },
      warnings: [{ code: "noLocatedPhotos", params: {} }],
    };
    expect(draft.areas).toHaveLength(0);
    expect(draft.album?.assetCount).toBe(12);
  });

  it("describes a commit of one roadtrip area", () => {
    const body: CommitBody = {
      commitKey: "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d",
      window: { startDay: "2031-05-02", endDay: "2031-05-05" },
      target: { kind: "new", trip: { name: "Northvale loop" } },
      flightIds: [],
      nights: { "2031-05-02": "-901|3374|2031-05-02", "2031-05-04": "unknown" },
      areas: [
        {
          key: "2031-05-02#1",
          as: "roadtrip",
          name: "Northvale loop",
          vehicle: "car",
          homeStart: false,
          homeEnd: false,
          stations: [
            {
              key: "-901|3374|2031-05-02",
              title: "Northvale",
              lat: -45.05,
              lon: 168.7,
              kind: "visit",
              firstDay: "2031-05-02",
              lastDay: "2031-05-03",
            },
            {
              key: "-894|3383|2031-05-04",
              title: "Port Carrow",
              lat: -44.7,
              lon: 169.15,
              kind: "visit",
              firstDay: "2031-05-04",
              lastDay: "2031-05-05",
            },
          ],
          legModes: ["ferry"],
        },
      ],
      photoJourneyIds: [],
      album: { create: false, name: "Northvale loop" },
    };
    expect(body.areas[0].legModes).toEqual(["ferry"]);
  });

  it("hands the review page the scan that was lost before any draft existed", () => {
    // `scan` is optional: a handoff made after the draft exists carries none.
    const withoutScan: LauncherHandoff = {
      form: { name: "Northvale loop" },
      target: { kind: "new" },
      returnTo: "/trips",
    };
    const withScan: LauncherHandoff = {
      ...withoutScan,
      scan: {
        name: "Northvale loop",
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        inspect: false,
        createAlbum: true,
        target: { kind: "new" },
      },
    };
    expect(withoutScan.scan).toBeUndefined();
    expect(withScan.scan?.endDay).toBe("2031-05-09");
  });

  it("describes a roadtrip station on the trip timeline", () => {
    const row: TripRoadtripStationDto = {
      id: "7c6b5a49-3827-4615-9d0c-1b2a3f4e5d6c",
      title: "Port Carrow",
      lat: -44.7,
      lon: 169.15,
      startDate: "2031-05-03T00:00:00.000Z",
      endDate: "2031-05-05T00:00:00.000Z",
      notes: null,
      routeId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      routeName: "Northvale loop",
      routeOrderIdx: 1,
      state: "free",
      nights: 2,
    };
    expect(row.nights).toBe(2);
  });

  it("carries the time columns beside `times`, as a trip stop does", () => {
    const row: TripRoadtripStationDto = {
      id: "7c6b5a49-3827-4615-9d0c-1b2a3f4e5d6c",
      title: "Port Carrow",
      lat: -44.7,
      lon: 169.15,
      startDate: "2031-05-03T00:00:00.000Z",
      endDate: "2031-05-05T00:00:00.000Z",
      startUtc: "2031-05-02T20:00:00.000Z",
      endUtc: "2031-05-04T21:30:00.000Z",
      stopZone: "Pacific/Auckland",
      precision: "minute",
      notes: null,
      routeId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      routeName: "Northvale loop",
      routeOrderIdx: 1,
      state: "stay",
      nights: 2,
    };
    expect(row.stopZone).toBe("Pacific/Auckland");
    expect(row.startUtc).toBe("2031-05-02T20:00:00.000Z");
  });
});
