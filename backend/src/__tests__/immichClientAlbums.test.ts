/**
 * The album calls the trip builder makes: read one, find the user's own by exact
 * name, create an empty one, and add assets to it with a per-asset answer. They
 * are the only writes this client makes to Immich, so the tests pin every path,
 * body and failure mapping.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { createImmichClient } from "../services/immich/immichClient";
import type { ImmichConnection } from "../services/immich/types";

const CONN: ImmichConnection = {
  baseUrl: "https://immich.lan",
  apiKey: "secret-key",
  source: "user",
};

// Synthetic ids and names only (public repository).
const ALBUM_ID = "7f3c1b2a-9d4e-4a6b-8c0d-1e2f3a4b5c6d";
const THUMB_ID = "5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a";
const OWNER_ID = "a1f0c9d8-7b6a-4c5d-8e4f-3a2b1c0d9e8f";
const OTHER_ID = "c2e1d0f9-8a7b-4c6d-9e5f-4b3a2c1d0e9f";

beforeEach(() => {
  jest.resetAllMocks();
});

/** An album as Immich sends it; `albumUsers[0]` is always the owner. */
function albumJson(overrides: Record<string, unknown> = {}) {
  return {
    id: ALBUM_ID,
    albumName: "Northvale loop",
    description: "TravStats trip · 2031-05-02 – 2031-05-09",
    assetCount: 12,
    albumThumbnailAssetId: THUMB_ID,
    albumUsers: [{ user: { id: OWNER_ID, name: "Ann" }, role: "owner" }],
    ...overrides,
  };
}

describe("getAlbum", () => {
  it("GETs /api/albums/:id and maps it like a list entry", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: albumJson() });

    await expect(createImmichClient(CONN).getAlbum(ALBUM_ID)).resolves.toEqual({
      id: ALBUM_ID,
      albumName: "Northvale loop",
      assetCount: 12,
      thumbnailAssetId: THUMB_ID,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `https://immich.lan/api/albums/${ALBUM_ID}`,
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
  });

  it("maps a deleted album (404) to kind=notFound", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: {} },
    });

    await expect(createImmichClient(CONN).getAlbum(ALBUM_ID)).rejects.toMatchObject({
      kind: "notFound",
    });
  });

  it("rejects a payload without an id as kind=protocol", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: albumJson({ id: undefined }) });

    await expect(createImmichClient(CONN).getAlbum(ALBUM_ID)).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("keeps an album id from altering the request path", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: albumJson() });

    await createImmichClient(CONN).getAlbum("a/../b");

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/albums/a%2F..%2Fb",
      expect.anything()
    );
  });
});

describe("findOwnedAlbumByName", () => {
  it("GETs the name-and-ownership query with the name URL-encoded", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] });

    await createImmichClient(CONN).findOwnedAlbumByName(
      "Northvale loop & Port Carrow #2",
      OWNER_ID
    );

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/albums?name=Northvale%20loop%20%26%20Port%20Carrow%20%232&isOwned=true",
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
  });

  it("returns the album with exactly that name that the caller owns", async () => {
    // An Immich that ignores the query still answers with everything, so the
    // client re-checks: case, then the owner (albumUsers[0]), not mere membership.
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        albumJson({ id: "wrong-case", albumName: "northvale loop" }),
        albumJson({
          id: "someone-elses",
          albumUsers: [
            { user: { id: OTHER_ID }, role: "owner" },
            { user: { id: OWNER_ID }, role: "editor" },
          ],
        }),
        albumJson({ id: ALBUM_ID }),
      ],
    });

    await expect(
      createImmichClient(CONN).findOwnedAlbumByName("Northvale loop", OWNER_ID)
    ).resolves.toEqual({
      id: ALBUM_ID,
      albumName: "Northvale loop",
      assetCount: 12,
      thumbnailAssetId: THUMB_ID,
    });
  });

  it("returns null when no album has that name and owner", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [albumJson({ albumName: "Port Carrow weekend" })],
    });
    await expect(
      createImmichClient(CONN).findOwnedAlbumByName("Northvale loop", OWNER_ID)
    ).resolves.toBeNull();

    mockedAxios.get.mockResolvedValueOnce({ data: [] });
    await expect(
      createImmichClient(CONN).findOwnedAlbumByName("Northvale loop", OWNER_ID)
    ).resolves.toBeNull();
  });

  it("never matches an album that names no owner", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [albumJson({ albumUsers: undefined }), albumJson({ albumUsers: [] })],
    });

    await expect(
      createImmichClient(CONN).findOwnedAlbumByName("Northvale loop", OWNER_ID)
    ).resolves.toBeNull();
  });

  it("rejects a non-array body as kind=protocol", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { albums: [] } });

    await expect(
      createImmichClient(CONN).findOwnedAlbumByName("Northvale loop", OWNER_ID)
    ).rejects.toMatchObject({ kind: "protocol" });
  });

  it("names the missing album.read permission on a 403", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403, data: { message: "Missing required permission: album.read" } },
    });

    await expect(
      createImmichClient(CONN).findOwnedAlbumByName("Northvale loop", OWNER_ID)
    ).rejects.toMatchObject({ kind: "auth", detail: { missingScope: "album.read" } });
  });
});

