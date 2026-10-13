/**
 * The trip-shape matrix (owner directive 2026-10-13, the "Sumayya's wedding"
 * re-sync blocker): ONE area shape gets ONE answer from every path that judges
 * it — the create guard (`commitPlan`), the re-sync guard
 * (`commitPlanExisting`) and the scan's offer (`decideAreaKind`). The rule
 * lives once, in `isTripShape` (shared/tour/builderNightPlan.ts); THIS matrix
 * is the guard against the class of drift that let the create path write a
 * one-station multi-night stay while the re-sync path refused it forever. A
 * new shape or a new guard belongs in this table.
 */
jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import { prisma } from "../../../db";
import type { CommitBody } from "../../../schemas/tripBuilder";
import { loadVisibleDomains } from "../../domainVisibility";
import { decideAreaKind } from "../areas";
import { prepareCommit } from "../commitPlan";
import { annotateDraftForExisting } from "../existingDraft";
import { loadExistingState } from "../existingState";
import type { AreaKind, DraftArea, DraftStation, StoredDraft } from "../types";
import { fixtureDraft } from "./commitFixtures";
import {
  addStation,
  createExistingFixture,
  dropFixtureUser,
  type ExistingFixture,
} from "./existingDb";
import { area, derivedStation, draft } from "./existingDraftFixture";
import { groundArea, planOf, station } from "./planFixtures";

const mockDomains = loadVisibleDomains as jest.Mock;

// Synthetic fixtures only (public repository): invented places, shifted years.
const USER = "m7k-trip-shape";
const AREA = "2031-05-02#1";
const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-09" };
const NAME = "Shape loop";
const NO_HOME = {
  start: { offered: false, defaultOn: false },
  end: { offered: false, defaultOn: false },
  unconfirmed: false,
};

interface ShapeStation {
  key: string;
  title: string;
  at: { lat: number; lon: number };
  firstDay: string;
  lastDay: string;
}

/** The update arm's stored stations: an overnight is a free night, `via` a route correction. */
interface StoredShapeStation extends ShapeStation {
  overnight?: boolean;
  via?: boolean;
}

interface Shape {
  key: string;
  /** The sentence the matrix's cases are named after. */
  label: string;
  /** The rows the create path writes and the dated stations the re-sync keeps; 0 is the refusal. */
  writes: number;
  /** What every path is asked about: the area's span and the stations the scan showed. */
  span: { startDay: string; endDay: string };
  stations: ShapeStation[];
  /** The review's answers, by night. */
  nights: Record<string, string>;
  /** Update arm: whether the body keeps the scan's stations (the emptied shape drops the dated one). */
  keepsAll: boolean;
  /** Update arm: the stored roadtrip's stations, in route order. */
  stored: StoredShapeStation[];
  /** Update arm: the stored roadtrip's name the review shows and the write re-checks. */
  routeName: string;
}

const s = (
  key: string,
  title: string,
  lat: number,
  lon: number,
  firstDay: string,
  lastDay: string,
  over: { overnight?: boolean; via?: boolean } = {}
): StoredShapeStation => ({ key, title, at: { lat, lon }, firstDay, lastDay, ...over });

