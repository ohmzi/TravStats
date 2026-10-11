jest.mock("../../immich/immichClient", () => ({ createImmichClient: jest.fn() }));
jest.mock("../../immich/immichResolver", () => ({ getImmichConnection: jest.fn() }));
jest.mock("../../immich/immichAssetCache", () => ({ invalidateAlbumAssets: jest.fn() }));
jest.mock("../../home/homeStore", () => ({ loadHomePeriods: jest.fn() }));
jest.mock("../loadFlights", () => ({ loadFlights: jest.fn() }));
jest.mock("../collect", () => ({ collectWindow: jest.fn() }));

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { loadHomePeriods } from "../../home/homeStore";
import { createImmichClient } from "../../immich/immichClient";
import { getImmichConnection } from "../../immich/immichResolver";
import { ImmichError } from "../../immich/types";
import { retryTripAlbum } from "../albumWrite";
import { collectWindow } from "../collect";

const ME = "0b6f3a52-5d1c-4f43-9c1e-6a7b8c9d0e1f";
const userConn = { baseUrl: "http://immich.test", apiKey: "key", source: "user" as const };
const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const client = {
  whoami: jest.fn(),
  getMyApiKey: jest.fn(),
  findOwnedAlbumByName: jest.fn(),
  createAlbum: jest.fn(),
  addAssetsToAlbum: jest.fn(),
  getAlbum: jest.fn(),
  getAlbumInfo: jest.fn(),
  listAlbumAssets: jest.fn(),
  removeAssetsFromAlbum: jest.fn(),
};

