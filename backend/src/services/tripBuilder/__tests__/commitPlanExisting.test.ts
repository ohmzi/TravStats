jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import { prisma } from "../../../db";
import type { CommitBody } from "../../../schemas/tripBuilder";
import { loadVisibleDomains } from "../../domainVisibility";
import { toDbDate } from "../../../shared/time/localDate";
import { writeCommit } from "../commit";
import { prepareCommit } from "../commitPlan";
import { annotateDraftForExisting } from "../existingDraft";
import { loadExistingState } from "../existingState";
import { extendPlanForExisting } from "../commitPlanExisting";
import type {
  CommitPlan,
  DraftArea,
  DraftStation,
  DraftStopover,
  StoredDraft,
  StoredStopover,
  TripBuilderDraft,
} from "../types";
import {
  addStation,
  createExistingFixture,
  dropFixtureUser,
  FX,
  type ExistingFixture,
} from "./existingDb";
import {
  area,
  derivedStation,
  derivedStations,
  draft,
  K,
  STOPOVER_KEY,
  stopover,
} from "./existingDraftFixture";
import { fixtureStoredPitstop, PITSTOP_ALBUM } from "./commitFixtures";

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
  async function storedDraft(
    seen = derivedStations(),
    over: Partial<TripBuilderDraft> = {}
  ): Promise<StoredDraft> {
    const state = await loadExistingState(fx.userId, fx.tripId);
    const { dto, existing } = annotateDraftForExisting(
      draft(fx.tripId, [area({ stations: seen })], over),
      state,
      new Map()
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
      stopovers: [],
      pitstops: [],
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
          album: false,
          keepNotSeen: [fx.station.c],
          removeNotSeen: [],
          ...over,
        },
      ],
      stopovers: [],
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
    stopovers: [],
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

  /**
   * Finding N3-1. The review shows the stored mode on a leg a matched pair updates,
   * because the commit leaves such a leg alone unless the reviewed mode differs from
   * it. When the scan derives another mode, a body that merely carries the reviewed
   * mode (the client's default) must not write, and a body that carries the toggled
   * mode must rewrite the leg.
   */
  it("shows the stored leg's mode in the review, and writes the reviewed mode: untouched leaves it, a toggle rewrites it", async () => {
    // The stored A→B leg is a ferry with routed geometry; the photos derive a road leg.
    await prisma.tripRouteLeg.updateMany({
      where: { routeId: fx.roadtripId, fromStopId: fx.station.a, toStopId: fx.station.b },
      data: { mode: "ferry" },
    });
    try {
      const draftOfScan = await storedDraft();
      // The review's toggle starts on the stored mode, with the scan's own mode beside it.
      expect(draftOfScan.dto.areas[0].legs[0]).toMatchObject({
        mode: "ferry",
        derivedMode: "road",
      });

      // Untouched, the body carries exactly the modes the review showed: the stored
      // ferry is left alone, still routed, and no reset is planned for it.
      const displayed = draftOfScan.dto.areas[0].legs.map((leg) => leg.mode);
      const [untouched] =
        (
          await extendPlanForExisting(
            fx.userId,
            draftOfScan,
            body({ legModes: displayed }),
            basePlan()
          )
        ).existing?.roadtrips ?? [];
      expect(untouched.legModes[0]).toBeUndefined();
      expect(untouched.resetLegs).toEqual([]);

      // The user switches the leg to Road: the reviewed mode is what gets written,
      // and the stored ferry is reset so it comes back straight and is routed again.
      const toggled = body({ legModes: ["road", "road", "ferry"] });
      const [rewritten] =
        (await extendPlanForExisting(fx.userId, draftOfScan, toggled, basePlan())).existing
          ?.roadtrips ?? [];
      expect(rewritten.legModes[0]).toBe("road");
      expect(rewritten.resetLegs).toEqual([{ fromStopId: fx.station.a, toStopId: fx.station.b }]);
    } finally {
      await prisma.tripRouteLeg.updateMany({
        where: { routeId: fx.roadtripId, fromStopId: fx.station.a, toStopId: fx.station.b },
        data: { mode: "road" },
      });
    }
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
      rename: false,
      noop: true,
      diff: { updated: 0, added: 0, removed: 0, unchanged: 1, kept: 3 },
    });
  });

  it("writes the reviewed name for a matched roadtrip, and counts the rename as an update", async () => {
    const renamed = body({ name: "Westshire circuit" });
    const [write] =
      (await extendPlanForExisting(fx.userId, await storedDraft(), renamed, basePlan())).existing
        ?.roadtrips ?? [];
    expect(write).toMatchObject({
      name: "Westshire circuit",
      rename: true,
      noop: false,
    });
    // Two matched stations changed, one was added, one kept — and the rename is the
    // third update: the panel must not report the roadtrip's name as unchanged.
    expect(write.diff).toEqual({ updated: 3, unchanged: 1, added: 1, removed: 0, kept: 1 });
  });

  it("answers 409 TRIP_CHANGED when the stored roadtrip was renamed after the scan", async () => {
    const scanned = await storedDraft();
    await prisma.tripRoute.update({
      where: { id: fx.roadtripId },
      data: { name: "Renamed elsewhere" },
    });
    await expect(
      extendPlanForExisting(fx.userId, scanned, body(), basePlan())
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });
    await prisma.tripRoute.update({
      where: { id: fx.roadtripId },
      data: { name: "Northvale loop" },
    });
  });

  it("refuses to leave a stored roadtrip with one station: the matched stations deleted, the rest removed", async () => {
    const [first] = body().areas[0].stations;
    await expect(
      extendPlanForExisting(
        fx.userId,
        await storedDraft(),
        body({ stations: [first], legModes: [], keepNotSeen: [], removeNotSeen: [fx.station.c] }),
        basePlan()
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "STATIONS_INVALID", field: "areas.0" });
  });

  it("refuses to leave a stored roadtrip with no station at all", async () => {
    await expect(
      extendPlanForExisting(
        fx.userId,
        await storedDraft(),
        body({ stations: [], legModes: [], keepNotSeen: [], removeNotSeen: [fx.station.c] }),
        basePlan()
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "STATIONS_INVALID", field: "areas.0" });
  });

  it("counts a kept not-seen station towards the two a roadtrip needs", async () => {
    const [first] = body().areas[0].stations;
    const [write] =
      (
        await extendPlanForExisting(
          fx.userId,
          await storedDraft(),
          body({ stations: [first], legModes: [], keepNotSeen: [fx.station.c], removeNotSeen: [] }),
          basePlan()
        )
      ).existing?.roadtrips ?? [];
    expect(write.stations.map((s) => s.id)).toEqual([fx.station.a, fx.station.c]);
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

    it("moves a matched pitstop area's album onto its existing write, album-only", async () => {
      // Spec 2026-10-11 pitstops §5: a matched area's roadtrip is the §K diff's
      // business, but its own album still takes the area's current photos — the
      // entry leaves `plan.roadtrips` in `extendPlanForExisting`, so the album
      // must ride on the write it becomes.
      const scanned = await storedDraft(derivedStations(), {
        areas: [area({ pitstop: { albumName: PITSTOP_ALBUM } })],
      });
      const plan = await prepareCommit(
        fx.userId,
        { ...scanned, pitstops: [fixtureStoredPitstop()] },
        body({ album: true })
      );

      expect(plan.roadtrips).toEqual([]);
      const [write] = plan.existing?.roadtrips ?? [];
      expect(write.areaKey).toBe(AREA);
      expect(write.album).toEqual({ name: PITSTOP_ALBUM, assetIds: ["photo-a", "photo-b"] });
    });

    it("accepts the body the review sends for an untouched stored ferry leg, and plans no mode write", async () => {
      // The whole path the client takes: the draft shows the stored mode, the body
      // carries exactly the modes it showed, and `prepareCommit` validates that body
      // before the plan leaves the leg alone. (Finding N3-1.)
      await prisma.tripRouteLeg.updateMany({
        where: { routeId: fx.roadtripId, fromStopId: fx.station.a, toStopId: fx.station.b },
        data: { mode: "ferry" },
      });
      try {
        const draftOfScan = await storedDraft();
        const displayed = draftOfScan.dto.areas[0].legs.map((leg) => leg.mode);
        const plan = await prepareCommit(fx.userId, draftOfScan, body({ legModes: displayed }));
        const [write] = plan.existing?.roadtrips ?? [];
        expect(write.legModes[0]).toBeUndefined();
        expect(write.resetLegs).toEqual([]);
        expect(write.noop).toBe(false);
      } finally {
        await prisma.tripRouteLeg.updateMany({
          where: { routeId: fx.roadtripId, fromStopId: fx.station.a, toStopId: fx.station.b },
          data: { mode: "road" },
        });
      }
    });

    it("re-verifies the route inside the write: a station added after the plan is refused, not deleted", async () => {
      // The plan is validated against the trip as it was; between then and the
      // job's transaction the owner can add a station (the album preflight alone
      // is seconds). `replaceStationsInTx` deletes by omission, so without an
      // in-transaction re-read the new station would vanish with no error and no
      // diff line.
      const plan = await prepareCommit(fx.userId, await storedDraft(), body());
      const added = await addStation(fx.roadtripId, 4, {
        title: "Roadside camp",
        at: FX.southbridge,
        startDay: "2031-05-09",
        endDay: "2031-05-10",
        overnight: true,
      });

      await expect(writeCommit(plan)).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_CHANGED",
      });
      expect(await prisma.tripStop.findUnique({ where: { id: added } })).not.toBeNull();
      await prisma.tripStop.deleteMany({ where: { id: added } });
    });

    it("writes a renamed matched roadtrip's reviewed name in place", async () => {
      // The scan saw Northvale alone, so the station list is the stored one; only the
      // reviewed name differs, and it must reach the route row.
      const renamed = northvaleOnly();
      renamed.areas = renamed.areas.map((a) => ({ ...a, name: "Westshire circuit" }));
      const plan = await prepareCommit(
        fx.userId,
        await storedDraft(derivedStations().slice(0, 1)),
        renamed
      );
      expect(plan.existing?.roadtrips[0]).toMatchObject({
        name: "Westshire circuit",
        rename: true,
        // A rename alone rewrites no station: the write applies the name and stops.
        noop: true,
        diff: { updated: 1, unchanged: 1, added: 0, removed: 0, kept: 3 },
      });
      const written = await writeCommit(plan);
      expect(written.roadtrips.map((r) => [r.id, r.name])).toEqual([
        [fx.roadtripId, "Westshire circuit"],
      ]);
      const route = await prisma.tripRoute.findUniqueOrThrow({ where: { id: fx.roadtripId } });
      expect(route.name).toBe("Westshire circuit");
      await prisma.tripRoute.update({
        where: { id: fx.roadtripId },
        data: { name: "Northvale loop" },
      });
    });

    it("does not need two rows for a roadtrip that updates a stored one, because its kept stations are not rows", async () => {
      const plan = await prepareCommit(
        fx.userId,
        await storedDraft(derivedStations().slice(0, 1)),
        northvaleOnly()
      );
      expect(plan.existing?.roadtrips[0]).toMatchObject({ noop: true });
    });

    it("still holds a stored roadtrip to two stations, though its rows alone may be fewer", async () => {
      const single = northvaleOnly();
      const [onlyArea] = single.areas;
      const shrunk: CommitBody = {
        ...single,
        areas: [
          {
            ...onlyArea,
            keepNotSeen: [],
            removeNotSeen: [fx.station.b, fx.station.c, fx.station.s],
          },
        ],
      };
      await expect(
        prepareCommit(fx.userId, await storedDraft(derivedStations().slice(0, 1)), shrunk)
      ).rejects.toMatchObject({ statusCode: 400, code: "STATIONS_INVALID", field: "areas.0" });
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

  /**
   * The scan's stopover plan as `prepareCommit` builds it (spec 2026-10-11 §5.2):
   * station rows and album asset ids, server-side only. The re-sync split reads
   * `key` and `album`; the stations exist to keep the entry a real plan entry.
   */
  type StopoverWritePlan = NonNullable<CommitPlan["stopovers"]>[number];
  const stopoverPlan = (album: { name: string; assetIds: string[] } | null): StopoverWritePlan => {
    const day = toDbDate("2031-05-04");
    return {
      key: STOPOVER_KEY,
      roadtrip: {
        name: "Northvale 2031 Road Trip",
        vehicle: "car",
        stations: [
          {
            title: "ZZA Airport",
            lat: FX.northvale.lat,
            lon: FX.northvale.lon,
            startDate: day,
            endDate: day,
            notes: null,
            night: { kind: "pass" },
          },
          {
            title: "Northvale",
            lat: FX.southbridge.lat,
            lon: FX.southbridge.lon,
            startDate: day,
            endDate: day,
            notes: null,
            night: { kind: "pass" },
          },
        ],
      },
      album,
    };
  };

  /** The stored draft of a scan that found the fixture stopover. */
  async function storedDraftWithStopover(): Promise<StoredDraft> {
    return storedDraft(derivedStations(), { stopovers: [stopover()] });
  }

  /** A one-day roadtrip as a re-sync that already wrote the stopover leaves it; dropped after the test. */
  async function stopoverRoadtrip(): Promise<{ routeId: string; stationIds: string[] }> {
    const route = await prisma.tripRoute.create({
      data: {
        userId: fx.userId,
        tripId: fx.tripId,
        name: "Northvale 2031 Road Trip",
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
      },
      select: { id: true },
    });
    const stationIds: string[] = [
      await addStation(route.id, 0, {
        title: "ZZA Airport",
        at: FX.northvale,
        startDay: "2031-05-04",
        endDay: "2031-05-04",
      }),
      await addStation(route.id, 1, {
        title: "Northvale",
        at: FX.southbridge,
        startDay: "2031-05-04",
        endDay: "2031-05-04",
      }),
    ];
    return { routeId: route.id, stationIds };
  }

  async function dropStopoverRoadtrip(routeId: string): Promise<void> {
    await prisma.tripStop.deleteMany({ where: { routeId } });
    await prisma.tripRoute.delete({ where: { id: routeId } });
  }

  /**
   * The midnight-crossing stopover of finding S1: the flight lands 22:30 on 02 May
   * and the outing runs 23:30 → 07:30, so the tour's visit station spans 02→03 May
   * while `day` stays the first outing photo's (02 May).
   */
  const midnightStopover = (): DraftStopover =>
    stopover({
      day: "2031-05-02",
      title: "Elmwood 2031 Road Trip",
      stations: [
        derivedStation(
          "-894|3382|2031-05-02",
          "ZZA Airport",
          FX.northvale,
          "2031-05-02",
          "2031-05-02",
          { kind: "airport" }
        ),
        derivedStation(
          "-909|3382|2031-05-02",
          "Elmwood",
          FX.southbridge,
          "2031-05-02",
          "2031-05-03"
        ),
      ],
      legs: [
        {
          fromKey: "-894|3382|2031-05-02",
          toKey: "-909|3382|2031-05-02",
          chordKm: 52,
          routedKm: null,
          mode: "road",
          ferryEvidence: null,
        },
      ],
    });

  /** That roadtrip as the first sync wrote it: the airport on 02 May, the town across midnight. */
  async function midnightRoadtrip(): Promise<{ routeId: string; stationIds: string[] }> {
    const route = await prisma.tripRoute.create({
      data: {
        userId: fx.userId,
        tripId: fx.tripId,
        name: "Elmwood 2031 Road Trip",
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
      },
      select: { id: true },
    });
    const stationIds: string[] = [
      await addStation(route.id, 0, {
        title: "ZZA Airport",
        at: FX.northvale,
        startDay: "2031-05-02",
        endDay: "2031-05-02",
      }),
      await addStation(route.id, 1, {
        title: "Elmwood",
        at: FX.southbridge,
        startDay: "2031-05-02",
        endDay: "2031-05-03",
      }),
    ];
    return { routeId: route.id, stationIds };
  }

  const toggleOn = (): CommitBody["stopovers"] => [
    { key: STOPOVER_KEY, roadtrip: true, album: true },
  ];

  /** The same stopover as the scan stored it (spec §2.3): the DTO's fields plus the layover's photo set. */
  const storedStopover = (): StoredStopover => {
    const dto = stopover();
    return {
      key: dto.key,
      title: dto.title,
      city: dto.city,
      day: dto.day,
      // The key is `<inFlightId>#<outFlightId>` (both uuids), so it names the two flights.
      inFlightId: dto.key.slice(0, 36),
      outFlightId: dto.key.slice(37),
      airportIata: dto.airportIata,
      photoIds: ["photo-1", "photo-2"],
      stations: dto.stations,
      legs: dto.legs,
    };
  };

  it("moves a matched stopover out of the new-write path: album-only, nothing to rebuild", async () => {
    const { routeId, stationIds } = await stopoverRoadtrip();
    try {
      const scanned = await storedDraftWithStopover();
      const plan = await extendPlanForExisting(
        fx.userId,
        scanned,
        body({}, { stopovers: toggleOn() }),
        {
          ...basePlan(),
          stopovers: [
            stopoverPlan({ name: "Northvale 2031 Road Trip", assetIds: ["photo-1", "photo-2"] }),
          ],
        }
      );
      expect(plan.stopovers).toEqual([]);
      expect(plan.existing?.stopovers).toEqual([
        {
          key: STOPOVER_KEY,
          roadtripId: routeId,
          name: "Northvale 2031 Road Trip",
          offeredIds: stationIds,
          album: { name: "Northvale 2031 Road Trip", assetIds: ["photo-1", "photo-2"] },
        },
      ]);
      // The stored roadtrip is no new roadtrip's duplicate and no area write's target.
      expect((plan.existing?.roadtrips ?? []).map((w) => w.roadtripId)).not.toContain(routeId);
    } finally {
      await dropStopoverRoadtrip(routeId);
    }
  });

  it("re-claims a midnight-crossing stopover on a re-sync: no second roadtrip enters the write path", async () => {
    // Finding S1: the stored visit station spans 02→03 May while the stopover day
    // is the first outing photo's 02 May. A missed claim leaves the toggled
    // stopover in `plan.stopovers`, and phase B then writes a second identical
    // roadtrip for it — so the claim must run over the tour's own span.
    const { routeId, stationIds } = await midnightRoadtrip();
    try {
      const scanned = await storedDraft(derivedStations(), { stopovers: [midnightStopover()] });
      expect(scanned.dto.stopovers?.[0].stored?.roadtripId).toBe(routeId);
      const plan = await extendPlanForExisting(
        fx.userId,
        scanned,
        body({}, { stopovers: toggleOn() }),
        {
          ...basePlan(),
          stopovers: [stopoverPlan({ name: "Elmwood 2031 Road Trip", assetIds: ["photo-1"] })],
        }
      );
      expect(plan.stopovers).toEqual([]);
      expect(plan.existing?.stopovers).toEqual([
        {
          key: STOPOVER_KEY,
          roadtripId: routeId,
          name: "Elmwood 2031 Road Trip",
          offeredIds: stationIds,
          album: { name: "Elmwood 2031 Road Trip", assetIds: ["photo-1"] },
        },
      ]);
    } finally {
      await dropStopoverRoadtrip(routeId);
    }
  });

  it("answers 409 TRIP_CHANGED when a matched stopover's roadtrip gained a station after the scan", async () => {
    const { routeId } = await stopoverRoadtrip();
    try {
      const scanned = await storedDraftWithStopover();
      await addStation(routeId, 2, {
        title: "Stray stop",
        at: FX.portCarrow,
        startDay: "2031-05-04",
        endDay: "2031-05-04",
      });
      await expect(
        extendPlanForExisting(fx.userId, scanned, body({}, { stopovers: toggleOn() }), {
          ...basePlan(),
          stopovers: [stopoverPlan({ name: "Northvale 2031 Road Trip", assetIds: ["photo-1"] })],
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_CHANGED" });
    } finally {
      await dropStopoverRoadtrip(routeId);
    }
  });

  it("answers 409 TRIP_CHANGED when a matched stopover's roadtrip was renamed after the scan", async () => {
    const { routeId } = await stopoverRoadtrip();
    try {
      const scanned = await storedDraftWithStopover();
      await prisma.tripRoute.update({
        where: { id: routeId },
        data: { name: "Northvale 2031 City Tour" },
      });
      await expect(
        extendPlanForExisting(fx.userId, scanned, body({}, { stopovers: toggleOn() }), {
          ...basePlan(),
          stopovers: [stopoverPlan({ name: "Northvale 2031 Road Trip", assetIds: ["photo-1"] })],
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_CHANGED" });
    } finally {
      await dropStopoverRoadtrip(routeId);
    }
  });

  it("leaves a stopover with no stored match in the new-write path", async () => {
    const scanned = await storedDraftWithStopover();
    const plan = await extendPlanForExisting(
      fx.userId,
      scanned,
      body({}, { stopovers: toggleOn() }),
      {
        ...basePlan(),
        stopovers: [stopoverPlan({ name: "Northvale 2031 Road Trip", assetIds: ["photo-1"] })],
      }
    );
    expect(plan.stopovers).toHaveLength(1);
    expect(plan.existing?.stopovers).toEqual([]);
  });

  it("commits a matched stopover while roadtrips are hidden: only its album is written", async () => {
    // Finding S3-1b: the review cannot un-tick a synced stopover's locked switch,
    // and a matched stopover writes no roadtrip at all — so the hidden-domain gate
    // must not count it, or every re-sync of that trip is refused until the
    // owner switches the roadtrips module back on.
    const { routeId, stationIds } = await stopoverRoadtrip();
    try {
      const scanned: StoredDraft = {
        ...(await storedDraftWithStopover()),
        stopovers: [storedStopover()],
      };
      mockDomains.mockResolvedValue(["flight"]);
      const plan = await prepareCommit(
        fx.userId,
        scanned,
        body({}, { areas: [], nights: {}, stopovers: toggleOn() })
      );
      expect(plan.stopovers).toEqual([]);
      expect(plan.existing?.stopovers).toEqual([
        {
          key: STOPOVER_KEY,
          roadtripId: routeId,
          name: "Northvale 2031 Road Trip",
          offeredIds: stationIds,
          album: { name: "Northvale 2031 Road Trip", assetIds: ["photo-1", "photo-2"] },
        },
      ]);
      expect((plan.existing?.roadtrips ?? []).map((w) => w.roadtripId)).not.toContain(routeId);
    } finally {
      await dropStopoverRoadtrip(routeId);
    }
  });

  /**
   * The re-sync can also remove a station that was on the trip's timeline before
   * a roadtrip borrowed it (`PUT /trips/:id/routes/:routeId/stops`): it keeps its
   * `tripId`, and the write hands it back to the timeline rather than deleting it
   * — as a candidate stop, because nothing wraps it. Declared last: the success
   * case leaves the fixture's roadtrip as the write left it, and this describe's
   * `afterAll` drops the fixture user.
   */
  describe("a removed borrowed station", () => {
    /** A candidate stop the route editor borrowed into the fixture's roadtrip. */
    async function borrowSouthbridge(): Promise<string> {
      const id = await addStation(fx.roadtripId, 4, {
        title: "Southbridge camp",
        at: FX.southbridge,
        startDay: "2031-05-09",
        endDay: "2031-05-10",
        overnight: true,
      });
      await prisma.tripStop.update({
        where: { id },
        data: { tripId: fx.tripId, domain: null },
      });
      return id;
    }

    const removingBody = (borrowed: string): CommitBody =>
      body({ keepNotSeen: [fx.station.c], removeNotSeen: [borrowed] });

    it("still refuses a stop another writer adds while the plan waits", async () => {
      const borrowed = await borrowSouthbridge();
      const plan = await extendPlanForExisting(
        fx.userId,
        await storedDraft(),
        removingBody(borrowed),
        basePlan()
      );
      // The concurrent writer the guard exists for: the plan is a snapshot, and
      // the album preflight alone is seconds long. The release the write is about
      // to make must not blunt the refusal of a stop it never offered.
      const late = await prisma.tripStop.create({
        data: { tripId: fx.tripId, title: "Late stop", lat: -45.0, lon: 168.7 },
      });

      await expect(writeCommit(plan)).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_CHANGED",
      });
      // The refusal rolled the whole transaction back: the borrowed station is
      // where the plan found it, and nothing of the write survives.
      const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: borrowed } });
      expect(row.routeId).toBe(fx.roadtripId);
      await prisma.tripStop.deleteMany({ where: { id: { in: [late.id, borrowed] } } });
    });

    it("commits the removal: the released stop is expected, not refused as a change", async () => {
      const borrowed = await borrowSouthbridge();
      const plan = await extendPlanForExisting(
        fx.userId,
        await storedDraft(),
        removingBody(borrowed),
        basePlan()
      );
      const [write] = plan.existing?.roadtrips ?? [];
      expect(write.offeredIds).toContain(borrowed);
      expect(write.stations.map((station) => station.id)).not.toContain(borrowed);
      expect(write.diff.removed).toBe(1);

      const result = await writeCommit(plan);
      expect(result.roadtrips[0]).toMatchObject({ id: fx.roadtripId, stations: 5 });
      // Not deleted: it was on the trip's timeline before the roadtrip borrowed it.
      const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: borrowed } });
      expect(row).toMatchObject({ routeId: null, tripId: fx.tripId });
    });
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

  /** The scan-derived stops area for the fixture trip: `stations` is the whole area. */
  async function stopsDraftOf(stations: DraftStation[]): Promise<StoredDraft> {
    const stopsArea = area({ key: "2031-05-06#1", defaultAs: "stops", stations });
    const state = await loadExistingState(fx.userId, fx.tripId);
    const { dto, existing } = annotateDraftForExisting(
      draft(fx.tripId, [stopsArea]),
      { ...state, roadtrips: [] },
      new Map()
    );
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
      stopovers: [],
      pitstops: [],
      existing,
    };
  }

  /** `later` are the area's other ground stations, after the one that matches the stored museum stop. */
  const stopsDraft = (later: DraftStation[] = []): Promise<StoredDraft> =>
    stopsDraftOf([
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
      ...later,
    ]);

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
        album: false,
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

  /**
   * A `stops` area with two ground stations of different titles. The review shows it as one stop
   * (the first station's title, over the first to the last ground day), and the commit must write
   * that stop, not the first title's run alone with the rest added as new stops.
   */
  const library = (firstDay: string, lastDay: string): DraftStation =>
    derivedStation(
      "-911|3364|2031-05-07",
      "Kelmore Library",
      { lat: FX.kelmore.lat - 0.01, lon: FX.kelmore.lon },
      firstDay,
      lastDay,
      { notes: null }
    );

  /** The plan `prepareCommit` builds for that area: one stop per run of equal titles. */
  const twoTitlePlan = (libraryDays: [string, string]): CommitPlan => {
    const plan = stopsPlan();
    return {
      ...plan,
      stops: [
        ...plan.stops,
        {
          areaKey: "2031-05-06#1",
          title: "Kelmore Library",
          lat: FX.kelmore.lat - 0.01,
          lon: FX.kelmore.lon,
          startDay: libraryDays[0],
          endDay: libraryDays[1],
          notes: null,
        },
      ],
    };
  };

  const twoTitleBody = (libraryDays: [string, string]): CommitBody => {
    const body = stopsBody();
    body.areas[0].stations.push({
      key: "-911|3364|2031-05-07",
      title: "Kelmore Library",
      lat: FX.kelmore.lat - 0.01,
      lon: FX.kelmore.lon,
      kind: "visit",
      firstDay: libraryDays[0],
      lastDay: libraryDays[1],
    });
    return body;
  };

  it("writes a matched stops area as the one stop the review showed: first title, first to last ground day", async () => {
    const days: [string, string] = ["2031-05-07", "2031-05-08"];
    const plan = await extendPlanForExisting(
      fx.userId,
      await stopsDraft([library(...days)]),
      twoTitleBody(days),
      twoTitlePlan(days)
    );
    expect(plan.existing?.stopUpdates).toEqual([
      {
        areaKey: "2031-05-06#1",
        stopId: fx.stop.museum,
        title: "Kelmore Museum",
        notes: null,
        startDay: "2031-05-06",
        endDay: "2031-05-08",
      },
    ]);
    // the area's second title is part of that stop, not a new one
    expect(plan.stops).toEqual([]);
    expect(plan.existing?.stopsDiff).toEqual({
      updated: 1,
      unchanged: 0,
      added: 0,
      removed: 1,
      kept: 0,
    });
  });

  it("leaves a matched stops area alone, and adds nothing, when its first-to-last span is what is stored", async () => {
    const days: [string, string] = ["2031-05-06", "2031-05-06"];
    const body = twoTitleBody(days);
    body.areas[0].stations[0].lastDay = "2031-05-06";
    const same = twoTitlePlan(days);
    same.stops[0] = { ...same.stops[0], endDay: "2031-05-06" };
    const plan = await extendPlanForExisting(
      fx.userId,
      await stopsDraft([library(...days)]),
      body,
      same
    );
    expect(plan.existing?.stopUpdates).toEqual([]);
    expect(plan.stops).toEqual([]);
    expect(plan.existing?.stopsDiff).toMatchObject({ updated: 0, unchanged: 1, added: 0 });
  });

  it("refuses a matched stops area whose anchor is gone, rather than deleting or duplicating the stop", async () => {
    // The review's own Remove is off for that row (the anchor carries the stop's id),
    // so a body without the id is the delete the review does not offer. Before this
    // refusal the stored stop stayed while the anchor's title run was added again.
    const days: [string, string] = ["2031-05-07", "2031-05-08"];
    const scan = () => stopsDraft([library(...days)]);
    const deleted = twoTitleBody(days);
    deleted.areas[0].stations = deleted.areas[0].stations.filter(
      (s) => s.existingId !== fx.stop.museum
    );
    await expect(
      extendPlanForExisting(fx.userId, await scan(), deleted, twoTitlePlan(days))
    ).rejects.toMatchObject({ statusCode: 400, code: "DRAFT_MISMATCH", field: "stations" });

    const emptied = twoTitleBody(days);
    emptied.areas[0].stations = [];
    await expect(
      extendPlanForExisting(fx.userId, await scan(), emptied, twoTitlePlan(days))
    ).rejects.toMatchObject({ statusCode: 400, code: "DRAFT_MISMATCH", field: "stations" });
  });

  /**
   * An area with no stored match: the review draws it as the one stop `derivedStopOf`
   * makes of it — the first ground station's title over the first to the last ground
   * day — and the commit must write that stop, not one per run of equal titles.
   */
  const unmatchedBody = (): CommitBody => {
    const body = stopsBody();
    body.areas[0].name = "Kelmore Library";
    body.areas[0].stations = [
      {
        key: "-911|3364|2031-05-07",
        title: "Kelmore Library",
        lat: FX.kelmore.lat - 0.01,
        lon: FX.kelmore.lon,
        kind: "visit",
        firstDay: "2031-05-07",
        lastDay: "2031-05-08",
      },
      {
        key: "-911|3364|2031-05-08",
        title: "Kelmore Gallery",
        lat: FX.kelmore.lat - 0.02,
        lon: FX.kelmore.lon,
        kind: "visit",
        firstDay: "2031-05-08",
        lastDay: "2031-05-09",
      },
    ];
    // Nothing matched, so both stored stops are the scan's not-seen ones, kept here.
    body.stops = { keep: [fx.stop.museum, fx.stop.harbour], remove: [] };
    return body;
  };

  /** The plan `prepareCommit` builds for that area: one stop per run of equal titles. */
  const twoRunPlan = (): CommitPlan => ({
    ...stopsPlan(),
    stops: [
      {
        areaKey: "2031-05-06#1",
        title: "Kelmore Library",
        lat: FX.kelmore.lat - 0.01,
        lon: FX.kelmore.lon,
        startDay: "2031-05-07",
        endDay: "2031-05-08",
        notes: null,
      },
      {
        areaKey: "2031-05-06#1",
        title: "Kelmore Gallery",
        lat: FX.kelmore.lat - 0.02,
        lon: FX.kelmore.lon,
        startDay: "2031-05-08",
        endDay: "2031-05-09",
        notes: null,
      },
    ],
  });

  it("writes an unmatched stops area as the one stop the review showed, not one per title run", async () => {
    const plan = await extendPlanForExisting(
      fx.userId,
      await stopsDraftOf([
        library("2031-05-07", "2031-05-08"),
        derivedStation(
          "-911|3364|2031-05-08",
          "Kelmore Gallery",
          { lat: FX.kelmore.lat - 0.02, lon: FX.kelmore.lon },
          "2031-05-08",
          "2031-05-09",
          { notes: null }
        ),
      ]),
      unmatchedBody(),
      twoRunPlan()
    );
    expect(plan.stops).toEqual([
      {
        areaKey: "2031-05-06#1",
        title: "Kelmore Library",
        lat: FX.kelmore.lat - 0.01,
        lon: FX.kelmore.lon,
        startDay: "2031-05-07",
        endDay: "2031-05-09",
        notes: null,
      },
    ]);
    expect(plan.existing?.stopsDiff).toEqual({
      updated: 0,
      unchanged: 0,
      added: 1,
      removed: 0,
      kept: 2,
    });
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

  it("re-verifies the stops inside the write: one that moved into a roadtrip is refused", async () => {
    const plan = await extendPlanForExisting(
      fx.userId,
      await stopsDraft(),
      stopsBody(),
      stopsPlan()
    );
    // The plan updates the museum stop; between the plan and the job's transaction
    // the stop joined a roadtrip (the station editor does this). The plan's update
    // would not find it and would surface as a generic COMMIT_FAILED instead.
    await prisma.tripStop.update({
      where: { id: fx.stop.museum },
      data: { routeId: fx.roadtripId, routeOrderIdx: 4 },
    });

    await expect(writeCommit(plan)).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });
    const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.stop.museum } });
    expect(row.title).toBe("Kelmore Museum");
    await prisma.tripStop.update({
      where: { id: fx.stop.museum },
      data: { routeId: null, routeOrderIdx: null },
    });
  });

  it("re-verifies the stops inside the write: one added after the plan is refused", async () => {
    const plan = await extendPlanForExisting(
      fx.userId,
      await stopsDraft(),
      stopsBody(),
      stopsPlan()
    );
    const added = await prisma.tripStop.create({
      data: { tripId: fx.tripId, title: "Later stop", lat: -45.0, lon: 168.7 },
    });

    await expect(writeCommit(plan)).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });
    await prisma.tripStop.deleteMany({ where: { id: added.id } });
  });
});