/** The four shapes: one answer each, read by every path below. */
const SHAPES: Shape[] = [
  {
    key: "stay",
    label: "a one-station multi-night stay (the Karachi shape)",
    writes: 1,
    span: { startDay: "2031-05-02", endDay: "2031-05-09" },
    stations: [s("shape-stay", "Vastra", 12.5, 101, "2031-05-02", "2031-05-08")],
    nights: Object.fromEntries(
      [
        "2031-05-02",
        "2031-05-03",
        "2031-05-04",
        "2031-05-05",
        "2031-05-06",
        "2031-05-07",
        "2031-05-08",
      ].map((day) => [day, "shape-stay"] as const)
    ),
    keepsAll: true,
    routeName: "Vastra loop",
    stored: [s("shape-stay", "Vastra", 12.5, 101, "2031-05-02", "2031-05-08", { overnight: true })],
  },
  {
    key: "one-night",
    label: "a one-station one-night area (no stay)",
    writes: 0,
    span: { startDay: "2031-05-02", endDay: "2031-05-03" },
    stations: [s("shape-one", "Norvik", 13.5, 102.5, "2031-05-02", "2031-05-03")],
    nights: { "2031-05-02": "shape-one" },
    keepsAll: true,
    routeName: "Norvik stop",
    stored: [
      s("shape-one", "Norvik", 13.5, 102.5, "2031-05-02", "2031-05-03", { overnight: true }),
    ],
  },
  {
    key: "drive",
    label: "a two-station drive",
    writes: 2,
    span: { startDay: "2031-05-02", endDay: "2031-05-04" },
    stations: [
      s("shape-lund", "Lund", 14.5, 104, "2031-05-02", "2031-05-02"),
      s("shape-hafn", "Hafn", 14.9, 104.6, "2031-05-03", "2031-05-03"),
    ],
    nights: { "2031-05-02": "shape-lund", "2031-05-03": "shape-hafn" },
    keepsAll: true,
    routeName: "Lund crossing",
    stored: [
      s("shape-lund", "Lund", 14.5, 104, "2031-05-02", "2031-05-02", { overnight: true }),
      s("shape-hafn", "Hafn", 14.9, 104.6, "2031-05-03", "2031-05-03"),
    ],
  },
  {
    key: "split-stay",
    label: "a stay the scan split into its places",
    // The by-name split's own shape (amended 2026-10-13, the "Sumayya's
    // wedding" stay): the city's photos chain to a place 33 km out, so the
    // stay's station list is the city, the place and the city again — and a
    // stored roadtrip holding the one old station gains the two new ones.
    writes: 3,
    span: { startDay: "2031-05-02", endDay: "2031-05-09" },
    stations: [
      s("split-city", "Vastra", 16.5, 107.5, "2031-05-02", "2031-05-05"),
      s("split-cove", "Vastra Cove", 16.8, 107.5, "2031-05-05", "2031-05-05"),
      s("split-city-2", "Vastra", 16.5, 107.5, "2031-05-06", "2031-05-08"),
    ],
    nights: {
      "2031-05-02": "split-city",
      "2031-05-03": "split-city",
      "2031-05-04": "split-city",
      "2031-05-05": "split-cove",
      "2031-05-06": "split-city-2",
      "2031-05-07": "split-city-2",
      "2031-05-08": "split-city-2",
    },
    keepsAll: true,
    routeName: "Vastra stay",
    stored: [
      s("split-stored", "Vastra", 16.5, 107.5, "2031-05-02", "2031-05-08", { overnight: true }),
    ],
  },
  {
    key: "emptied",
    label: "an area left with no dated station (emptied / via-only)",
    writes: 0,
    span: { startDay: "2031-05-02", endDay: "2031-05-04" },
    stations: [s("shape-gone", "Ostmark", 15.5, 106, "2031-05-02", "2031-05-03")],
    nights: { "2031-05-02": "shape-gone", "2031-05-03": "shape-gone" },
    keepsAll: false,
    routeName: "Ostmark detour",
    stored: [
      s("shape-gone", "Ostmark", 15.5, 106, "2031-05-02", "2031-05-03", { overnight: true }),
      s("shape-via", "Correction", 15.6, 106.1, "2031-05-03", "2031-05-03", { via: true }),
    ],
  },
];

const draftStationOf = (station: ShapeStation): DraftStation =>
  derivedStation(station.key, station.title, station.at, station.firstDay, station.lastDay);

function areaOf(shape: Shape, stations: DraftStation[]): DraftArea {
  return {
    key: AREA,
    defaultAs: "roadtrip",
    suggestedName: NAME,
    mainCity: stations[0]?.title ?? null,
    startDay: shape.span.startDay,
    endDay: shape.span.endDay,
    home: NO_HOME,
    stations,
    legs: stations.slice(1).map((station, index) => ({
      fromKey: stations[index].key,
      toKey: station.key,
      chordKm: 40,
      routedKm: null,
      mode: "road" as const,
      ferryEvidence: null,
    })),
  };
}

const nightEntries = (nights: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(nights).map(([day, assign]) => [
      day,
      { assign, reason: "lastPhoto" as const, suggestedStationKeys: [] },
    ])
  );

const commitStationOf = (station: ShapeStation) => ({
  key: station.key,
  title: station.title,
  lat: station.at.lat,
  lon: station.at.lon,
  kind: "visit" as const,
  firstDay: station.firstDay,
  lastDay: station.lastDay,
  notes: null,
});

