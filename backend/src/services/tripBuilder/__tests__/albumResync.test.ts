import { describe, it, expect, jest, beforeEach, afterAll } from "@jest/globals";

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { ImmichError } from "../../immich/types";
import type { ImmichAsset } from "../../immich/types";
import { albumDescription } from "../albumWrite";
import { hasTravstatsMarker } from "../existingTypes";
import { resyncTripAlbum, type ResyncClient, type ResyncInput } from "../albumResync";
import { createExistingFixture, dropFixtureUser, type ExistingFixture } from "./existingDb";

// Synthetic fixtures only (public repository).
const USER = "m7k-album";
const ME = "immich-user-1";
const ALBUM = "9a1b2c3d-0000-4000-8000-000000000001";
const MARKED = "TravStats trip · 2031-05-02 – 2031-05-09";

const asset = (id: string, at = "2031-05-03T09:00:00.000Z"): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: at,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat: null,
  lon: null,
});

interface Setup {
  members?: ImmichAsset[];
  description?: string;
  ownerId?: string;
  permissions?: string[] | null;
  byName?: boolean;
  /** The cover Immich reports for the album now; `"thumb-1"` when omitted. */
  thumbnailAssetId?: string | null;
}

function fakeClient(setup: Setup = {}) {
  const calls = {
    added: [] as string[][],
    removed: [] as string[][],
    described: [] as string[],
    created: [] as string[],
  };
  const members = setup.members ?? [];
  const client: ResyncClient = {
    getAlbumInfo: jest.fn(async (id: string) => ({
      id,
      albumName: "Northvale loop",
      description: setup.description ?? MARKED,
      ownerId: setup.ownerId ?? ME,
      assetCount: members.length,
      thumbnailAssetId: setup.thumbnailAssetId === undefined ? "thumb-1" : setup.thumbnailAssetId,
    })),
    listAlbumAssets: jest.fn(async () => members),
    findOwnedAlbumByName: jest.fn(async () =>
      setup.byName
        ? { id: "al-by-name", albumName: "Northvale loop", assetCount: 0, thumbnailAssetId: null }
        : null
    ),
    getMyApiKey: jest.fn(async () =>
      setup.permissions === null
        ? null
        : { permissions: setup.permissions ?? ["albumAsset.delete"] }
    ),
    createAlbum: jest.fn(async (input: { albumName: string; description: string }) => {
      calls.created.push(input.description);
      return { id: "al-new", albumName: input.albumName, assetCount: 0, thumbnailAssetId: null };
    }),
    addAssetsToAlbum: jest.fn(async (_id: string, ids: readonly string[]) => {
      calls.added.push([...ids]);
      return { added: ids.length, duplicate: 0, refused: [] };
    }),
    removeAssetsFromAlbum: jest.fn(async (_id: string, ids: readonly string[]) => {
      calls.removed.push([...ids]);
      return { removed: ids.length, notInAlbum: 0, refused: [] };
    }),
    setAlbumDescription: jest.fn(async (_id: string, description: string) => {
      calls.described.push(description);
    }),
  };
  return { client, calls };
}

