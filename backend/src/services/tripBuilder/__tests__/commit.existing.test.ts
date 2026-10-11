jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import { prisma } from "../../../db";
import { setClockForTests } from "../../../shared/time/clock";
import { toDbDate } from "../../../shared/time/localDate";
import { hashPassword } from "../../../utils/password";
import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import { runCommitJob, writeCommit } from "../commit";
import { beginCommit, clearDraftsForTests, putDraft } from "../draftStore";
import type { ExistingCommitPlan, ExistingRoadtripWrite } from "../existingTypes";
import type { CommitPlan } from "../types";
import { COMMIT_KEY, CREATED_AT, DRAFT_ID, fixtureDraft, fixturePlan } from "./commitFixtures";
import {
  addStation,
  createExistingFixture,
  dropFixtureUser,
  FX,
  type ExistingFixture,
} from "./existingDb";

// Synthetic fixtures only (public repository).
const USER = "m7k-commit";
const STOPOVER_KEY = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f#1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";

type Night = ExistingRoadtripWrite["stations"][number]["night"];
const day = (d: string) => toDbDate(d);

describe("writeCommit for an existing trip", () => {
  let fx: ExistingFixture;

  beforeEach(async () => {
    (resolveRouteProvider as jest.Mock).mockResolvedValue(null);
    fx = await createExistingFixture(USER);
  });
  afterEach(async () => {
    setClockForTests(null);
    clearDraftsForTests();
    await dropFixtureUser(USER);
  });

  const station = (
    id: string | undefined,
    title: string,
    at: { lat: number; lon: number },
    start: string,
    end: string,
    night: Night,
    notes: string | null = null
  ): ExistingRoadtripWrite["stations"][number] => ({
    id,
    title,
    lat: at.lat,
    lon: at.lon,
    startDate: day(start),
    endDate: day(end),
    notes,
    night,
  });

  function plan(
    over: Partial<ExistingCommitPlan> = {},
    target: Partial<Extract<CommitPlan["target"], { kind: "existing" }>> = {}
  ): CommitPlan {
    const existing: ExistingCommitPlan = {
      tripId: fx.tripId,
      offeredStopIds: [fx.stop.museum, fx.stop.harbour],
      roadtrips: [],
      stopovers: [],
      stopUpdates: [],
      stopRemoveIds: [],
      stopsDiff: { updated: 0, unchanged: 0, added: 0, removed: 0, kept: 0 },
      album: { removeOutside: false },
      ...over,
    };
    return {
      draftId: DRAFT_ID,
      userId: fx.userId,
      window: { startDay: "2031-05-02", endDay: "2031-05-09" },
      target: {
        kind: "existing",
        tripId: fx.tripId,
        tripName: "Northvale loop",
        applyWindow: false,
        countries: ["NZ"],
        ...target,
      },
      flightIds: [],
      stops: [],
      roadtrips: [],
      photoJourneyIds: [],
      album: { create: false, name: "Northvale loop" },
      unknownNights: 0,
      existing,
    };
  }

  const write = (
    stations: ExistingRoadtripWrite["stations"],
    over: Partial<ExistingRoadtripWrite> = {}
  ): ExistingRoadtripWrite => ({
    areaKey: "2031-05-02#1",
    roadtripId: fx.roadtripId,
    name: "Northvale loop",
    // The name the fixture's route carries when every plan here was "built".
    expectedName: "Northvale loop",
    rename: false,
    stations,
    // The fixture route holds these four: what every plan in this file offered.
    offeredIds: Object.values(fx.station),
    legModes: stations.slice(1).map(() => undefined),
    resetLegs: [],
    noop: false,
    diff: { updated: 1, unchanged: 0, added: 0, removed: 0, kept: 0 },
    ...over,
  });

  const stored = async () =>
    prisma.tripStop.findMany({
      where: { routeId: fx.roadtripId },
      orderBy: { routeOrderIdx: "asc" },
    });
  const legs = async () => prisma.tripRouteLeg.findMany({ where: { routeId: fx.roadtripId } });

  /**
   * A stop the route editor borrowed from the trip's timeline into the roadtrip
   * (`PUT /trips/:id/routes/:routeId/stops`): it keeps its `tripId`, and only a
   * domain can wrap it. A write that drops it hands it back to the timeline
   * instead of deleting it (`replaceStationsInTx`), so it becomes a candidate
   * stop again. The fixture's own stations are trip-owned throughout: removal
   * deletes them, which is why none of the other tests meets a release.
   */
  async function borrowedStation(title: string, domain: string | null = null): Promise<string> {
    const id = await addStation(fx.roadtripId, 4, {
      title,
      at: FX.southbridge,
      startDay: "2031-05-09",
      endDay: "2031-05-10",
      overnight: true,
    });
    await prisma.tripStop.update({
      where: { id },
      data: { tripId: fx.tripId, domain },
    });
    return id;
  }

  /** The fixture's four stations written back as they are, with `borrowed` left out. */
  const writeWithout = (borrowed: string) => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    return write(
      [
        station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
        station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", { kind: "pass" }),
        station(
          c,
          "Kelmore",
          FX.kelmore,
          "2031-05-06",
          "2031-05-07",
          { kind: "free" },
          "Quiet street"
        ),
        station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
          kind: "stay",
          lodgingStayId: fx.stayId,
        }),
      ],
      {
        offeredIds: [...Object.values(fx.station), borrowed],
        diff: { updated: 0, unchanged: 4, added: 0, removed: 1, kept: 0 },
      }
    );
  };

  it("hands a removed borrowed station back to the timeline, instead of refusing its own release", async () => {
    // The dropped station keeps its `tripId`, so the write releases it (routeId
    // null) rather than deleting it, and a released stop nothing wraps reads as a
    // candidate stop. That new candidate is this transaction's own doing: the
    // stop re-check must expect it, or the removal can never commit — a fresh
    // scan would produce the same plan and the same refusal, forever.
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    const borrowed = await borrowedStation("Southbridge camp");
    const result = await writeCommit(plan({ roadtrips: [writeWithout(borrowed)] }));
    const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: borrowed } });
    expect(row).toMatchObject({ routeId: null, tripId: fx.tripId });
    expect((await stored()).map((r) => r.id)).toEqual([a, b, c, s]);
    expect(result.roadtrips[0]).toMatchObject({ id: fx.roadtripId, stations: 4 });
  });

  it("releases a removed borrowed station nothing re-scans as a candidate, and expects no new stop", async () => {
    // A wrapped station (a domain) is not a candidate stop: releasing it must not
    // make the stop set check expect an id its candidates read will never show,
    // which would refuse the removal for the opposite reason.
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    const borrowed = await borrowedStation("Tarnside inn", "hotel");
    await writeCommit(plan({ roadtrips: [writeWithout(borrowed)] }));
    const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: borrowed } });
    expect(row).toMatchObject({ routeId: null, tripId: fx.tripId, domain: "hotel" });
    expect((await stored()).map((r) => r.id)).toEqual([a, b, c, s]);
  });

  it("keeps station ids and routed legs when a station only changes its dates", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    await writeCommit(
      plan({
        roadtrips: [
          write([
            station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
            station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-07", { kind: "pass" }),
            station(
              c,
              "Kelmore",
              FX.kelmore,
              "2031-05-07",
              "2031-05-08",
              { kind: "free" },
              "Quiet street"
            ),
            station(s, "Tarnside Lodge", FX.tarnside, "2031-05-08", "2031-05-09", {
              kind: "stay",
              lodgingStayId: fx.stayId,
            }),
          ]),
        ],
      })
    );
    const rows = await stored();
    expect(rows.map((r) => r.id)).toEqual([a, b, c, s]);
    expect(rows[1].endDate?.toISOString().slice(0, 10)).toBe("2031-05-07");
    const after = await legs();
    expect(after).toHaveLength(3);
    expect(after.every((l) => l.source === "routed" && l.mode === "road")).toBe(true);
  });

  it("renames a matched roadtrip to the reviewed name, and reports it in the result", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    const result = await writeCommit(
      plan({
        roadtrips: [
          write(
            [
              station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
              station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", {
                kind: "pass",
              }),
              station(
                c,
                "Kelmore",
                FX.kelmore,
                "2031-05-06",
                "2031-05-07",
                { kind: "free" },
                "Quiet street"
              ),
              station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
                kind: "stay",
                lodgingStayId: fx.stayId,
              }),
            ],
            {
              name: "Westshire circuit",
              rename: true,
              diff: { updated: 1, unchanged: 4, added: 0, removed: 0, kept: 0 },
            }
          ),
        ],
      })
    );
    const route = await prisma.tripRoute.findUniqueOrThrow({ where: { id: fx.roadtripId } });
    expect(route.name).toBe("Westshire circuit");
    expect(result.roadtrips[0]).toMatchObject({
      id: fx.roadtripId,
      name: "Westshire circuit",
    });
  });

  it("refuses TRIP_CHANGED when the route was renamed after the plan, and writes neither name nor station", async () => {
    // A pure rename (`noop`) skips the station guard entirely, so the rename is
    // the one write the transaction must re-check itself: another tab can rename
    // the roadtrip while the job preflights Immich, and the stale reviewed name
    // must not clobber the newer one. The conditional update is keyed on the
    // name the plan read, so a rename since answers the scan-again refusal.
    const before = (await stored()).map((row) => row.id);
    const renameOnly = write([], {
      name: "Westshire circuit",
      rename: true,
      noop: true,
      diff: { updated: 1, unchanged: 4, added: 0, removed: 0, kept: 0 },
    });
    await prisma.tripRoute.update({
      where: { id: fx.roadtripId },
      data: { name: "Renamed elsewhere" },
    });
    await expect(writeCommit(plan({ roadtrips: [renameOnly] }))).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });
    const route = await prisma.tripRoute.findUniqueOrThrow({ where: { id: fx.roadtripId } });
    expect(route.name).toBe("Renamed elsewhere");
    expect((await stored()).map((row) => row.id)).toEqual(before);
  });

  it("answers TRIP_CHANGED when the route is gone, not the generic failure a Prisma not-found gives", async () => {
    // The route deleted between the plan and the transaction: the conditional
    // rename matches nothing. Without the count check the write dies as a Prisma
    // not-found, which `runCommitJob` flattens into COMMIT_FAILED — a failure
    // the page cannot mend with a new scan.
    const renameOnly = write([], {
      name: "Westshire circuit",
      rename: true,
      noop: true,
      diff: { updated: 1, unchanged: 4, added: 0, removed: 0, kept: 0 },
    });
    await prisma.tripRoute.delete({ where: { id: fx.roadtripId } });
    await expect(writeCommit(plan({ roadtrips: [renameOnly] }))).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });
  });

  it("adds a new station between two stored ones and keeps the legs it does not touch", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    const result = await writeCommit(
      plan({
        roadtrips: [
          write(
            [
              station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
              station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", {
                kind: "pass",
              }),
              station(undefined, "Southbridge", FX.southbridge, "2031-05-06", "2031-05-06", {
                kind: "pass",
              }),
              station(
                c,
                "Kelmore",
                FX.kelmore,
                "2031-05-06",
                "2031-05-07",
                { kind: "free" },
                "Quiet street"
              ),
              station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
                kind: "stay",
                lodgingStayId: fx.stayId,
              }),
            ],
            { diff: { updated: 0, unchanged: 4, added: 1, removed: 0, kept: 0 } }
          ),
        ],
      })
    );
    const rows = await stored();
    expect(rows.map((r) => r.title)).toEqual([
      "Northvale",
      "Port Carrow",
      "Southbridge",
      "Kelmore",
      "Tarnside Lodge",
    ]);
    expect(rows.filter((r) => [a, b, c, s].includes(r.id))).toHaveLength(4);
    const byPair = new Map((await legs()).map((l) => [`${l.fromStopId}>${l.toStopId}`, l]));
    expect(byPair.get(`${a}>${b}`)?.source).toBe("routed");
    expect(byPair.get(`${c}>${s}`)?.source).toBe("routed");
    expect(byPair.has(`${b}>${c}`)).toBe(false);
    const newId = rows[2].id;
    expect(byPair.get(`${b}>${newId}`)?.source).toBe("straight");
    expect(byPair.get(`${newId}>${c}`)?.source).toBe("straight");
    const summary = result.roadtrips[0];
    expect(summary.createdLegs).toHaveLength(2);
    expect(summary.diff).toEqual({ updated: 0, unchanged: 4, added: 1, removed: 0, kept: 0 });
  });

  it("deletes a station that was left out, and joins its neighbours with a straight leg", async () => {
    const [a, b, , s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    await writeCommit(
      plan({
        roadtrips: [
          write(
            [
              station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
              station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", {
                kind: "pass",
              }),
              station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
                kind: "stay",
                lodgingStayId: fx.stayId,
              }),
            ],
            { diff: { updated: 0, unchanged: 3, added: 0, removed: 1, kept: 0 } }
          ),
        ],
      })
    );
    const rows = await stored();
    expect(rows.map((r) => r.id)).toEqual([a, b, s]);
    expect(await prisma.tripStop.findUnique({ where: { id: fx.station.c } })).toBeNull();
    const pairs = (await legs()).map((l) => `${l.fromStopId}>${l.toStopId}:${l.source}`);
    expect(pairs).toContain(`${a}>${b}:routed`);
    expect(pairs).toContain(`${b}>${s}:straight`);
  });

  it("writes a kept not-seen station back exactly as it was", async () => {
    const before = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.station.c } });
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    await writeCommit(
      plan({
        roadtrips: [
          write([
            station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-05", { kind: "free" }),
            station(b, "Port Carrow", FX.portCarrow, "2031-05-05", "2031-05-06", { kind: "pass" }),
            station(
              c,
              "Kelmore",
              FX.kelmore,
              "2031-05-06",
              "2031-05-07",
              { kind: "free" },
              "Quiet street"
            ),
            station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
              kind: "stay",
              lodgingStayId: fx.stayId,
            }),
          ]),
        ],
      })
    );
    const after = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.station.c } });
    expect(after).toMatchObject({
      title: before.title,
      notes: before.notes,
      overnight: before.overnight,
      lodgingStayId: before.lodgingStayId,
      lat: before.lat,
      lon: before.lon,
    });
    expect(after.startDate).toEqual(before.startDate);
    expect(after.endDate).toEqual(before.endDate);
  });

  it("preserves a stay's night when the dates around it change", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    await writeCommit(
      plan({
        roadtrips: [
          write([
            station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
            station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", { kind: "pass" }),
            station(
              c,
              "Kelmore",
              FX.kelmore,
              "2031-05-06",
              "2031-05-07",
              { kind: "free" },
              "Quiet street"
            ),
            station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-10", {
              kind: "stay",
              lodgingStayId: fx.stayId,
            }),
          ]),
        ],
      })
    );
    const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.station.s } });
    expect(row).toMatchObject({ lodgingStayId: fx.stayId, overnight: true });
    expect(row.endDate?.toISOString().slice(0, 10)).toBe("2031-05-10");
  });

  it("resets a leg whose mode the user changed, and sets the mode", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    const result = await writeCommit(
      plan({
        roadtrips: [
          write(
            [
              station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
              station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", {
                kind: "pass",
              }),
              station(
                c,
                "Kelmore",
                FX.kelmore,
                "2031-05-06",
                "2031-05-07",
                { kind: "free" },
                "Quiet street"
              ),
              station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
                kind: "stay",
                lodgingStayId: fx.stayId,
              }),
            ],
            {
              legModes: ["ferry", undefined, undefined],
              resetLegs: [{ fromStopId: a, toStopId: b }],
            }
          ),
        ],
      })
    );
    const leg = (await legs()).find((l) => l.fromStopId === a && l.toStopId === b);
    expect(leg).toMatchObject({ mode: "ferry", source: "straight" });
    expect(result.roadtrips[0].ferryLegs).toBe(1);
    expect(result.roadtrips[0].createdLegs).toEqual([{ fromStopId: a, toStopId: b }]);
  });

  it("answers 409 TRIP_CHANGED for a mode meant for a leg another write kept, and writes nothing", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    // A stale snapshot: the leg A>B is stored and not reset, so a ferry mode for
    // it would leave a ferry carrying a road's geometry. The plan is no longer
    // the trip's, so the commit answers TRIP_CHANGED (a new scan mends it) rather
    // than the create-only 400 the station editor gives; the date change made in
    // the same write must roll back with it.
    await expect(
      writeCommit(
        plan({
          roadtrips: [
            write(
              [
                station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-05", {
                  kind: "free",
                }),
                station(b, "Port Carrow", FX.portCarrow, "2031-05-05", "2031-05-06", {
                  kind: "pass",
                }),
                station(
                  c,
                  "Kelmore",
                  FX.kelmore,
                  "2031-05-06",
                  "2031-05-07",
                  { kind: "free" },
                  "Quiet street"
                ),
                station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
                  kind: "stay",
                  lodgingStayId: fx.stayId,
                }),
              ],
              { legModes: ["ferry", undefined, undefined] }
            ),
          ],
        })
      )
    ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_CHANGED" });
    const leg = (await legs()).find((l) => l.fromStopId === a && l.toStopId === b);
    expect(leg).toMatchObject({ mode: "road", source: "routed" });
    const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: a } });
    expect(row.endDate?.toISOString().slice(0, 10)).toBe("2031-05-04");
  });

  it("writes nothing for a roadtrip marked as unchanged", async () => {
    const before = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.station.a } });
    const result = await writeCommit(
      plan({
        roadtrips: [
          write([], {
            noop: true,
            diff: { updated: 0, unchanged: 4, added: 0, removed: 0, kept: 0 },
          }),
        ],
      })
    );
    const after = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.station.a } });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(result.roadtrips[0]).toMatchObject({ id: fx.roadtripId, stations: 4, createdLegs: [] });
  });

  it("counts the nights of the stations it wrote, read back after the write", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    // Stored: A two nights and C one night make three (B passes through, and the
    // fixture's stay carries no dates or night count, so it adds none). Extending
    // A by a night must show in the figure, which a count taken before the write,
    // from the plan, or a fixed number would miss.
    const result = await writeCommit(
      plan({
        roadtrips: [
          write([
            station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-05", { kind: "free" }),
            station(b, "Port Carrow", FX.portCarrow, "2031-05-05", "2031-05-06", {
              kind: "pass",
            }),
            station(
              c,
              "Kelmore",
              FX.kelmore,
              "2031-05-06",
              "2031-05-07",
              { kind: "free" },
              "Quiet street"
            ),
            station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
              kind: "stay",
              lodgingStayId: fx.stayId,
            }),
          ]),
        ],
      })
    );
    expect(result.roadtrips[0]).toMatchObject({ stations: 4, nights: 4 });
  });

  it("updates the trip's dates and countries, as for any existing trip", async () => {
    await writeCommit(plan({}, { applyWindow: true, countries: ["NZ", "AU"] }));
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: fx.tripId } });
    expect(trip.startDay?.toISOString().slice(0, 10)).toBe("2031-05-02");
    expect(trip.endDay?.toISOString().slice(0, 10)).toBe("2031-05-09");
    expect(trip.countries.sort()).toEqual(["AU", "NZ"]);
  });

  it("updates a changed timeline stop's dates only, and deletes the one the user removed", async () => {
    const before = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.stop.museum } });
    const result = await writeCommit(
      plan({
        stopUpdates: [
          {
            areaKey: "2031-05-06#1",
            stopId: fx.stop.museum,
            title: "Kelmore Museum",
            notes: null,
            startDay: "2031-05-06",
            endDay: "2031-05-07",
          },
        ],
        stopRemoveIds: [fx.stop.harbour],
        stopsDiff: { updated: 1, unchanged: 0, added: 0, removed: 1, kept: 0 },
      })
    );
    const after = await prisma.tripStop.findUniqueOrThrow({ where: { id: fx.stop.museum } });
    expect(after.lat).toBe(before.lat);
    expect(after.endDate?.toISOString().slice(0, 10)).toBe("2031-05-07");
    expect(await prisma.tripStop.findUnique({ where: { id: fx.stop.harbour } })).toBeNull();
    expect(result.stopsDiff).toEqual({ updated: 1, unchanged: 0, added: 0, removed: 1, kept: 0 });
  });

  it("never deletes a stop of another trip or one that sits in a roadtrip", async () => {
    const inRoadtrip = await addStation(fx.roadtripId, 4, {
      title: "Camp",
      at: FX.southbridge,
      startDay: "2031-05-09",
      endDay: "2031-05-10",
      overnight: true,
    });
    // A station that was on the trip's timeline before it joined the roadtrip keeps its tripId.
    await prisma.tripStop.update({ where: { id: inRoadtrip }, data: { tripId: fx.tripId } });
    const other = await prisma.trip.create({ data: { userId: fx.userId, name: "Other trip" } });
    const foreign = await prisma.tripStop.create({
      data: { tripId: other.id, title: "Elsewhere", lat: -45.1, lon: 168.9, orderIdx: 0 },
      select: { id: true },
    });
    await writeCommit(plan({ stopRemoveIds: [inRoadtrip, foreign.id] }));
    expect(await prisma.tripStop.findUnique({ where: { id: inRoadtrip } })).not.toBeNull();
    expect(await prisma.tripStop.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  it("answers the diff of each roadtrip and of the timeline stops in the commit result", async () => {
    const [a, b, c, s] = [fx.station.a, fx.station.b, fx.station.c, fx.station.s];
    const draft = fixtureDraft(fx.userId, [], { createdAt: CREATED_AT });
    setClockForTests(new Date(CREATED_AT + 60_000));
    putDraft(draft);
    beginCommit(fx.userId, DRAFT_ID, COMMIT_KEY);
    const roadtripDiff = { updated: 0, unchanged: 4, added: 1, removed: 0, kept: 0 };
    const stopsDiff = { updated: 0, unchanged: 1, added: 0, removed: 1, kept: 0 };

    const result = await runCommitJob(
      draft,
      plan({
        roadtrips: [
          write(
            [
              station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
              station(b, "Port Carrow", FX.portCarrow, "2031-05-04", "2031-05-06", {
                kind: "pass",
              }),
              station(undefined, "Southbridge", FX.southbridge, "2031-05-06", "2031-05-06", {
                kind: "pass",
              }),
              station(
                c,
                "Kelmore",
                FX.kelmore,
                "2031-05-06",
                "2031-05-07",
                { kind: "free" },
                "Quiet street"
              ),
              station(s, "Tarnside Lodge", FX.tarnside, "2031-05-07", "2031-05-09", {
                kind: "stay",
                lodgingStayId: fx.stayId,
              }),
            ],
            { diff: roadtripDiff }
          ),
        ],
        stopRemoveIds: [fx.stop.harbour],
        stopsDiff,
      })
    );

    expect(result).toMatchObject({
      status: "committed",
      created: false,
      tripId: fx.tripId,
      roadtrips: [{ id: fx.roadtripId, stations: 5, diff: roadtripDiff }],
      stops: stopsDiff,
      routing: { routed: 0, straight: 2, ferry: 0, providerAvailable: false },
    });
  });

  it("rolls everything back when a write fails", async () => {
    const [a] = [fx.station.a];
    const broken = write([
      station(a, "Northvale", FX.northvale, "2031-05-02", "2031-05-04", { kind: "free" }),
      station(
        "99999999-9999-4999-8999-999999999999",
        "Ghost",
        FX.kelmore,
        "2031-05-04",
        "2031-05-05",
        {
          kind: "free",
        }
      ),
    ]);
    await expect(
      writeCommit(
        plan(
          { roadtrips: [broken], stopRemoveIds: [fx.stop.harbour] },
          { applyWindow: true, countries: ["NZ", "AU"] }
        )
      )
    ).rejects.toBeDefined();
    expect(await prisma.tripStop.findUnique({ where: { id: fx.stop.harbour } })).not.toBeNull();
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: fx.tripId } })).countries).toEqual([
      "NZ",
    ]);
    expect((await stored()).map((r) => r.id)).toEqual([
      fx.station.a,
      fx.station.b,
      fx.station.c,
      fx.station.s,
    ]);
  });

  /** A one-day roadtrip as a re-sync that already wrote the stopover leaves it. */
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

  it("leaves a matched stopover's roadtrip as stored: no station write, no second roadtrip", async () => {
    const { routeId, stationIds } = await stopoverRoadtrip();
    const rows = () =>
      prisma.tripStop.findMany({ where: { routeId }, orderBy: { routeOrderIdx: "asc" } });
    const before = await rows();
    await writeCommit(
      plan({
        stopovers: [
          {
            key: STOPOVER_KEY,
            roadtripId: routeId,
            name: "Northvale 2031 Road Trip",
            offeredIds: stationIds,
            album: { name: "Northvale 2031 Road Trip", assetIds: ["photo-1"] },
          },
        ],
      })
    );
    const after = await rows();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after.map((row) => row.endDate?.toISOString().slice(0, 10))).toEqual(
      before.map((row) => row.endDate?.toISOString().slice(0, 10))
    );
    const named = await prisma.tripRoute.findMany({
      where: { tripId: fx.tripId, name: "Northvale 2031 Road Trip" },
      select: { id: true },
    });
    expect(named.map((route) => route.id)).toEqual([routeId]);
  });

  it("answers 409 TRIP_CHANGED when a matched stopover's roadtrip moved since the scan", async () => {
    const { routeId, stationIds } = await stopoverRoadtrip();
    await addStation(routeId, 2, {
      title: "Stray stop",
      at: FX.portCarrow,
      startDay: "2031-05-04",
      endDay: "2031-05-04",
    });
    await expect(
      writeCommit(
        plan({
          stopovers: [
            {
              key: STOPOVER_KEY,
              roadtripId: routeId,
              name: "Northvale 2031 Road Trip",
              offeredIds: stationIds,
              album: null,
            },
          ],
        })
      )
    ).rejects.toMatchObject({ code: "TRIP_CHANGED" });
  });

  it("keeps a stored stopover roadtrip through an empty-window re-sync: nothing pruned, nothing duplicated", async () => {
    // Review Focus 3 (plan 2026-10-11): the re-scan found no photos, so its
    // flights-only plan knows no area, no stop and no stopover — the stored
    // roadtrip must survive untouched and no second one may appear.
    const { routeId, stationIds } = await stopoverRoadtrip();
    const rows = () =>
      prisma.tripStop.findMany({ where: { routeId }, orderBy: { routeOrderIdx: "asc" } });
    const routes = () =>
      prisma.tripRoute.findMany({ where: { tripId: fx.tripId }, select: { id: true } });
    const before = await rows();
    const beforeRoutes = (await routes()).map((route) => route.id).sort();
    await writeCommit({ ...plan(), stopovers: [] });
    const after = await rows();
    expect(after.map((row) => row.id)).toEqual(stationIds);
    expect(after.map((row) => row.title)).toEqual(before.map((row) => row.title));
    expect(after.map((row) => row.startDate?.toISOString().slice(0, 10))).toEqual(
      before.map((row) => row.startDate?.toISOString().slice(0, 10))
    );
    const afterRoutes = (await routes()).map((route) => route.id).sort();
    expect(afterRoutes).toEqual(beforeRoutes);
  });
});

