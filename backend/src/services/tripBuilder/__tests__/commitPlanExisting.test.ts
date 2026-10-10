jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import { prisma } from "../../../db";
import type { CommitBody } from "../../../schemas/tripBuilder";
import { loadVisibleDomains } from "../../domainVisibility";
import { prepareCommit } from "../commitPlan";
import { annotateDraftForExisting } from "../existingDraft";
import { loadExistingState } from "../existingState";
import { extendPlanForExisting } from "../commitPlanExisting";
import type { CommitPlan, StoredDraft } from "../types";
import {
  addStation,
  createExistingFixture,
  dropFixtureUser,
  FX,
  type ExistingFixture,
} from "./existingDb";
import { area, derivedStations, draft, K } from "./existingDraftFixture";

const mockDomains = loadVisibleDomains as jest.Mock;

// Synthetic fixtures only (public repository).
const USER = "m7k-plan";
const AREA = "2031-05-02#1";
const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";

// Both describes share one client, so it closes once, after the last of them.
afterAll(async () => {
  await prisma.$disconnect();
});

describe("extendPlanForExisting", () => {
  let fx: ExistingFixture;

  beforeAll(async () => {
    fx = await createExistingFixture(USER);
  });
  afterAll(async () => {
    await dropFixtureUser(USER);
  });

  /**
   * The stored draft a scan of the fixture trip would leave, annotated against the real database.
   * `seen` is what the photos showed: by default four stations, so Kelmore alone is not seen.
   */
  async function storedDraft(seen = derivedStations()): Promise<StoredDraft> {
    const state = await loadExistingState(fx.userId, fx.tripId);
    const { dto, existing } = annotateDraftForExisting(
      draft(fx.tripId, [area({ stations: seen })]),
      state
    );
    return {
      id: dto.id,
      ownerId: fx.userId,
      createdAt: 0,
      touchedAt: 0,
      status: "ready",
      input: {
        name: "Northvale loop",
        startDay: "2031-05-02",
        endDay: "2031-05-09",
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
        seen.map((s) => [s.key, { areaKey: AREA, firstDay: s.firstDay, lastDay: s.lastDay }])
      ),
      // no area is a `stops` area, so both stored timeline stops are offered as not seen
      existing,
    };
  }

  function body(
    over: Partial<CommitBody["areas"][number]> = {},
    rest: Partial<CommitBody> = {}
  ): CommitBody {
    const stations = derivedStations();
    const ids = [fx.station.a, fx.station.b, undefined, fx.station.s];
    return {
      commitKey: COMMIT_KEY,
      window: { startDay: "2031-05-02", endDay: "2031-05-09" },
      target: { kind: "existing", tripId: fx.tripId, applyWindow: false },
      flightIds: [],
      nights: Object.fromEntries(
        Object.entries(draft(fx.tripId).nights).map(([d, e]) => [d, e.assign])
      ),
      areas: [
        {
          key: AREA,
          as: "roadtrip",
          name: "Northvale loop",
          vehicle: "car",
          homeStart: false,
          homeEnd: false,
          roadtripId: fx.roadtripId,
          stations: stations.map((s, i) => ({
            key: s.key,
            title:
              i === 0 ? "Northvale Lodge" : s.title === "Tarnside" ? "Tarnside Lodge" : s.title,
            lat: s.lat,
            lon: s.lon,
            kind: "visit",
            firstDay: s.firstDay,
            lastDay: s.lastDay,
            // a matched station was shown with its stored notes (none); only the new one carries the photo summary
            notes: ids[i] ? null : s.notes,
            ...(ids[i] ? { existingId: ids[i] } : {}),
          })),
          legModes: ["road", "road", "ferry"],
          keepNotSeen: [fx.station.c],
          removeNotSeen: [],
          ...over,
        },
      ],
      photoJourneyIds: [],
      stops: { keep: [fx.stop.museum, fx.stop.harbour], remove: [] },
      album: { create: false, name: "Northvale loop" },
      ...rest,
    };
  }

  const basePlan = (): CommitPlan => ({
    draftId: "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
    userId: fx.userId,
    window: { startDay: "2031-05-02", endDay: "2031-05-09" },
    target: {
      kind: "existing",
      tripId: fx.tripId,
      tripName: "Northvale loop",
      applyWindow: false,
      countries: ["NZ"],
    },
    flightIds: [],
    stops: [],
    roadtrips: [
      {
        areaKey: AREA,
        name: "Northvale loop",
        vehicle: "car",
        stations: [],
        legModes: [],
        nights: 0,
      },
    ],
    photoJourneyIds: [],
    album: { create: false, name: "Northvale loop" },
    unknownNights: 3,
  });

  it("writes the matched roadtrip in place: ids, kept station, new station in order", async () => {
    const plan = await extendPlanForExisting(fx.userId, await storedDraft(), body(), basePlan());
    expect(plan.roadtrips).toEqual([]);
    const [write] = plan.existing?.roadtrips ?? [];
    expect(write).toMatchObject({
      areaKey: AREA,
      roadtripId: fx.roadtripId,
      name: "Northvale loop",
      noop: false,
    });
    expect(write.stations.map((s) => [s.id, s.title])).toEqual([
      [fx.station.a, "Northvale Lodge"],
      [fx.station.b, "Port Carrow"],
      [fx.station.c, "Kelmore"],
      [undefined, "Southbridge"],
      [fx.station.s, "Tarnside Lodge"],
    ]);
    expect(write.diff).toEqual({ updated: 2, unchanged: 1, added: 1, removed: 0, kept: 1 });
  });

  it("keeps a stored stay as a stay, and gives matched stations their stored coordinates and notes", async () => {
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(), body(), basePlan())).existing
        ?.roadtrips ?? [];
    const tarnside = write.stations.find((s) => s.id === fx.station.s);
    expect(tarnside?.night).toEqual({ kind: "stay", lodgingStayId: fx.stayId });
    const northvale = write.stations[0];
    expect(northvale).toMatchObject({ lat: FX.northvale.lat, lon: FX.northvale.lon, notes: null });
    const kelmore = write.stations.find((s) => s.id === fx.station.c);
    expect(kelmore).toMatchObject({
      title: "Kelmore",
      notes: "Quiet street",
      night: { kind: "free" },
    });
  });

  it("derives nights from the user's answers: slept stations are free nights", async () => {
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(), body(), basePlan())).existing
        ?.roadtrips ?? [];
    expect(write.stations.find((s) => s.id === fx.station.b)?.night).toEqual({ kind: "free" });
    expect(write.stations.find((s) => s.title === "Southbridge")?.night).toEqual({ kind: "free" });
  });

  it("sets a leg mode only for a new leg, and leaves stored legs and legs of kept stations alone", async () => {
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(), body(), basePlan())).existing
        ?.roadtrips ?? [];
    // A→B stored, B→C kept station, C→Southbridge new but no derived pair, Southbridge→Tarnside new
    expect(write.legModes).toEqual([undefined, undefined, undefined, "ferry"]);
    expect(write.resetLegs).toEqual([]);
  });

  it("resets a stored leg whose mode the user changed", async () => {
    const changed = body({ legModes: ["ferry", "road", "ferry"] });
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(), changed, basePlan())).existing
        ?.roadtrips ?? [];
    expect(write.legModes[0]).toBe("ferry");
    expect(write.resetLegs).toEqual([{ fromStopId: fx.station.a, toStopId: fx.station.b }]);
  });

  it("removes a not-seen station the user removed", async () => {
    const removed = body({ keepNotSeen: [], removeNotSeen: [fx.station.c] });
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(), removed, basePlan())).existing
        ?.roadtrips ?? [];
    expect(write.stations.map((s) => s.id)).not.toContain(fx.station.c);
    expect(write.diff).toMatchObject({ removed: 1, kept: 0 });
  });

  it("takes a matched station the user deleted out of the roadtrip", async () => {
    const stations = body().areas[0].stations.filter((s) => s.existingId !== fx.station.b);
    const [write] =
      (
        await extendPlanForExisting(
          fx.userId,
          await storedDraft(),
          body({ stations, legModes: ["road", "ferry"] }),
          basePlan()
        )
      ).existing?.roadtrips ?? [];
    expect(write.stations.map((s) => s.id)).not.toContain(fx.station.b);
    expect(write.diff.removed).toBe(1);
  });

  /** The body for a scan whose photos showed Northvale alone: the other three stored stations are kept as they are. */
  function northvaleOnly(): CommitBody {
    const same = body({
      stations: [
        {
          key: K.northvale,
          title: "Northvale",
          lat: FX.northvale.lat,
          lon: FX.northvale.lon,
          kind: "visit",
          firstDay: "2031-05-02",
          lastDay: "2031-05-03",
          notes: null,
          existingId: fx.station.a,
        },
      ],
      legModes: [],
      keepNotSeen: [fx.station.b, fx.station.c, fx.station.s],
    });
    return { ...same, nights: { "2031-05-02": K.northvale, "2031-05-03": K.northvale } };
  }

  it("writes nothing when nothing differs from what is stored", async () => {
    const seen = derivedStations().slice(0, 1);
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(seen), northvaleOnly(), basePlan()))
        .existing?.roadtrips ?? [];
    expect(write).toMatchObject({
      noop: true,
      diff: { updated: 0, added: 0, removed: 0, unchanged: 1, kept: 3 },
    });
  });

  it("refuses a roadtrip id the draft did not give that area", async () => {
    await expect(
      extendPlanForExisting(
        fx.userId,
        await storedDraft(),
        body({ roadtripId: "99999999-9999-4999-8999-999999999999" }),
        basePlan()
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "DRAFT_MISMATCH", field: "areas" });
  });

  it("refuses a stored station id that is not the one the draft gave that station", async () => {
    const swapped = body().areas[0].stations.map((s) =>
      s.existingId === fx.station.a
        ? { ...s, existingId: fx.station.b }
        : s.existingId === fx.station.b
          ? { ...s, existingId: fx.station.a }
          : s
    );
    await expect(
      extendPlanForExisting(fx.userId, await storedDraft(), body({ stations: swapped }), basePlan())
    ).rejects.toMatchObject({ statusCode: 400, code: "DRAFT_MISMATCH", field: "stations" });
  });

  it("refuses a body that did not decide every not-seen station", async () => {
    await expect(
      extendPlanForExisting(
        fx.userId,
        await storedDraft(),
        body({ keepNotSeen: [], removeNotSeen: [] }),
        basePlan()
      )
    ).rejects.toMatchObject({ code: "DRAFT_MISMATCH", field: "stations" });
  });

  it("answers 409 TRIP_CHANGED when a station was added after the scan", async () => {
    const draftOfScan = await storedDraft();
    const added = await addStation(fx.roadtripId, 4, {
      title: "Roadside camp",
      at: FX.southbridge,
      startDay: "2031-05-09",
      endDay: "2031-05-10",
      overnight: true,
    });
    await expect(
      extendPlanForExisting(fx.userId, draftOfScan, body(), basePlan())
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });
    await prisma.tripStop.delete({ where: { id: added } });
  });

  it("answers 409 TRIP_CHANGED when the roadtrip is gone", async () => {
    const draftOfScan = await storedDraft();
    const other = await prisma.tripRoute.create({
      data: { userId: fx.userId, tripId: fx.tripId, name: "Temp", mode: "road", kind: "tour" },
    });
    await prisma.tripRoute.update({ where: { id: other.id }, data: { tripId: null } });
    await prisma.tripRoute.update({ where: { id: fx.roadtripId }, data: { tripId: null } });
    await expect(
      extendPlanForExisting(fx.userId, draftOfScan, body(), basePlan())
    ).rejects.toMatchObject({
      code: "TRIP_CHANGED",
    });
    await prisma.tripRoute.update({ where: { id: fx.roadtripId }, data: { tripId: fx.tripId } });
    await prisma.tripRoute.delete({ where: { id: other.id } });
  });

  describe("through prepareCommit", () => {
    beforeEach(() => mockDomains.mockResolvedValue(["flight", "roadtrip"]));

    it("hands an existing target to extendPlanForExisting: the matched roadtrip moves out of the new ones", async () => {
      const plan = await prepareCommit(fx.userId, await storedDraft(), body());
      expect(plan.roadtrips).toEqual([]);
      expect(plan.existing?.roadtrips.map((r) => r.roadtripId)).toEqual([fx.roadtripId]);
      expect(plan.existing?.roadtrips[0].stations.map((s) => s.id)).toContain(fx.station.c);
    });

    it("does not need two rows for a roadtrip that updates a stored one, because its kept stations are not rows", async () => {
      const plan = await prepareCommit(
        fx.userId,
        await storedDraft(derivedStations().slice(0, 1)),
        northvaleOnly()
      );
      expect(plan.existing?.roadtrips[0]).toMatchObject({ noop: true });
    });

    it("still needs two rows for a roadtrip that would be new", async () => {
      const single = northvaleOnly();
      const [onlyArea] = single.areas;
      const created: CommitBody = {
        ...single,
        areas: [
          {
            ...onlyArea,
            roadtripId: undefined,
            keepNotSeen: [],
            stations: onlyArea.stations.map(({ existingId: _dropped, ...station }) => station),
          },
        ],
      };
      await expect(
        prepareCommit(fx.userId, await storedDraft(derivedStations().slice(0, 1)), created)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "STATIONS_INVALID",
        field: "areas.0",
      });
    });
  });

  it("leaves a new target untouched", async () => {
    const plan = basePlan();
    const newPlan: CommitPlan = {
      ...plan,
      target: { kind: "new", trip: { name: "Northvale loop" } },
    };
    const out = await extendPlanForExisting(
      fx.userId,
      await storedDraft(),
      { ...body(), target: { kind: "new", trip: { name: "Northvale loop" } } },
      newPlan
    );
    expect(out).toBe(newPlan);
  });
});