describe("resyncTripAlbum", () => {
  let fx: ExistingFixture;
  beforeEach(async () => {
    jest.clearAllMocks();
    fx = await createExistingFixture(USER);
    // The fixture links album 000...01; make the test client's album that one.
  });
  afterEach(async () => {
    await dropFixtureUser(USER);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const input = (client: ResyncClient, over: Partial<ResyncInput> = {}): ResyncInput => ({
    userId: fx.userId,
    tripId: fx.tripId,
    tripName: "Northvale loop",
    albumName: "Northvale loop",
    window: { startDay: "2031-05-02", endDay: "2031-05-09" },
    assetIds: ["m1", "m2", "n1", "n2"],
    outsideIds: [],
    scanAlbumId: ALBUM,
    removeOutside: false,
    client,
    immichUserId: ME,
    ...over,
  });

  const link = () => prisma.tripImmichAlbum.findUniqueOrThrow({ where: { id: fx.linkId } });

  it("pins the description marker to the one TravStats writes", () => {
    expect(hasTravstatsMarker(albumDescription("2031-05-02", "2031-05-09"))).toBe(true);
  });

  it("takes the cover from the album as it is now, so a removed photo is not left as the cover", async () => {
    await prisma.tripImmichAlbum.update({
      where: { id: fx.linkId },
      data: { thumbnailAssetId: "o1" },
    });
    const { client } = fakeClient({
      members: [asset("m1"), asset("o1", "2031-03-01T09:00:00.000Z")],
      thumbnailAssetId: "m1",
    });
    await resyncTripAlbum(
      input(client, { assetIds: ["m1"], outsideIds: ["o1"], removeOutside: true })
    );
    expect((await link()).thumbnailAssetId).toBe("m1");
  });

  it("gives a link that has no cover the album's cover", async () => {
    expect((await link()).thumbnailAssetId).toBeNull();
    const { client } = fakeClient({ members: [asset("m1")], thumbnailAssetId: "m1" });
    await resyncTripAlbum(input(client, { assetIds: ["m1", "n1"] }));
    expect((await link()).thumbnailAssetId).toBe("m1");
  });

  it("adds the new-window photos the album lacks, and says how many were already in", async () => {
    const { client, calls } = fakeClient({ members: [asset("m1"), asset("m2")] });
    const outcome = await resyncTripAlbum(input(client));
    expect(calls.added).toEqual([["n1", "n2"]]);
    expect(outcome).toMatchObject({
      status: "linked",
      immichAlbumId: ALBUM,
      reused: true,
      added: 2,
      alreadyIn: 2,
    });
  });

  it("updates the link row: name, count and last sync", async () => {
    const { client } = fakeClient({ members: [asset("m1"), asset("m2")] });
    await resyncTripAlbum(input(client));
    const row = await link();
    expect(row).toMatchObject({ albumName: "Northvale loop", assetCount: 2 });
    expect(row.lastSyncedAt).not.toBeNull();
  });

  it("removes the members the server computed as outside when removal is ticked and the key may", async () => {
    const { client, calls } = fakeClient({
      members: [
        asset("m1"),
        asset("o1", "2031-03-01T09:00:00.000Z"),
        asset("o2", "2031-07-01T09:00:00.000Z"),
      ],
    });
    const outcome = await resyncTripAlbum(
      input(client, { assetIds: ["m1"], outsideIds: ["o1", "o2"], removeOutside: true })
    );
    expect(calls.removed).toEqual([["o1", "o2"]]);
    expect(outcome).toMatchObject({ removed: 2 });
    expect(outcome.removeSkipped).toBeUndefined();
  });

  it("removes nothing when removal is not ticked, marker or not", async () => {
    const { client, calls } = fakeClient({ members: [asset("m1"), asset("o1")] });
    await resyncTripAlbum(
      input(client, { assetIds: ["m1"], outsideIds: ["o1"], removeOutside: false })
    );
    expect(calls.removed).toEqual([]);
  });

  it("removes from an album TravStats did not write when the user ticked it", async () => {
    await prisma.tripImmichAlbum.update({
      where: { id: fx.linkId },
      data: { albumName: "Holiday photos" },
    });
    const { client, calls } = fakeClient({
      members: [asset("m1"), asset("o1")],
      description: "Our holiday",
    });
    const outcome = await resyncTripAlbum(
      input(client, {
        tripName: "Northvale loop",
        assetIds: ["m1"],
        outsideIds: ["o1"],
        removeOutside: true,
      })
    );
    expect(calls.removed).toEqual([["o1"]]);
    expect(outcome.removed).toBe(1);
  });

  it("disables removal without the albumAsset.delete scope, and still adds", async () => {
    const { client, calls } = fakeClient({
      members: [asset("m1"), asset("o1")],
      permissions: ["album.read", "albumAsset.create"],
    });
    const outcome = await resyncTripAlbum(
      input(client, { assetIds: ["m1", "n1"], outsideIds: ["o1"], removeOutside: true })
    );
    expect(calls.removed).toEqual([]);
    expect(calls.added).toEqual([["n1"]]);
    expect(outcome).toMatchObject({
      status: "linked",
      added: 1,
      removed: 0,
      removeSkipped: "missingScope",
    });
  });

  it("never removes an id the server did not compute", async () => {
    const { client, calls } = fakeClient({
      members: [asset("m1"), asset("o1"), asset("x9", "2031-03-01T09:00:00.000Z")],
    });
    await resyncTripAlbum(
      input(client, { assetIds: ["m1"], outsideIds: ["o1", "gone"], removeOutside: true })
    );
    expect(calls.removed).toEqual([["o1"]]);
  });

  it("skips removal when the album is not the one the scan judged", async () => {
    const { client, calls } = fakeClient({ members: [asset("m1"), asset("o1")] });
    const outcome = await resyncTripAlbum(
      input(client, {
        assetIds: ["m1"],
        outsideIds: ["o1"],
        removeOutside: true,
        scanAlbumId: "another-album",
      })
    );
    expect(calls.removed).toEqual([]);
    expect(outcome.removeSkipped).toBe("albumChanged");
  });

  it("reports a refused removal as skipped, not as a failed re-sync", async () => {
    const { client } = fakeClient({ members: [asset("m1"), asset("o1")] });
    (client.removeAssetsFromAlbum as jest.Mock).mockRejectedValueOnce(
      new ImmichError("auth", "Immich rejected the API key", 403, {
        missingScope: "albumAsset.delete",
      })
    );
    const outcome = await resyncTripAlbum(
      input(client, { assetIds: ["m1"], outsideIds: ["o1"], removeOutside: true })
    );
    expect(outcome).toMatchObject({ status: "linked", removed: 0, removeSkipped: "missingScope" });
  });

  it("writes nothing to Immich when there is nothing to do, but still records the sync", async () => {
    const before = await link();
    const { client, calls } = fakeClient({ members: [asset("m1"), asset("m2")] });
    const outcome = await resyncTripAlbum(input(client, { assetIds: ["m1", "m2"] }));
    expect(calls).toEqual({ added: [], removed: [], described: [], created: [] });
    expect(outcome).toMatchObject({ status: "linked", added: 0, alreadyIn: 2 });
    expect((await link()).lastSyncedAt?.getTime()).toBeGreaterThan(
      before.lastSyncedAt?.getTime() ?? 0
    );
  });

  it("refreshes the description it wrote when the window changed", async () => {
    const { client, calls } = fakeClient({
      members: [asset("m1")],
      description: "TravStats trip · 2031-05-02 – 2031-05-07",
    });
    await resyncTripAlbum(input(client, { assetIds: ["m1"] }));
    expect(calls.described).toEqual([albumDescription("2031-05-02", "2031-05-09")]);
  });

  it("leaves a description it did not write alone", async () => {
    await prisma.tripImmichAlbum.update({
      where: { id: fx.linkId },
      data: { albumName: "Holiday photos" },
    });
    const { client, calls } = fakeClient({ members: [asset("m1")], description: "Our holiday" });
    await resyncTripAlbum(input(client, { assetIds: ["m1"] }));
    expect(calls.described).toEqual([]);
  });

  it("carries on when the description cannot be refreshed", async () => {
    const { client } = fakeClient({ members: [asset("m1")], description: "TravStats trip · old" });
    (client.setAlbumDescription as jest.Mock).mockRejectedValueOnce(
      new ImmichError("auth", "no", 403, { missingScope: "album.update" })
    );
    const outcome = await resyncTripAlbum(input(client, { assetIds: ["m1"] }));
    expect(outcome.status).toBe("linked");
  });

  it("creates the album and links it when none exists", async () => {
    await prisma.tripImmichAlbum.deleteMany({ where: { tripId: fx.tripId } });
    const { client, calls } = fakeClient();
    const outcome = await resyncTripAlbum(
      input(client, { assetIds: ["n1", "n2"], scanAlbumId: null })
    );
    expect(calls.created).toEqual([albumDescription("2031-05-02", "2031-05-09")]);
    expect(calls.added).toEqual([["n1", "n2"]]);
    expect(outcome).toMatchObject({
      status: "linked",
      immichAlbumId: "al-new",
      reused: false,
      added: 2,
    });
    const rows = await prisma.tripImmichAlbum.findMany({ where: { tripId: fx.tripId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ immichAlbumId: "al-new", mode: "link", sortIdx: 0 });
  });

  it("adds to an owned album found by name and links it after the existing ones", async () => {
    await prisma.tripImmichAlbum.update({ where: { id: fx.linkId }, data: { mode: "import" } });
    const { client } = fakeClient({ byName: true, members: [asset("m1")] });
    const outcome = await resyncTripAlbum(
      input(client, { assetIds: ["m1", "n1"], scanAlbumId: "al-by-name" })
    );
    expect(outcome).toMatchObject({
      status: "linked",
      immichAlbumId: "al-by-name",
      reused: true,
      added: 1,
    });
    const linked = await prisma.tripImmichAlbum.findFirst({
      where: { tripId: fx.tripId, immichAlbumId: "al-by-name" },
    });
    expect(linked).toMatchObject({ mode: "link", sortIdx: 1 });
  });

  it("skips when the window has no photos and nothing to remove", async () => {
    const { client } = fakeClient();
    expect(await resyncTripAlbum(input(client, { assetIds: [], outsideIds: [] }))).toEqual({
      status: "skipped",
      skipReason: "noAssets",
    });
  });

  it("never throws: an Immich failure is the outcome", async () => {
    const { client } = fakeClient({ members: [] });
    (client.listAlbumAssets as jest.Mock).mockRejectedValueOnce(
      new ImmichError("unreachable", "down")
    );
    const outcome = await resyncTripAlbum(input(client));
    expect(outcome).toEqual({ status: "failed", error: { kind: "unreachable" } });
  });

  it.each(["unreachable", "protocol", "notFound", "auth"] as const)(
    "leaves a '%s' failure in the log with its kind and status, and nothing that names an asset",
    async (kind) => {
      const { client } = fakeClient({ members: [] });
      (client.listAlbumAssets as jest.Mock).mockRejectedValueOnce(
        new ImmichError(kind, "Immich refused m1 with the key", 502)
      );
      expect(await resyncTripAlbum(input(client))).toMatchObject({
        status: "failed",
        error: { kind },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { operation: "trip_builder.album_failed", kind, status: 502 },
        expect.any(String)
      );
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it("reports anything else as an internal failure, logged as an error", async () => {
    const { client } = fakeClient({ members: [] });
    (client.listAlbumAssets as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    expect(await resyncTripAlbum(input(client))).toEqual({
      status: "failed",
      error: { kind: "internal" },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "trip_builder.album_failed", error: "boom" }),
      "Writing the trip album failed"
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