describe("createAlbum", () => {
  const input = {
    albumName: "Northvale loop",
    description: "TravStats trip · 2031-05-02 – 2031-05-09",
  };

  it("POSTs only the name and description and returns the new, empty album", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: albumJson({ assetCount: 0, albumThumbnailAssetId: null }),
    });

    await expect(createImmichClient(CONN).createAlbum(input)).resolves.toEqual({
      id: ALBUM_ID,
      albumName: "Northvale loop",
      assetCount: 0,
      thumbnailAssetId: null,
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://immich.lan/api/albums",
      {
        albumName: "Northvale loop",
        description: "TravStats trip · 2031-05-02 – 2031-05-09",
      },
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
  });

  it("sends no asset ids: Immich drops the ones it cannot share without saying which", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: albumJson() });

    await createImmichClient(CONN).createAlbum(input);

    expect(mockedAxios.post.mock.calls[0][1]).not.toHaveProperty("assetIds");
  });

  it("names the missing album.create permission on a 403", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403, data: { message: "Missing required permission: album.create" } },
    });

    await expect(createImmichClient(CONN).createAlbum(input)).rejects.toMatchObject({
      kind: "auth",
      status: 403,
      detail: { missingScope: "album.create" },
    });
  });

  it("rejects an answer without an album id as kind=protocol", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { albumName: "Northvale loop" } });

    await expect(createImmichClient(CONN).createAlbum(input)).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});

describe("addAssetsToAlbum", () => {
  /** n distinct, valid-looking asset ids. */
  const ids = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("PUTs the ids and sorts Immich's per-asset answers into added, duplicate and refused", async () => {
    const [a, b, c] = ids(3);
    mockedAxios.put.mockResolvedValueOnce({
      data: [
        { id: a, success: true },
        { id: b, success: false, error: "duplicate" },
        { id: c, success: false, error: "no_permission" },
      ],
    });

    const result = await createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, [a, b, c]);

    expect(mockedAxios.put).toHaveBeenCalledWith(
      `https://immich.lan/api/albums/${ALBUM_ID}/assets`,
      { ids: [a, b, c] },
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
    expect(result).toEqual({
      added: 1,
      duplicate: 1,
      refused: [{ id: c, error: "no_permission" }],
    });
  });

  it("sends at most 1000 ids a request and adds the answers up", async () => {
    mockedAxios.put.mockImplementation(async (_url: string, body: unknown) => ({
      data: (body as { ids: string[] }).ids.map((id) => ({ id, success: true })),
    }));

    const result = await createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, ids(2500));

    expect(mockedAxios.put).toHaveBeenCalledTimes(3);
    expect(
      mockedAxios.put.mock.calls.map((call) => (call[1] as { ids: string[] }).ids.length)
    ).toEqual([1000, 1000, 500]);
    expect(result).toEqual({ added: 2500, duplicate: 0, refused: [] });
  });

  it("asks about each id once", async () => {
    const [a, b] = ids(2);
    mockedAxios.put.mockResolvedValueOnce({
      data: [
        { id: a, success: true },
        { id: b, success: true },
      ],
    });

    const result = await createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, [a, a, b]);

    expect(mockedAxios.put.mock.calls[0][1]).toEqual({ ids: [a, b] });
    expect(result.added).toBe(2);
  });

  it("refuses, as missing, an id Immich did not answer for, so every id has one outcome", async () => {
    const [a, b, c] = ids(3);
    mockedAxios.put.mockResolvedValueOnce({
      data: [
        { id: a, success: true },
        { id: c, success: false, error: "duplicate" },
      ],
    });

    const result = await createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, [a, b, c]);

    expect(result).toEqual({ added: 1, duplicate: 1, refused: [{ id: b, error: "missing" }] });
    expect(result.added + result.duplicate + result.refused.length).toBe(3);
  });

  it("reports a refusal that gives no reason as unknown", async () => {
    const [a] = ids(1);
    mockedAxios.put.mockResolvedValueOnce({ data: [{ id: a, success: false }] });

    const result = await createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, [a]);

    expect(result.refused).toEqual([{ id: a, error: "unknown" }]);
  });

  it("makes no request for no ids", async () => {
    await expect(createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, [])).resolves.toEqual({
      added: 0,
      duplicate: 0,
      refused: [],
    });
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });

  it("throws when a later chunk fails: what was added stays, and a retry hears duplicate for it", async () => {
    mockedAxios.put
      .mockResolvedValueOnce({ data: ids(1000).map((id) => ({ id, success: true })) })
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503, data: {} } });

    await expect(
      createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, ids(1500))
    ).rejects.toMatchObject({ kind: "unreachable" });
    expect(mockedAxios.put).toHaveBeenCalledTimes(2);
  });

  it("names the missing albumAsset.create permission on a 403", async () => {
    mockedAxios.put.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 403,
        data: { message: "Missing required permission: albumAsset.create" },
      },
    });

    await expect(createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, ids(1))).rejects.toMatchObject(
      { kind: "auth", detail: { missingScope: "albumAsset.create" } }
    );
  });

  it("rejects a non-array answer as kind=protocol", async () => {
    mockedAxios.put.mockResolvedValueOnce({ data: { success: true } });

    await expect(createImmichClient(CONN).addAssetsToAlbum(ALBUM_ID, ids(1))).rejects.toMatchObject(
      { kind: "protocol" }
    );
  });
});
