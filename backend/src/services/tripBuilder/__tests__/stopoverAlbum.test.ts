jest.mock("../../immich/immichClient", () => ({ createImmichClient: jest.fn() }));
jest.mock("../../immich/immichResolver", () => ({ getImmichConnection: jest.fn() }));
jest.mock("../../immich/immichAssetCache", () => ({ invalidateAlbumAssets: jest.fn() }));

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { createImmichClient } from "../../immich/immichClient";
import { getImmichConnection } from "../../immich/immichResolver";
import type { ImmichAsset } from "../../immich/types";
import type { ResyncClient } from "../albumResync";
import { retryStopoverAlbum, stopoverAlbumDescription, writeStopoverAlbum } from "../stopoverAlbum";

const ME = "0b6f3a52-5d1c-4f43-9c1e-6a7b8c9d0e1f";
const OTHER = "1c7a4b63-6e2d-4a54-a2f3-7b8c9d0e1f2a";
const TRIP = "Northvale loop";
const CITY = "Port Carrow 2031 Road Trip";
const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

interface FakeAlbum {
  id: string;
  albumName: string;
  description: string;
  ownerId: string;
}

const member = (id: string): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2031-05-03T09:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat: null,
  lon: null,
});

/** Fake album as the user owns them; `members` is album id → its asset ids. */
function fakeClient(init: {
  albums?: FakeAlbum[];
  members?: Record<string, string[]>;
}): ResyncClient & { whoami: jest.Mock } {
  const albums = init.albums ?? [];
  const members = init.members ?? {};
  const albumOf = (id: string): FakeAlbum => {
    const album = albums.find((candidate) => candidate.id === id);
    if (album === undefined) throw new Error(`no album ${id}`);
    return album;
  };
  return {
    findOwnedAlbumByName: jest.fn(
      async (name: string) => albums.find((album) => album.albumName === name) ?? null
    ),
    getAlbumInfo: jest.fn(async (id: string) => {
      const album = albumOf(id);
      return {
        id: album.id,
        albumName: album.albumName,
        description: album.description,
        ownerId: album.ownerId,
        assetCount: (members[id] ?? []).length,
        thumbnailAssetId: null,
      };
    }),
    listAlbumAssets: jest.fn(async (id: string) => (members[id] ?? []).map(member)),
    getMyApiKey: jest.fn(async () => ({ permissions: ["all"] })),
    createAlbum: jest.fn(async (input: { albumName: string; description: string }) => {
      const created = {
        id: `al-created-${albums.length}`,
        albumName: input.albumName,
        description: input.description,
        ownerId: ME,
      };
      albums.push(created);
      return {
        id: created.id,
        albumName: created.albumName,
        assetCount: 0,
        thumbnailAssetId: null,
      };
    }),
    addAssetsToAlbum: jest.fn(async (id: string, ids: readonly string[]) => {
      const held = members[id] ?? (members[id] = []);
      const added = ids.filter((assetId) => !held.includes(assetId));
      held.push(...added);
      return { added: added.length, duplicate: ids.length - added.length, refused: [] };
    }),
    removeAssetsFromAlbum: jest.fn(async () => ({ removed: 0 })),
    setAlbumDescription: jest.fn(async (id: string, description: string) => {
      albumOf(id).description = description;
    }),
    whoami: jest.fn(async () => ({ id: ME, email: "me@example.test", name: "Me" })),
  };
}

