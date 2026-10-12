import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The roadtrip detail hands the journey's linked albums over WHOLE (template
 * spec §3, Gallery). The trip's Gallery tab resolves the trip's own album from
 * these rows and renders it through the journey's `ImmichAlbumSection`, which
 * reads `mode`, `thumbnailAssetId`, `sortIdx` and `lastSyncedAt` besides the
 * names — the four-field copy this suite replaces would badge an imported
 * album as "linked" and offer no resync. Synthetic names only.
 */
const USERS = ["roadtrip-gallery-owner"];

describe("roadtrip detail — the journey's albums arrive whole", () => {
  let cookie: string;
  let roadtripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const user = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;

    const trip = await prisma.trip.create({
      data: { userId: user.id, name: "Westmere loop" },
      select: { id: true },
    });
    const route = await prisma.tripRoute.create({
      data: {
        userId: user.id,
        tripId: trip.id,
        name: "Westmere loop · Kelmore",
        mode: "road",
        kind: "roadtrip",
      },
      select: { id: true },
    });
    roadtripId = route.id;
    await prisma.tripImmichAlbum.create({
      data: {
        tripId: trip.id,
        immichAlbumId: "immich-album-1",
        albumName: "Kelmore 2031 Road Trip (Westmere loop)",
        assetCount: 12,
        thumbnailAssetId: "asset-thumb-1",
        mode: "import",
        sortIdx: 0,
        lastSyncedAt: new Date("2031-05-09T10:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("carries every field the gallery section reads", async () => {
    const res = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    const album = res.body.trip.immichAlbums[0] as Record<string, unknown>;
    // The exact key set, not a subset: the narrow select leaked two keys short
    // of the journey's `LinkedAlbum`, and a subset assertion would not see it.
    expect(Object.keys(album).sort().join(",")).toBe(
      "albumName,assetCount,id,immichAlbumId,lastSyncedAt,mode,sortIdx,thumbnailAssetId"
    );
    expect(album).toMatchObject({
      immichAlbumId: "immich-album-1",
      albumName: "Kelmore 2031 Road Trip (Westmere loop)",
      assetCount: 12,
      thumbnailAssetId: "asset-thumb-1",
      mode: "import",
      sortIdx: 0,
      lastSyncedAt: "2031-05-09T10:00:00.000Z",
    });
  });
});
