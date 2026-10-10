import { describe, it, expect, jest } from "@jest/globals";

import type { ImmichAsset } from "../../immich/types";
import type { ExistingAlbumLink } from "../existingTypes";
import {
  albumDescriber,
  outsideMemberIds,
  pickLinkedAlbum,
  planAlbumSync,
  previewAlbumSync,
  resolveAlbumTarget,
  type AlbumResyncClient,
} from "../albumResync";

// Synthetic fixtures only (public repository).
const ME = "immich-user-1";
const FETCH_FROM = new Date("2031-04-28T10:00:00.000Z");
const FETCH_TO = new Date("2031-05-13T12:00:00.000Z");

function link(
  over: Partial<ExistingAlbumLink> & Pick<ExistingAlbumLink, "immichAlbumId" | "albumName">
): ExistingAlbumLink {
  return {
    linkId: `link-${over.immichAlbumId}`,
    assetCount: 10,
    ownedByUser: true,
    travstatsMarker: true,
    ...over,
  };
}

const member = (id: string, fileCreatedAt: string): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat: null,
  lon: null,
});

function fakeClient(init: {
  members?: ImmichAsset[];
  description?: string;
  ownerId?: string;
  permissions?: string[] | null;
  byName?: { id: string } | null;
}): AlbumResyncClient {
  return {
    getAlbumInfo: jest.fn(async (id: string) => ({
      id,
      albumName: "Northvale loop",
      description: init.description ?? "TravStats trip · 2031-05-02 – 2031-05-09",
      ownerId: init.ownerId ?? ME,
      assetCount: init.members?.length ?? 0,
      thumbnailAssetId: null,
    })),
    listAlbumAssets: jest.fn(async () => init.members ?? []),
    findOwnedAlbumByName: jest.fn(async () =>
      init.byName
        ? { id: init.byName.id, albumName: "Northvale loop", assetCount: 0, thumbnailAssetId: null }
        : null
    ),
    getMyApiKey: jest.fn(async () =>
      init.permissions === null ? null : { permissions: init.permissions ?? ["albumAsset.delete"] }
    ),
  };
}

describe("pickLinkedAlbum", () => {
  const exact = link({ immichAlbumId: "al-1", albumName: "Northvale loop" });
  const other = link({ immichAlbumId: "al-2", albumName: "Holiday photos" });

  it("prefers the owned album named like the trip", () => {
    expect(pickLinkedAlbum([other, exact], "Northvale loop")?.immichAlbumId).toBe("al-1");
  });

  it("falls back to the first owned album", () => {
    expect(pickLinkedAlbum([other, exact], "Something else")?.immichAlbumId).toBe("al-2");
  });

  it("ignores albums the user does not own or whose owner is unknown", () => {
    const foreign = link({
      immichAlbumId: "al-3",
      albumName: "Northvale loop",
      ownedByUser: false,
    });
    const unknown = link({ immichAlbumId: "al-4", albumName: "Northvale loop", ownedByUser: null });
    expect(pickLinkedAlbum([foreign, unknown], "Northvale loop")).toBeNull();
  });
});

describe("outsideMemberIds", () => {
  const input = {
    windowIds: new Set(["w1", "w2"]),
    contextIds: new Set(["c1"]),
    fetchFrom: FETCH_FROM,
    fetchTo: FETCH_TO,
  };

  it("removes only what the server proved outside the dates", () => {
    const members = [
      { id: "w1", fileCreatedAt: "2031-05-03T09:00:00.000Z" },
      { id: "c1", fileCreatedAt: "2031-05-01T09:00:00.000Z" },
      { id: "early", fileCreatedAt: "2031-03-01T09:00:00.000Z" },
      { id: "late", fileCreatedAt: "2031-07-01T09:00:00.000Z" },
      { id: "unsure", fileCreatedAt: "2031-05-10T09:00:00.000Z" },
    ];
    expect(outsideMemberIds({ ...input, members })).toEqual(["c1", "early", "late"]);
  });

  it("never removes a member whose capture time is unknown", () => {
    const members = [
      { id: "epoch", fileCreatedAt: new Date(0).toISOString() },
      { id: "junk", fileCreatedAt: "not a time" },
    ];
    expect(outsideMemberIds({ ...input, members })).toEqual([]);
  });

  it("never removes a member that is in the window", () => {
    const members = [{ id: "w2", fileCreatedAt: "2031-03-01T09:00:00.000Z" }];
    expect(outsideMemberIds({ ...input, members })).toEqual([]);
  });
});