describe("writeStopoverAlbum", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-city-album" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-city-album", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: TRIP,
          startDate: day("2031-05-02"),
          endDate: day("2031-05-06"),
          startDay: day("2031-05-02"),
          endDay: day("2031-05-06"),
        },
      })
    ).id;
    await prisma.tripImmichAlbum.create({
      data: { tripId, immichAlbumId: "al-main", albumName: TRIP, mode: "link", sortIdx: 0 },
    });
  });

  afterEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const write = (client: ResyncClient, assetIds: readonly string[] = ["photo-a", "photo-b"]) =>
    writeStopoverAlbum({
      userId,
      tripId,
      tripName: TRIP,
      name: CITY,
      day: "2031-05-03",
      assetIds,
      client,
      immichUserId: ME,
    });

  it("writes the exact TravStats trip marker and the album's name as its description", () => {
    expect(stopoverAlbumDescription(CITY)).toBe("TravStats trip · Port Carrow 2031 Road Trip");
  });

  it("creates the album by its exact owned name, adds the pictures and links it after the trip's own", async () => {
    const client = fakeClient({});

    const outcome = await write(client);

    expect(client.createAlbum).toHaveBeenCalledWith({
      albumName: CITY,
      description: "TravStats trip · Port Carrow 2031 Road Trip",
    });
    expect(client.addAssetsToAlbum).toHaveBeenCalledWith(expect.any(String), [
      "photo-a",
      "photo-b",
    ]);
    expect(outcome).toMatchObject({ status: "linked", albumName: CITY, reused: false, added: 2 });
    const links = await prisma.tripImmichAlbum.findMany({
      where: { tripId },
      orderBy: { sortIdx: "asc" },
    });
    expect(links.map((link) => [link.albumName, link.sortIdx, link.assetCount])).toEqual([
      [TRIP, 0, 0],
      [CITY, 1, 2],
    ]);
  });

  it("reuses the user's own album of that exact name and adds only what it lacks", async () => {
    const client = fakeClient({
      albums: [
        {
          id: "al-city",
          albumName: CITY,
          description: "TravStats trip · Port Carrow 2031 Road Trip",
          ownerId: ME,
        },
      ],
      members: { "al-city": ["photo-a"] },
    });

    const outcome = await write(client);

    expect(client.createAlbum).not.toHaveBeenCalled();
    expect(client.addAssetsToAlbum).toHaveBeenCalledWith("al-city", ["photo-b"]);
    expect(outcome).toMatchObject({
      status: "linked",
      immichAlbumId: "al-city",
      reused: true,
      added: 1,
      alreadyIn: 1,
    });
  });

  it("updates its own linked album on a re-run, never the trip's main link", async () => {
    const client = fakeClient({
      albums: [
        {
          id: "al-main",
          albumName: TRIP,
          description: "TravStats trip · 2031-05-02 – 2031-05-06",
          ownerId: ME,
        },
        {
          id: "al-city",
          albumName: CITY,
          description: "TravStats trip · Port Carrow 2031 Road Trip",
          ownerId: ME,
        },
      ],
      members: { "al-main": ["photo-a", "photo-b"], "al-city": ["photo-a"] },
    });
    await prisma.tripImmichAlbum.create({
      data: { tripId, immichAlbumId: "al-city", albumName: CITY, mode: "link", sortIdx: 1 },
    });
    const before = await prisma.tripImmichAlbum.findFirstOrThrow({
      where: { tripId, immichAlbumId: "al-main" },
    });

    const outcome = await write(client);

    expect(client.addAssetsToAlbum).toHaveBeenCalledTimes(1);
    expect(client.addAssetsToAlbum).toHaveBeenCalledWith("al-city", ["photo-b"]);
    const main = await prisma.tripImmichAlbum.findFirstOrThrow({
      where: { tripId, immichAlbumId: "al-main" },
    });
    expect(main).toMatchObject({
      albumName: TRIP,
      assetCount: before.assetCount,
      lastSyncedAt: before.lastSyncedAt,
      sortIdx: 0,
    });
    expect(outcome).toMatchObject({ status: "linked", immichAlbumId: "al-city" });
  });

  it("skips an empty picture list without calling Immich", async () => {
    const client = fakeClient({});
    expect(await write(client, [])).toEqual({ status: "skipped", skipReason: "noAssets" });
    expect(client.findOwnedAlbumByName).not.toHaveBeenCalled();
  });
});

describe("retryStopoverAlbum", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-city-retry" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-city-retry", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    tripId = (await prisma.trip.create({ data: { userId, name: TRIP } })).id;
    (getImmichConnection as jest.Mock).mockResolvedValue({
      baseUrl: "http://immich.test",
      apiKey: "key",
      source: "user",
    });
  });

  afterEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const retryWith = (client: ReturnType<typeof fakeClient>, expected: string) => {
    (createImmichClient as jest.Mock).mockReturnValue(client);
    return retryStopoverAlbum({
      userId,
      tripId,
      tripName: TRIP,
      stopover: {
        key: "8c2d9e3f-4a5b-4c7d-8e8f-9a0b1c2d3e4f#9d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
        title: CITY,
        city: "Port Carrow",
        day: "2031-05-03",
        inFlightId: "8c2d9e3f-4a5b-4c7d-8e8f-9a0b1c2d3e4f",
        outFlightId: "9d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
        airportIata: "ZPC",
        photoIds: ["photo-a", "photo-b"],
        stations: [],
        legs: [],
      },
      expectedImmichUserId: expected,
    });
  };

  it("preflights as the draft's Immich user and writes that stopover's own album", async () => {
    const client = fakeClient({});

    const outcome = await retryWith(client, ME);

    expect(outcome).toMatchObject({ status: "linked", albumName: CITY, added: 2 });
    expect(client.createAlbum).toHaveBeenCalledWith({
      albumName: CITY,
      description: "TravStats trip · Port Carrow 2031 Road Trip",
    });
    expect(await prisma.tripImmichAlbum.count({ where: { tripId } })).toBe(1);
  });

  it("blocks a different Immich user, so the layover's ids never cross libraries", async () => {
    const client = fakeClient({});
    client.whoami.mockResolvedValue({ id: OTHER, email: "other@example.test", name: "Other" });

    expect(await retryWith(client, ME)).toEqual({
      status: "blocked",
      error: { kind: "notConfigured" },
    });
    expect(client.createAlbum).not.toHaveBeenCalled();
  });
});
