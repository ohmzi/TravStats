jest.mock("../../immich/immichClient", () => ({ createImmichClient: jest.fn() }));
jest.mock("../../immich/immichResolver", () => ({ getImmichConnection: jest.fn() }));
jest.mock("../../immich/immichAssetCache", () => ({ invalidateAlbumAssets: jest.fn() }));

import { prisma } from "../../../db";
import { setClockForTests } from "../../../shared/time/clock";
import logger from "../../../utils/logger";
import { hashPassword } from "../../../utils/password";
import { invalidateAlbumAssets } from "../../immich/immichAssetCache";
import { createImmichClient } from "../../immich/immichClient";
import { getImmichConnection } from "../../immich/immichResolver";
import { ImmichError } from "../../immich/types";
import { albumDescription, preflightAlbum, writeTripAlbum } from "../albumWrite";

const mockCreateClient = createImmichClient as jest.Mock;
const mockConnection = getImmichConnection as jest.Mock;
const ME = "0b6f3a52-5d1c-4f43-9c1e-6a7b8c9d0e1f";
const FULL = ["album.read", "album.create", "albumAsset.create", "user.read"];
const userConn = { baseUrl: "http://immich.test", apiKey: "key", source: "user" as const };

const client = {
  whoami: jest.fn(),
  getMyApiKey: jest.fn(),
  findOwnedAlbumByName: jest.fn(),
  createAlbum: jest.fn(),
  addAssetsToAlbum: jest.fn(),
  getAlbum: jest.fn(),
};

describe("albumDescription", () => {
  it("marks the album as TravStats' own with the trip's days", () => {
    expect(albumDescription("2031-05-02", "2031-05-09")).toBe(
      "TravStats trip · 2031-05-02 – 2031-05-09"
    );
  });
});