describe("planAlbumSync", () => {
  it("adds only the window photos the album lacks", () => {
    const plan = planAlbumSync({
      windowAssetIds: ["a", "b", "c", "d"],
      members: [
        { id: "a", fileCreatedAt: "2031-05-03T09:00:00.000Z" },
        { id: "b", fileCreatedAt: "2031-05-03T09:00:00.000Z" },
        { id: "zz", fileCreatedAt: "2031-03-03T09:00:00.000Z" },
      ],
    });
    expect(plan).toEqual({ toAdd: ["c", "d"], alreadyIn: 2 });
  });
});

describe("resolveAlbumTarget", () => {
  const exact = link({ immichAlbumId: "al-1", albumName: "Northvale loop" });

  it("uses the linked album first", async () => {
    const client = fakeClient({});
    const target = await resolveAlbumTarget({
      client,
      immichUserId: ME,
      links: [exact],
      tripName: "Northvale loop",
      albumName: "Northvale loop",
    });
    expect(target).toEqual({
      kind: "linked",
      linkId: "link-al-1",
      immichAlbumId: "al-1",
      marker: true,
    });
    expect(client.findOwnedAlbumByName).not.toHaveBeenCalled();
  });

  it("finds an owned album by name when none is linked, and reads its marker", async () => {
    const client = fakeClient({ byName: { id: "al-9" }, description: "Our holiday" });
    const target = await resolveAlbumTarget({
      client,
      immichUserId: ME,
      links: [],
      tripName: "Northvale loop",
      albumName: "Northvale loop",
    });
    expect(target).toEqual({ kind: "byName", immichAlbumId: "al-9", marker: false });
    expect(client.findOwnedAlbumByName).toHaveBeenCalledWith("Northvale loop", ME);
  });

  it("creates one when there is none", async () => {
    const target = await resolveAlbumTarget({
      client: fakeClient({}),
      immichUserId: ME,
      links: [],
      tripName: "Northvale loop",
      albumName: "Northvale loop",
    });
    expect(target).toEqual({ kind: "create" });
  });
});

describe("albumDescriber", () => {
  it("says whether the album is the user's and whether TravStats wrote it", async () => {
    const describe = albumDescriber(fakeClient({ ownerId: ME }), ME);
    expect(await describe("al-1")).toEqual({ ownedByUser: true, travstatsMarker: true });
    const foreign = albumDescriber(fakeClient({ ownerId: "someone-else", description: "" }), ME);
    expect(await foreign("al-1")).toEqual({ ownedByUser: false, travstatsMarker: false });
  });
});

describe("previewAlbumSync", () => {
  const base = {
    immichUserId: ME,
    tripName: "Northvale loop",
    albumName: "Northvale loop",
    windowAssetIds: ["w1", "w2", "w3"],
    contextIds: new Set(["c1"]),
    fetchFrom: FETCH_FROM,
    fetchTo: FETCH_TO,
    links: [link({ immichAlbumId: "al-1", albumName: "Northvale loop" })],
  };
  const members = [
    member("w1", "2031-05-03T09:00:00.000Z"),
    member("c1", "2031-05-01T09:00:00.000Z"),
    member("early", "2031-03-01T09:00:00.000Z"),
  ];

  it("counts what would be added and what could be removed, on by default for an album TravStats wrote", async () => {
    const preview = await previewAlbumSync({ ...base, client: fakeClient({ members }) });
    expect(preview).toEqual({
      immichAlbumId: "al-1",
      outside: ["c1", "early"],
      sync: {
        target: "linked",
        toAdd: 2,
        alreadyIn: 1,
        removable: { count: 2, defaultOn: true, allowed: true },
      },
    });
  });

  it("starts removal off for an album TravStats did not write", async () => {
    const links = [
      link({ immichAlbumId: "al-1", albumName: "Northvale loop", travstatsMarker: false }),
    ];
    const preview = await previewAlbumSync({ ...base, links, client: fakeClient({ members }) });
    expect(preview.sync.removable).toMatchObject({ count: 2, defaultOn: false, allowed: true });
  });

  it("disables removal when the key lacks the scope, and says which", async () => {
    const preview = await previewAlbumSync({
      ...base,
      client: fakeClient({ members, permissions: ["album.read"] }),
    });
    expect(preview.sync.removable).toMatchObject({
      allowed: false,
      missingScope: "albumAsset.delete",
    });
  });

  it("previews a new album as all additions and nothing to remove", async () => {
    const preview = await previewAlbumSync({ ...base, links: [], client: fakeClient({}) });
    expect(preview).toEqual({
      immichAlbumId: null,
      outside: [],
      sync: {
        target: "create",
        toAdd: 3,
        alreadyIn: 0,
        removable: { count: 0, defaultOn: true, allowed: true },
      },
    });
  });
});