describe("extendPlanForExisting: timeline stops", () => {
  let fx: ExistingFixture;
  beforeAll(async () => {
    fx = await createExistingFixture(`${USER}-stops`);
  });
  afterAll(async () => {
    await dropFixtureUser(`${USER}-stops`);
  });

  async function stopsDraft(): Promise<StoredDraft> {
    const stopsArea = area({
      key: "2031-05-06#1",
      defaultAs: "stops",
      stations: [
        {
          key: "-908|3370|2031-05-06",
          title: "Kelmore Museum",
          titleSource: "geocode",
          kind: "visit",
          lat: FX.kelmore.lat,
          lon: FX.kelmore.lon,
          snappedKm: null,
          firstDay: "2031-05-06",
          lastDay: "2031-05-07",
          firstLocal: null,
          lastLocal: null,
          photoCount: 5,
          previewIdx: [],
          notes: null,
        },
      ],
    });
    const state = await loadExistingState(fx.userId, fx.tripId);
    const { dto, existing } = annotateDraftForExisting(draft(fx.tripId, [stopsArea]), {
      ...state,
      roadtrips: [],
    });
    return {
      id: dto.id,
      ownerId: fx.userId,
      createdAt: 0,
      touchedAt: 0,
      status: "ready",
      input: {
        name: "x",
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        inspect: true,
        createAlbum: false,
        target: { kind: "existing", tripId: fx.tripId },
      },
      immichUserId: "u",
      connSource: "user",
      dto,
      previewAssetIds: [],
      albumAssetIds: [],
      flightIds: new Set<string>(),
      stationIndex: new Map(),
      existing,
    };
  }

  const stopsBody = (over: Partial<CommitBody> = {}): CommitBody => ({
    commitKey: COMMIT_KEY,
    window: { startDay: "2031-05-02", endDay: "2031-05-09" },
    target: { kind: "existing", tripId: fx.tripId, applyWindow: false },
    flightIds: [],
    nights: {},
    areas: [
      {
        key: "2031-05-06#1",
        as: "stops",
        name: "Kelmore Museum",
        vehicle: "car",
        homeStart: false,
        homeEnd: false,
        stations: [
          {
            key: "-908|3370|2031-05-06",
            title: "Kelmore Museum",
            lat: FX.kelmore.lat,
            lon: FX.kelmore.lon,
            kind: "visit",
            firstDay: "2031-05-06",
            lastDay: "2031-05-07",
            existingId: fx.stop.museum,
          },
        ],
        legModes: [],
        keepNotSeen: [],
        removeNotSeen: [],
      },
    ],
    photoJourneyIds: [],
    stops: { keep: [], remove: [fx.stop.harbour] },
    album: { create: false, name: "x" },
    ...over,
  });

  const stopsPlan = (): CommitPlan => ({
    draftId: "d",
    userId: fx.userId,
    window: { startDay: "2031-05-02", endDay: "2031-05-09" },
    target: {
      kind: "existing",
      tripId: fx.tripId,
      tripName: "Northvale loop",
      applyWindow: false,
      countries: [],
    },
    flightIds: [],
    stops: [
      {
        areaKey: "2031-05-06#1",
        title: "Kelmore Museum",
        lat: FX.kelmore.lat,
        lon: FX.kelmore.lon,
        startDay: "2031-05-06",
        endDay: "2031-05-07",
        notes: null,
      },
    ],
    roadtrips: [],
    photoJourneyIds: [],
    album: { create: false, name: "x" },
    unknownNights: 0,
  });

  it("updates the matched stop's dates instead of creating a copy, and removes the one the user removed", async () => {
    const plan = await extendPlanForExisting(
      fx.userId,
      await stopsDraft(),
      stopsBody(),
      stopsPlan()
    );
    expect(plan.stops).toEqual([]);
    expect(plan.existing?.stopUpdates).toEqual([
      {
        areaKey: "2031-05-06#1",
        stopId: fx.stop.museum,
        title: "Kelmore Museum",
        notes: null,
        startDay: "2031-05-06",
        endDay: "2031-05-07",
      },
    ]);
    expect(plan.existing?.stopRemoveIds).toEqual([fx.stop.harbour]);
    expect(plan.existing?.stopsDiff).toEqual({
      updated: 1,
      unchanged: 0,
      added: 0,
      removed: 1,
      kept: 0,
    });
  });

  it("writes no update for a stop whose dates and text are unchanged", async () => {
    const same = stopsPlan();
    same.stops = [{ ...same.stops[0], endDay: "2031-05-06" }];
    const body = stopsBody();
    body.areas[0].stations[0].lastDay = "2031-05-06";
    const plan = await extendPlanForExisting(fx.userId, await stopsDraft(), body, same);
    expect(plan.existing?.stopUpdates).toEqual([]);
    expect(plan.existing?.stopsDiff).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it("refuses a body that did not decide every not-seen stop", async () => {
    await expect(
      extendPlanForExisting(
        fx.userId,
        await stopsDraft(),
        stopsBody({ stops: { keep: [], remove: [] } }),
        stopsPlan()
      )
    ).rejects.toMatchObject({ code: "DRAFT_MISMATCH", field: "stations" });
  });

  it("answers 409 TRIP_CHANGED when a stop was added after the scan", async () => {
    const scanned = await stopsDraft();
    const added = await prisma.tripStop.create({
      data: { tripId: fx.tripId, title: "Late stop", lat: -45.0, lon: 168.7 },
    });
    await expect(
      extendPlanForExisting(fx.userId, scanned, stopsBody(), stopsPlan())
    ).rejects.toMatchObject({ code: "TRIP_CHANGED" });
    await prisma.tripStop.delete({ where: { id: added.id } });
  });
});