describe("the trip-shape matrix", () => {
  let fx: ExistingFixture;

  beforeAll(async () => {
    fx = await createExistingFixture(USER);
    // One stored roadtrip per shape, far enough apart that each scan's area
    // can only match its own.
    for (const [index, shape] of SHAPES.entries()) {
      const route = await prisma.tripRoute.create({
        data: {
          userId: fx.userId,
          tripId: fx.tripId,
          name: shape.routeName,
          mode: "road",
          kind: "roadtrip",
          vehicle: "car",
          orderIdx: index + 1,
        },
      });
      for (const [stationIndex, stored] of shape.stored.entries()) {
        await addStation(route.id, stationIndex, {
          title: stored.title,
          at: stored.at,
          startDay: stored.firstDay,
          endDay: stored.lastDay,
          ...(stored.overnight === true ? { overnight: true } : {}),
          ...(stored.via === true ? { viaPoint: true } : {}),
        });
      }
    }
  });

  afterAll(async () => {
    await dropFixtureUser(USER);
    await prisma.$disconnect();
  });

  function createDraft(shape: Shape): StoredDraft {
    const base = fixtureDraft(fx.userId);
    const stations = shape.stations.map(draftStationOf);
    return {
      ...base,
      input: { ...base.input, name: NAME, startDay: WINDOW.startDay, endDay: WINDOW.endDay },
      dto: {
        ...base.dto,
        window: { ...base.dto.window, ...WINDOW },
        tripName: NAME,
        areas: [areaOf(shape, stations)],
        nights: nightEntries(shape.nights),
      },
      stationIndex: new Map(
        stations.map(
          (station) =>
            [
              station.key,
              { areaKey: AREA, firstDay: station.firstDay, lastDay: station.lastDay },
            ] as const
        )
      ),
    };
  }

  function createBody(shape: Shape): CommitBody {
    const kept = shape.keepsAll ? shape.stations : [];
    return {
      commitKey: COMMIT_KEY,
      window: { ...WINDOW },
      target: { kind: "new", trip: { name: NAME } },
      flightIds: [],
      nights: shape.keepsAll ? shape.nights : {},
      areas: [
        {
          key: AREA,
          as: "roadtrip",
          name: NAME,
          vehicle: "car",
          homeStart: false,
          homeEnd: false,
          stations: kept.map(commitStationOf),
          legModes: kept.slice(1).map(() => "road" as const),
          album: false,
          keepNotSeen: [],
          removeNotSeen: [],
        },
      ],
      stopovers: [],
      photoJourneyIds: [],
      stops: { keep: [], remove: [] },
      album: { create: false, name: NAME },
    };
  }

  async function updatePlan(shape: Shape) {
    const state = await loadExistingState(fx.userId, fx.tripId);
    const scanned = draft(fx.tripId, [areaOf(shape, shape.stations.map(draftStationOf))], {
      tripName: NAME,
      nights: nightEntries(shape.nights),
    });
    const { dto, existing } = annotateDraftForExisting(scanned, state, new Map());
    const offered = dto.areas[0];
    const stored: StoredDraft = {
      id: dto.id,
      ownerId: fx.userId,
      createdAt: 0,
      touchedAt: 0,
      status: "ready",
      input: {
        name: NAME,
        startDay: WINDOW.startDay,
        endDay: WINDOW.endDay,
        inspect: true,
        createAlbum: false,
        target: { kind: "existing", tripId: fx.tripId },
      },
      immichUserId: "immich-user-1",
      connSource: "user",
      dto,
      previewAssetIds: [],
      albumAssetIds: [],
      flightIds: new Set<string>(),
      stationIndex: new Map(
        offered.stations.map(
          (station) =>
            [
              station.key,
              { areaKey: AREA, firstDay: station.firstDay, lastDay: station.lastDay },
            ] as const
        )
      ),
      stopovers: [],
      pitstops: [],
      existing,
    };
    const kept = shape.keepsAll ? offered.stations : [];
    const body: CommitBody = {
      commitKey: COMMIT_KEY,
      window: { ...WINDOW },
      target: { kind: "existing", tripId: fx.tripId, applyWindow: false },
      flightIds: [],
      nights: shape.keepsAll ? shape.nights : {},
      areas: [
        {
          key: AREA,
          as: "roadtrip",
          name: offered.suggestedName,
          vehicle: "car",
          homeStart: false,
          homeEnd: false,
          roadtripId: offered.roadtripId,
          stations: kept.map((station) => ({
            key: station.key,
            title: station.title,
            lat: station.lat,
            lon: station.lon,
            kind: station.kind,
            firstDay: station.firstDay,
            lastDay: station.lastDay,
            notes: station.notes ?? null,
            ...(station.existingId === undefined ? {} : { existingId: station.existingId }),
          })),
          legModes: kept.slice(1).map(() => "road" as const),
          album: false,
          keepNotSeen: [],
          removeNotSeen: [],
        },
      ],
      stopovers: [],
      photoJourneyIds: [],
      stops: { keep: [fx.stop.museum, fx.stop.harbour], remove: [] },
      album: { create: false, name: offered.suggestedName },
    };
    return prepareCommit(fx.userId, stored, body);
  }

  beforeEach(() => mockDomains.mockResolvedValue(["flight", "roadtrip"]));

  describe("the create path: commitPlan's area guard", () => {
    for (const shape of SHAPES) {
      const name = shape.writes === 0 ? `refuses ${shape.label}` : `writes ${shape.label}`;
      it(name, async () => {
        const run = prepareCommit(fx.userId, createDraft(shape), createBody(shape));
        if (shape.writes === 0) {
          await expect(run).rejects.toMatchObject({
            statusCode: 400,
            code: "STATIONS_INVALID",
            field: "areas.0",
          });
        } else {
          const plan = await run;
          expect(plan.roadtrips[0].stations).toHaveLength(shape.writes);
        }
      });
    }
  });

  describe("the re-sync path: commitPlanExisting's final-list guard", () => {
    for (const shape of SHAPES) {
      const name = shape.writes === 0 ? `refuses ${shape.label}` : `keeps ${shape.label}`;
      it(name, async () => {
        const run = updatePlan(shape);
        if (shape.writes === 0) {
          await expect(run).rejects.toMatchObject({
            statusCode: 400,
            code: "STATIONS_INVALID",
            field: "areas.0",
          });
        } else {
          const plan = await run;
          const [write] = plan.existing?.roadtrips ?? [];
          expect(write.stations).toHaveLength(shape.writes);
        }
      });
    }

    it("updates the stored stay's station in place and adds the places the split found", async () => {
      const shape = SHAPES.find((candidate) => candidate.key === "split-stay");
      if (shape === undefined) throw new Error("the split-stay shape is gone");
      const plan = await updatePlan(shape);
      const [write] = plan.existing?.roadtrips ?? [];

      // The stored stay's one station is the city's, so it updates in place
      // (its id kept, the photo days' row written); the place 33 km out and
      // the city's later run are new stations of the same roadtrip, in order.
      expect(write.stations.map((s) => [s.id !== undefined, s.title])).toEqual([
        [true, "Vastra"],
        [false, "Vastra Cove"],
        [false, "Vastra"],
      ]);
      expect(write.diff).toEqual({ updated: 1, unchanged: 0, added: 2, removed: 0, kept: 0 });
    });
  });

  describe("the scan's offer: decideAreaKind", () => {
    for (const shape of SHAPES) {
      const offered: AreaKind = shape.writes === 0 ? "stops" : "roadtrip";
      it(`offers ${shape.label} as ${offered}`, () => {
        // An area left with no city station is the way home alone: the offer
        // arm's own reading of the emptied/via-only shape.
        const planStations = shape.keepsAll
          ? shape.stations.map((shapeStation) =>
              station(shapeStation.key, {
                title: shapeStation.title,
                firstDay: shapeStation.firstDay,
                lastDay: shapeStation.lastDay,
                lat: shapeStation.at.lat,
                lon: shapeStation.at.lon,
              })
            )
          : [
              station("shape-home", {
                kind: "home",
                title: "Kelmore",
                firstDay: shape.span.startDay,
                lastDay: shape.span.endDay,
              }),
            ];
        const plan = planOf(planStations, {
          area: groundArea({ startDay: shape.span.startDay, endDay: shape.span.endDay }),
        });
        expect(decideAreaKind(plan, true)).toBe(offered);
      });
    }
  });
});