describe("preflightAlbum", () => {
  let warned: jest.SpyInstance;
  let errored: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warned = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    errored = jest.spyOn(logger, "error").mockImplementation(() => logger);
    mockConnection.mockResolvedValue(userConn);
    mockCreateClient.mockReturnValue(client);
    client.whoami.mockResolvedValue({ id: ME, email: "me@example.test", name: "Me" });
    client.getMyApiKey.mockResolvedValue({ permissions: FULL });
  });

  afterEach(() => {
    warned.mockRestore();
    errored.mockRestore();
  });

  const blocked = (reason: string, missingScopes: string[] = []) => ({
    ok: false,
    blocked: { status: "blocked", reason, missingScopes },
  });

  it("passes for the user's own connection with the same Immich user and the album scopes", async () => {
    const result = await preflightAlbum("u1", ME);
    expect(result).toMatchObject({ ok: true, immichUserId: ME });
    expect(mockCreateClient).toHaveBeenCalledWith(userConn, { timeoutMs: 4000 });
  });

  it("is blocked, without asking Immich, when the connection is gone or shared", async () => {
    mockConnection.mockResolvedValue(null);
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("connectionChanged"));
    mockConnection.mockResolvedValue({ ...userConn, source: "global" });
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("sharedConnection"));
    expect(client.whoami).not.toHaveBeenCalled();
  });

  it("is blocked when the key now belongs to another Immich user", async () => {
    client.whoami.mockResolvedValue({ id: "someone-else", email: "x", name: "X" });
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("connectionChanged"));
  });

  it("is blocked and names the album scopes the key lacks", async () => {
    client.getMyApiKey.mockResolvedValue({ permissions: ["album.read", "user.read"] });
    expect(await preflightAlbum("u1", ME)).toEqual(
      blocked("missingScopes", ["album.create", "albumAsset.create"])
    );
  });

  it("is blocked when Immich names a missing scope, or does not answer", async () => {
    client.whoami.mockRejectedValue(
      new ImmichError("auth", "rejected", 403, { missingScope: "user.read" })
    );
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("missingScopes", ["user.read"]));
    client.whoami.mockRejectedValue(new ImmichError("auth", "rejected", 401));
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("connectionChanged"));
    client.whoami.mockRejectedValue(new ImmichError("unreachable", "down"));
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("unreachable"));
  });

  it("lets an unverifiable key through: the write will say if it cannot", async () => {
    client.getMyApiKey.mockResolvedValue(null);
    expect(await preflightAlbum("u1", ME)).toMatchObject({ ok: true });
  });

  it("leaves the operator a warning when Immich does not answer", async () => {
    client.whoami.mockRejectedValue(
      new ImmichError("unreachable", "Immich is unreachable (GET /users/me)", 503)
    );
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("unreachable"));
    expect(warned).toHaveBeenCalledWith(
      {
        operation: "trip_builder.preflight_failed",
        kind: "unreachable",
        status: 503,
        error: "Immich is unreachable (GET /users/me)",
      },
      expect.any(String)
    );
    expect(errored).not.toHaveBeenCalled();
  });

  it.each(["protocol", "notFound", "invalidUrl"] as const)(
    "tells the operator it was a '%s' failure, not an outage, though the user hears 'unreachable'",
    async (kind) => {
      client.getMyApiKey.mockRejectedValue(new ImmichError(kind, `Immich said ${kind}`, 502));
      expect(await preflightAlbum("u1", ME)).toEqual(blocked("unreachable"));
      expect(warned).toHaveBeenCalledWith(
        {
          operation: "trip_builder.preflight_failed",
          kind,
          status: 502,
          error: `Immich said ${kind}`,
        },
        expect.any(String)
      );
      expect(errored).not.toHaveBeenCalled();
    }
  );

  it("logs an error, not a warning, when the server itself threw", async () => {
    mockConnection.mockRejectedValue(new Error("could not decrypt the stored key"));
    expect(await preflightAlbum("u1", ME)).toEqual(blocked("unreachable"));
    expect(errored).toHaveBeenCalledWith(
      {
        operation: "trip_builder.preflight_failed",
        error: "could not decrypt the stored key",
      },
      expect.any(String)
    );
    expect(warned).not.toHaveBeenCalled();
  });

  it("does not log an auth answer: that is the user's key, not a fault", async () => {
    client.whoami.mockRejectedValue(new ImmichError("auth", "rejected", 401));
    await preflightAlbum("u1", ME);
    expect(warned).not.toHaveBeenCalled();
    expect(errored).not.toHaveBeenCalled();
  });
});

