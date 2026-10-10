import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";
import {
  addStation,
  createExistingFixture,
  dropFixtureUser,
  type ExistingFixture,
} from "./existingDb";
import { loadAlbumLinks, loadExistingState } from "../existingState";

const USER = "m7k-state";
const STRANGER = "m7k-state-stranger";

describe("loadExistingState", () => {
  let fx: ExistingFixture;
  let stranger: ExistingFixture;

  beforeAll(async () => {
    fx = await createExistingFixture(USER);
    stranger = await createExistingFixture(STRANGER);
  });

  afterAll(async () => {
    await dropFixtureUser(USER);
    await dropFixtureUser(STRANGER);
    await prisma.$disconnect();
  });

  it("reads the trip, its dates and the countries it names", async () => {
    const state = await loadExistingState(fx.userId, fx.tripId);
    expect(state).toMatchObject({
      tripId: fx.tripId,
      tripName: "Northvale loop",
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      countries: ["NZ"],
      flightIds: [fx.flightId],
    });
  });

  it("reads each roadtrip station with its days and its night", async () => {
    const [roadtrip] = (await loadExistingState(fx.userId, fx.tripId)).roadtrips;
    expect(roadtrip.id).toBe(fx.roadtripId);
    expect(
      roadtrip.stations.map((s) => [
        s.id,
        s.title,
        s.startDate,
        s.endDate,
        s.night,
        s.lodgingStayId,
      ])
    ).toEqual([
      [fx.station.a, "Northvale", "2031-05-02", "2031-05-04", "free", null],
      [fx.station.b, "Port Carrow", "2031-05-04", "2031-05-06", "pass", null],
      [fx.station.c, "Kelmore", "2031-05-06", "2031-05-07", "free", null],
      [fx.station.s, "Tarnside Lodge", "2031-05-07", "2031-05-09", "stay", fx.stayId],
    ]);
    expect(roadtrip.stations[2].notes).toBe("Quiet street");
  });

  it("reads the legs with their mode and source", async () => {
    const [roadtrip] = (await loadExistingState(fx.userId, fx.tripId)).roadtrips;
    expect(roadtrip.legs).toHaveLength(3);
    expect(roadtrip.legs.every((l) => l.mode === "road" && l.source === "routed")).toBe(true);
  });

  it("keeps a route correction in the station list", async () => {
    const via = await addStation(fx.roadtripId, 4, {
      title: "",
      at: { lat: -45.21, lon: 169.41 },
      startDay: null,
      endDay: null,
      viaPoint: true,
    });
    const [roadtrip] = (await loadExistingState(fx.userId, fx.tripId)).roadtrips;
    expect(roadtrip.stations.at(-1)).toMatchObject({ id: via, night: "via", startDate: null });
    await prisma.tripStop.delete({ where: { id: via } });
  });

  it("lists only the timeline stops a re-sync may touch", async () => {
    await prisma.tripStop.create({
      data: { tripId: fx.tripId, title: "Hotel booking", domain: "hotel", lat: -45.0, lon: 168.7 },
    });
    await prisma.tripStop.create({
      data: {
        tripId: fx.tripId,
        title: "Wrapped flight",
        sourceId: fx.flightId,
        lat: -45.0,
        lon: 168.7,
      },
    });
    const state = await loadExistingState(fx.userId, fx.tripId);
    expect(state.stops.map((s) => [s.id, s.title, s.startDay, s.endDay]).sort()).toEqual(
      [
        [fx.stop.museum, "Kelmore Museum", "2031-05-06", "2031-05-06"],
        [fx.stop.harbour, "Port Carrow Harbour", "2031-05-04", "2031-05-04"],
      ].sort()
    );
  });

  it("describes the linked albums through the injected lookup, and says unknown when it fails", async () => {
    const owned = await loadAlbumLinks(fx.userId, fx.tripId, async () => ({
      ownedByUser: true,
      travstatsMarker: true,
    }));
    expect(owned).toEqual([
      {
        linkId: fx.linkId,
        immichAlbumId: "9a1b2c3d-0000-4000-8000-000000000001",
        albumName: "Northvale loop",
        assetCount: 40,
        ownedByUser: true,
        travstatsMarker: true,
      },
    ]);
    const warned = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    const unknown = await loadAlbumLinks(fx.userId, fx.tripId, async () => {
      throw new Error("immich unreachable");
    });
    expect(unknown[0]).toMatchObject({ ownedByUser: null, travstatsMarker: null });
    expect(warned).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "tripBuilder.existing.describeAlbum" }),
      expect.any(String)
    );
    warned.mockRestore();
    const undescribed = await loadAlbumLinks(fx.userId, fx.tripId);
    expect(undescribed[0]).toMatchObject({ ownedByUser: null, travstatsMarker: null });
  });

  it("ignores albums that were copied in rather than linked", async () => {
    await prisma.tripImmichAlbum.create({
      data: {
        tripId: fx.tripId,
        immichAlbumId: "9a1b2c3d-0000-4000-8000-000000000002",
        albumName: "Copied",
        mode: "import",
        sortIdx: 1,
      },
    });
    const links = await loadAlbumLinks(fx.userId, fx.tripId);
    expect(links.map((l) => l.albumName)).toEqual(["Northvale loop"]);
  });

  it("answers 404 for a trip that is not the caller's", async () => {
    await expect(loadExistingState(fx.userId, stranger.tripId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(loadExistingState(fx.userId, stranger.tripId)).rejects.toBeInstanceOf(AppError);
  });
});