describe("retryTripAlbum", () => {
  let userId: string;
  let strangerId: string;
  let tripId: string;

  /** The trip links an album whose name differs from the trip's (spec §K.3: the first owned linked album). */
  const linkAlbum = async (): Promise<void> => {
    await prisma.tripImmichAlbum.create({
      data: {
        tripId,
        immichAlbumId: "al-linked",
        albumName: "Port Carrow tour",
        mode: "link",
        sortIdx: 0,
      },
    });
  };

  /** The collected window the removal computation reads: context photos outside [S, E]. */
  const collectedWindow = (context: string[] = []): void => {
    (collectWindow as jest.Mock).mockResolvedValue({
      clean: { albumAssetIds: ["a1", "a2"], context: context.map((id) => ({ id })) },
      window: { fetchFrom: day("2031-05-01"), fetchTo: day("2031-05-07") },
    });
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tb-retry", "tb-retry-2"] } } });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    userId = (await make("tb-retry")).id;
    strangerId = (await make("tb-retry-2")).id;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Northvale loop",
          startDate: day("2031-05-02"),
          endDate: day("2031-05-06"),
          startDay: day("2031-05-02"),
          endDay: day("2031-05-06"),
        },
      })
    ).id;
    (getImmichConnection as jest.Mock).mockResolvedValue(userConn);
    (createImmichClient as jest.Mock).mockReturnValue(client);
    (loadHomePeriods as jest.Mock).mockResolvedValue([]);
    collectedWindow();
    client.whoami.mockResolvedValue({ id: ME, email: "me@example.test", name: "Me" });
    client.getMyApiKey.mockResolvedValue({ permissions: ["all"] });
    client.findOwnedAlbumByName.mockResolvedValue(null);
    client.createAlbum.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 0,
      thumbnailAssetId: null,
    });
    client.addAssetsToAlbum.mockResolvedValue({ added: 2, duplicate: 0, refused: [] });
    client.getAlbum.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 2,
      thumbnailAssetId: "a1",
    });
    client.getAlbumInfo.mockResolvedValue({
      id: "al-linked",
      albumName: "Port Carrow tour",
      description: "TravStats trip · 2031-05-02 – 2031-05-06",
      ownerId: ME,
      assetCount: 2,
      thumbnailAssetId: "a1",
    });
    client.listAlbumAssets.mockResolvedValue([]);
    client.removeAssetsFromAlbum.mockResolvedValue({ removed: 0 });
  });

  afterEach(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  it("rebuilds the asset list from the trip's own days and links the album", async () => {
    const outcome = await retryTripAlbum(userId, tripId, undefined);

    const [, input] = (collectWindow as jest.Mock).mock.calls[0];
    expect(input).toMatchObject({
      immichUserId: ME,
      startDay: "2031-05-02",
      endDay: "2031-05-06",
      targetTripId: tripId,
    });
    expect(client.createAlbum).toHaveBeenCalledWith({
      albumName: "Northvale loop",
      description: "TravStats trip · 2031-05-02 – 2031-05-06",
    });
    expect(client.addAssetsToAlbum).toHaveBeenCalledWith("album-1", ["a1", "a2"]);
    expect(outcome).toMatchObject({ status: "linked", immichAlbumId: "album-1", added: 2 });
    expect(await prisma.tripImmichAlbum.count({ where: { tripId } })).toBe(1);
  });

  it("names the album as asked", async () => {
    await retryTripAlbum(userId, tripId, "Northvale photos");
    expect(client.createAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ albumName: "Northvale photos" })
    );
  });

  it("is idempotent: a second retry finds the album, hears 'duplicate' and keeps one link", async () => {
    await retryTripAlbum(userId, tripId, undefined);
    client.findOwnedAlbumByName.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 2,
      thumbnailAssetId: "a1",
    });
    client.addAssetsToAlbum.mockResolvedValue({ added: 0, duplicate: 2, refused: [] });

    const second = await retryTripAlbum(userId, tripId, undefined);

    expect(second).toMatchObject({ status: "linked", reused: true, added: 0, alreadyIn: 2 });
    expect(await prisma.tripImmichAlbum.count({ where: { tripId } })).toBe(1);
  });

  it("re-syncs the linked album instead of making a second one by the posted name", async () => {
    // The success panel posts the album's name, which an existing-trip scan
    // sets to the trip's own name (frontend/src/lib/tripBuilder/draftEdits.ts).
    // The trip links an album with a different name, so a by-name
    // find-or-create would make a second album and link it too (final review,
    // finding N4-3); spec §K.3 updates the linked one.
    await linkAlbum();
    collectedWindow();

    const outcome = await retryTripAlbum(userId, tripId, "Northvale loop");

    expect(client.findOwnedAlbumByName).not.toHaveBeenCalled();
    expect(client.createAlbum).not.toHaveBeenCalled();
    expect(client.addAssetsToAlbum).toHaveBeenCalledWith("al-linked", ["a1", "a2"]);
    expect(outcome).toMatchObject({
      status: "linked",
      immichAlbumId: "al-linked",
      albumName: "Port Carrow tour",
      reused: true,
      added: 2,
    });
    expect(await prisma.tripImmichAlbum.count({ where: { tripId } })).toBe(1);
  });

  it("runs the review's removal on the linked album, with the ids the server proved outside", async () => {
    await linkAlbum();
    collectedWindow(["late-1"]);
    client.listAlbumAssets.mockResolvedValue([
      { id: "a1", fileCreatedAt: "2031-05-02T10:00:00.000Z" },
      { id: "late-1", fileCreatedAt: "2031-05-06T10:00:00.000Z" },
    ]);
    client.addAssetsToAlbum.mockResolvedValue({ added: 1, duplicate: 0, refused: [] });
    client.removeAssetsFromAlbum.mockResolvedValue({ removed: 1 });

    const outcome = await retryTripAlbum(userId, tripId, undefined, true);

    expect(client.removeAssetsFromAlbum).toHaveBeenCalledWith("al-linked", ["late-1"]);
    expect(outcome).toMatchObject({ status: "linked", added: 1, removed: 1 });
  });

  it("leaves the linked album's members alone when the review did not tick the removal", async () => {
    await linkAlbum();
    collectedWindow(["late-1"]);
    client.listAlbumAssets.mockResolvedValue([
      { id: "a1", fileCreatedAt: "2031-05-02T10:00:00.000Z" },
      { id: "late-1", fileCreatedAt: "2031-05-06T10:00:00.000Z" },
    ]);
    client.addAssetsToAlbum.mockResolvedValue({ added: 1, duplicate: 0, refused: [] });

    const outcome = await retryTripAlbum(userId, tripId, undefined, false);

    expect(client.removeAssetsFromAlbum).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "linked", removed: 0 });
  });

  it("skips a trip with no days of its own without reading the library", async () => {
    const dateless = await prisma.trip.create({ data: { userId, name: "Dateless" } });
    expect(await retryTripAlbum(userId, dateless.id, undefined)).toEqual({
      status: "skipped",
      skipReason: "noAssets",
    });
    expect(collectWindow).not.toHaveBeenCalled();
  });

  it("reports a blocked connection as an outcome, not an exception", async () => {
    (getImmichConnection as jest.Mock).mockResolvedValue({ ...userConn, source: "global" });
    expect(await retryTripAlbum(userId, tripId, undefined)).toEqual({
      status: "blocked",
      error: { kind: "notConfigured" },
    });

    (getImmichConnection as jest.Mock).mockResolvedValue(userConn);
    client.getMyApiKey.mockResolvedValue({ permissions: ["album.read"] });
    expect(await retryTripAlbum(userId, tripId, undefined)).toEqual({
      status: "blocked",
      missingScopes: ["album.create", "albumAsset.create"],
      error: { kind: "auth", missingScope: "album.create" },
    });

    client.getMyApiKey.mockRejectedValue(new ImmichError("unreachable", "down"));
    expect(await retryTripAlbum(userId, tripId, undefined)).toEqual({
      status: "blocked",
      error: { kind: "unreachable" },
    });
  });

  it("reports an Immich failure while reading the library as a failed outcome", async () => {
    (collectWindow as jest.Mock).mockRejectedValue(new ImmichError("unreachable", "down"));
    expect(await retryTripAlbum(userId, tripId, undefined)).toEqual({
      status: "failed",
      error: { kind: "unreachable" },
    });
  });

  it("answers 404 for a trip that is not the caller's", async () => {
    const theirs = await prisma.trip.create({ data: { userId: strangerId, name: "Theirs" } });
    await expect(retryTripAlbum(userId, theirs.id, undefined)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