describe("writeTripAlbum", () => {
  let userId: string;
  let tripId: string;
  let warned: jest.SpyInstance;
  let errored: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-album" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-album", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    warned = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    errored = jest.spyOn(logger, "error").mockImplementation(() => logger);
    setClockForTests("2031-05-20T08:30:00Z");
    tripId = (await prisma.trip.create({ data: { userId, name: "Northvale loop" } })).id;
    client.findOwnedAlbumByName.mockResolvedValue(null);
    client.createAlbum.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 0,
      thumbnailAssetId: null,
    });
    client.addAssetsToAlbum.mockResolvedValue({ added: 3, duplicate: 0, refused: [] });
    client.getAlbum.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 3,
      thumbnailAssetId: "a1",
    });
  });

  afterEach(async () => {
    warned.mockRestore();
    errored.mockRestore();
    setClockForTests(null);
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const write = (assetIds: string[] = ["a1", "a2", "a3"]) =>
    writeTripAlbum({
      userId,
      tripId,
      albumName: "Northvale loop",
      description: albumDescription("2031-05-02", "2031-05-09"),
      assetIds,
      client: client as never,
      immichUserId: ME,
    });
  const links = () => prisma.tripImmichAlbum.findMany({ where: { tripId } });

  it("creates the album empty, adds the assets, links it in link mode and drops the cached listing", async () => {
    const outcome = await write();

    expect(client.createAlbum).toHaveBeenCalledWith({
      albumName: "Northvale loop",
      description: "TravStats trip · 2031-05-02 – 2031-05-09",
    });
    expect(client.addAssetsToAlbum).toHaveBeenCalledWith("album-1", ["a1", "a2", "a3"]);
    expect(outcome).toEqual({
      status: "linked",
      immichAlbumId: "album-1",
      albumName: "Northvale loop",
      reused: false,
      added: 3,
      alreadyIn: 0,
      refused: 0,
    });
    expect(await links()).toMatchObject([
      {
        immichAlbumId: "album-1",
        albumName: "Northvale loop",
        assetCount: 3,
        thumbnailAssetId: "a1",
        mode: "link",
        sortIdx: 0,
      },
    ]);
    expect(invalidateAlbumAssets).toHaveBeenCalledWith(userId, "album-1");
  });

  it("reuses an album the user already owns under that exact name", async () => {
    client.findOwnedAlbumByName.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 9,
      thumbnailAssetId: null,
    });
    const outcome = await write();
    expect(client.createAlbum).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "linked", reused: true });
    expect(client.findOwnedAlbumByName).toHaveBeenCalledWith("Northvale loop", ME);
  });

  it("is idempotent: a retry hears 'duplicate', adds nothing and keeps one link", async () => {
    await write();
    client.findOwnedAlbumByName.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 3,
      thumbnailAssetId: "a1",
    });
    client.addAssetsToAlbum.mockResolvedValue({ added: 0, duplicate: 3, refused: [] });

    const second = await write();

    expect(second).toMatchObject({ status: "linked", reused: true, added: 0, alreadyIn: 3 });
    expect(await links()).toHaveLength(1);
  });

  it("appends the new link after the trip's other albums", async () => {
    await prisma.tripImmichAlbum.create({
      data: { tripId, immichAlbumId: "older", albumName: "Older", assetCount: 1, sortIdx: 4 },
    });
    await write();
    const linked = await prisma.tripImmichAlbum.findFirstOrThrow({
      where: { tripId, immichAlbumId: "album-1" },
    });
    expect(linked.sortIdx).toBe(5);
  });

  it("counts the assets Immich refused", async () => {
    client.addAssetsToAlbum.mockResolvedValue({
      added: 2,
      duplicate: 0,
      refused: [{ id: "a3", error: "no_permission" }],
    });
    expect(await write()).toMatchObject({ status: "linked", added: 2, refused: 1 });
  });

  it("skips an album with nothing to add without calling Immich", async () => {
    expect(await write([])).toEqual({ status: "skipped", skipReason: "noAssets" });
    expect(client.createAlbum).not.toHaveBeenCalled();
    expect(await links()).toHaveLength(0);
  });

  it("reports an Immich refusal with the scope it named, and writes no link", async () => {
    client.addAssetsToAlbum.mockRejectedValue(
      new ImmichError("auth", "rejected", 403, { missingScope: "albumAsset.create" })
    );
    expect(await write()).toEqual({
      status: "failed",
      error: { kind: "auth", missingScope: "albumAsset.create" },
    });
    expect(await links()).toHaveLength(0);
  });

  it.each(["unreachable", "protocol", "notFound", "auth"] as const)(
    "leaves a '%s' failure in the log with its kind and status, and nothing that names an asset",
    async (kind) => {
      client.addAssetsToAlbum.mockRejectedValue(
        new ImmichError(kind, "Immich refused a1 with the key", 502)
      );
      expect(await write()).toMatchObject({ status: "failed", error: { kind } });
      expect(warned).toHaveBeenCalledWith(
        { operation: "trip_builder.album_failed", kind, status: 502 },
        expect.any(String)
      );
      expect(errored).not.toHaveBeenCalled();
    }
  );

  it("reports anything else as an internal failure instead of throwing", async () => {
    client.getAlbum.mockRejectedValue(new Error("boom"));
    expect(await write()).toEqual({ status: "failed", error: { kind: "internal" } });
    expect(errored).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "trip_builder.album_failed", error: "boom" }),
      "Writing the trip album failed"
    );
    expect(warned).not.toHaveBeenCalled();
  });
});