// Task 99's cases: what `writeCommit` does for the existing target when the plan carries
// `stops` and `roadtrips` to add (no `existing` block): the trip's days, countries and flights.
describe("writeCommit, existing trip", () => {
  let userId: string;
  let tripId: string;
  let oldTripId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-commit-existing" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-commit-existing", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Spring trip",
          startDate: day("2031-05-03"),
          endDate: day("2031-05-04"),
          startDay: day("2031-05-03"),
          endDay: day("2031-05-04"),
          countries: ["AU"],
        },
      })
    ).id;
    await prisma.tripStop.create({
      data: { tripId, title: "Hand-made stop", lat: -45.0, lon: 168.6, orderIdx: 0 },
    });
    oldTripId = (await prisma.trip.create({ data: { userId, name: "Old trip" } })).id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          tripId: oldTripId,
          flightNumber: "ZZ101",
          depLat: -44.72,
          depLon: 169.17,
          arrLat: -38.02,
          arrLon: 177.01,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const existing = (applyWindow: boolean) => ({
    kind: "existing" as const,
    tripId,
    tripName: "Spring trip",
    applyWindow,
    countries: ["AU", "NZ"],
  });

  it("moves the trip's days to the window, unions its countries and adds to what it already holds", async () => {
    const written = await writeCommit(fixturePlan(userId, [flightId], existing(true)));

    expect(written).toMatchObject({
      tripId,
      created: false,
      flightsAssigned: 1,
      flightsMovedFrom: [{ tripId: oldTripId, name: "Old trip" }],
    });
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.startDate?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(trip.endDate?.toISOString()).toBe("2031-05-05T00:00:00.000Z");
    expect(trip.startDay?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2031-05-05T00:00:00.000Z");
    expect(trip.countries).toEqual(["AU", "NZ"]);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBe(
      tripId
    );

    const stops = await prisma.tripStop.findMany({
      where: { tripId },
      orderBy: { orderIdx: "asc" },
    });
    expect(stops.map((s) => [s.title, s.orderIdx])).toEqual([
      ["Hand-made stop", 0],
      ["Selby Bay day", 1],
    ]);
    expect(await prisma.tripRoute.count({ where: { tripId, kind: "roadtrip" } })).toBe(1);
  });

  it("leaves the trip's own days alone unless asked to apply the window", async () => {
    await writeCommit(fixturePlan(userId, [], existing(false)));
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.startDate?.toISOString()).toBe("2031-05-03T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2031-05-04T00:00:00.000Z");
    expect(trip.countries).toEqual(["AU", "NZ"]);
  });

  it("keeps the flights it was not asked to move where they are", async () => {
    await writeCommit(fixturePlan(userId, [], existing(true)));
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBe(
      oldTripId
    );
  });
});