describe("extendPlanForExisting: a pitstop that supersedes a stored stop", () => {
  let fx: ExistingFixture;
  beforeAll(async () => {
    fx = await createExistingFixture(`${USER}-pitstop`);
  });
  afterAll(async () => {
    await dropFixtureUser(`${USER}-pitstop`);
  });
  beforeEach(() => mockDomains.mockResolvedValue(["flight", "roadtrip"]));

  const STOP_AREA = "2031-05-06#1";
  const ANCHOR = "-908|3370|2031-05-06";
  const LIBRARY = "-911|3364|2031-05-07";
  const ALBUM = "Kelmore 2031 Road Trip (Northvale loop)";

  const anchor = (): DraftStation =>
    derivedStation(ANCHOR, "Kelmore Museum", FX.kelmore, "2031-05-06", "2031-05-07");
  const library = (): DraftStation =>
    derivedStation(
      LIBRARY,
      "Kelmore Library",
      { lat: FX.kelmore.lat - 0.01, lon: FX.kelmore.lon },
      "2031-05-07",
      "2031-05-08",
      { notes: null }
    );

  /** The stored draft the re-scan leaves: the stay is a pitstop, the stored stop is its predecessor. */
  async function pitstopDraft(
    defaultAs: DraftArea["defaultAs"] = "roadtrip"
  ): Promise<StoredDraft> {
    const stations = [anchor(), library()];
    const pitstopArea = area({
      key: STOP_AREA,
      defaultAs,
      pitstop: defaultAs === "roadtrip" ? { albumName: ALBUM } : undefined,
      stations,
    });
    const state = await loadExistingState(fx.userId, fx.tripId);
    const { dto, existing } = annotateDraftForExisting(
      draft(fx.tripId, [pitstopArea]),
      {
        ...state,
        // No stored roadtrip is the area's: the stay is held as the museum stop.
        roadtrips: [],
      },
      new Map()
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
        stations.map((s) => [
          s.key,
          { areaKey: STOP_AREA, firstDay: s.firstDay, lastDay: s.lastDay },
        ])
      ),
      stopovers: [],
      pitstops: [fixtureStoredPitstop({ key: STOP_AREA, albumName: ALBUM, day: "2031-05-06" })],
      existing,
    };
  }

  const bodyStation = (s: DraftStation): CommitBody["areas"][number]["stations"][number] => ({
    key: s.key,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    kind: "visit",
    firstDay: s.firstDay,
    lastDay: s.lastDay,
  });

  /** The body the review sends for the conversion: the roadtrip, its album, no stored station. */
  const convertedBody = (over: Partial<CommitBody> = {}): CommitBody => ({
    commitKey: COMMIT_KEY,
    window: { startDay: "2031-05-02", endDay: "2031-05-09" },
    target: { kind: "existing", tripId: fx.tripId, applyWindow: false },
    flightIds: [],
    nights: {},
    areas: [
      {
        key: STOP_AREA,
        as: "roadtrip",
        name: ALBUM,
        vehicle: "car",
        homeStart: false,
        homeEnd: false,
        stations: [bodyStation(anchor()), bodyStation(library())],
        legModes: ["road"],
        album: true,
      },
    ],
    stopovers: [],
    photoJourneyIds: [],
    // The one stop no area claims: the harbour, kept.
    stops: { keep: [fx.stop.harbour], remove: [] },
    album: { create: false, name: ALBUM },
    ...over,
  });

  const emptyPlan = (): CommitPlan => ({
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
    roadtrips: [],
    stopovers: [],
    photoJourneyIds: [],
    album: { create: false, name: ALBUM },
    unknownNights: 0,
  });

  it("plans the new roadtrip and the removal of the stop it supersedes, in one plan", async () => {
    const plan = await prepareCommit(fx.userId, await pitstopDraft(), convertedBody());
    // The roadtrip cannot adopt a stored stop: the stop is the removal the
    // conversion owes, on the same path a not-seen stop's remove takes.
    expect(plan.roadtrips.map((r) => r.areaKey)).toEqual([STOP_AREA]);
    expect(plan.roadtrips[0].album).toEqual({ name: ALBUM, assetIds: ["photo-a", "photo-b"] });
    expect(plan.stops).toEqual([]);
    expect(plan.existing?.stopUpdates).toEqual([]);
    expect(plan.existing?.stopRemoveIds).toEqual([fx.stop.museum]);
    expect(plan.existing?.stopsDiff).toEqual({
      updated: 0,
      unchanged: 0,
      added: 0,
      removed: 1,
      kept: 1,
    });
  });

  it("refuses an ordinary matched stop turned into a roadtrip: only a pitstop supersedes its stop", async () => {
    // The same area without the pitstop marking: the F1 guard's server twin.
    // Left unchecked the body would add the roadtrip and leave the stop behind
    // — the same stay twice, which is the defect this unit exists for.
    const plain = await pitstopDraft("stops");
    await expect(
      extendPlanForExisting(fx.userId, plain, convertedBody(), emptyPlan())
    ).rejects.toMatchObject({ statusCode: 400, code: "DRAFT_MISMATCH", field: "stations" });
  });

  it("answers 409 TRIP_CHANGED when the superseded stop moved by the time the write runs", async () => {
    const plan = await prepareCommit(fx.userId, await pitstopDraft(), convertedBody());
    await prisma.tripStop.update({
      where: { id: fx.stop.museum },
      data: { routeId: fx.roadtripId, routeOrderIdx: 4 },
    });
    try {
      await expect(writeCommit(plan)).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_CHANGED",
      });
      // The whole transaction rolled back: the roadtrip the plan would have
      // written is not there either.
      expect(await prisma.tripRoute.count({ where: { tripId: fx.tripId, name: ALBUM } })).toBe(0);
    } finally {
      await prisma.tripStop.update({
        where: { id: fx.stop.museum },
        data: { routeId: null, routeOrderIdx: null },
      });
    }
  });

  it("commits both in one transaction: the roadtrip appears, the stop it supersedes is gone", async () => {
    const plan = await prepareCommit(fx.userId, await pitstopDraft(), convertedBody());
    const result = await writeCommit(plan);
    const route = await prisma.tripRoute.findFirstOrThrow({
      where: { tripId: fx.tripId, name: ALBUM },
    });
    const stops = await prisma.tripStop.findMany({
      where: { routeId: route.id, viaPoint: false },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(stops.map((s) => s.title)).toEqual(["Kelmore Museum", "Kelmore Library"]);
    expect(await prisma.tripStop.findUnique({ where: { id: fx.stop.museum } })).toBeNull();
    expect(result.stopsDiff?.removed).toBe(1);
    // One transaction: the trip's own timeline keeps the stop no area claimed.
    expect(await prisma.tripStop.findUnique({ where: { id: fx.stop.harbour } })).not.toBeNull();
  });
});
