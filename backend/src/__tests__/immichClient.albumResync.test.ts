/**
 * The re-sync reads an album's owner and description, removes members that fall
 * outside the trip dates, and refreshes the description it wrote. These pin the
 * wire shapes (Immich 3.x): DELETE with a body, per-id results, the owner as the
 * first album user, and the missing-scope mapping of a 403.
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
const ALBUM = "9a1b2c3d-0000-4000-8000-000000000001";

beforeEach(() => {
  jest.resetAllMocks();
});

describe("removeAssetsFromAlbum", () => {
  it("DELETEs /api/albums/:id/assets with the ids in the body and counts the per-id results", async () => {
    mockedAxios.delete.mockResolvedValueOnce({
      data: [
        { id: "a1", success: true },
        { id: "a2", success: true },
        { id: "a3", success: false, error: "not_found" },
        { id: "a4", success: false, error: "no_permission" },
      ],
    });
    const result = await createImmichClient(CONN).removeAssetsFromAlbum(ALBUM, [
      "a1",
      "a2",
      "a3",
      "a4",
    ]);
    expect(result).toEqual({
      removed: 2,
      notInAlbum: 1,
      refused: [{ id: "a4", error: "no_permission" }],
    });
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      `https://immich.lan/api/albums/${ALBUM}/assets`,
      expect.objectContaining({
        headers: { "x-api-key": "secret-key" },
        data: { ids: ["a1", "a2", "a3", "a4"] },
      })
    );
  });

  it("sends 1000 ids per call", async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => `id-${i}`);
    mockedAxios.delete.mockImplementation(async (_url, config) => ({
      data: (config?.data as { ids: string[] }).ids.map((id) => ({ id, success: true })),
    }));
    const result = await createImmichClient(CONN).removeAssetsFromAlbum(ALBUM, ids);
    expect(result.removed).toBe(2500);
    expect(mockedAxios.delete).toHaveBeenCalledTimes(3);
  });

  it("makes no call for an empty list", async () => {
    const result = await createImmichClient(CONN).removeAssetsFromAlbum(ALBUM, []);
    expect(result).toEqual({ removed: 0, notInAlbum: 0, refused: [] });
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it("names the permission a 403 says is missing", async () => {
    mockedAxios.delete.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 403,
        data: { message: "Missing required permission: albumAsset.delete" },
      },
    });
    await expect(
      createImmichClient(CONN).removeAssetsFromAlbum(ALBUM, ["a1"])
    ).rejects.toMatchObject({
      name: "ImmichError",
      kind: "auth",
      detail: { missingScope: "albumAsset.delete" },
    });
  });

  it("maps a payload that is not a list to kind=protocol", async () => {
    mockedAxios.delete.mockResolvedValueOnce({ data: { ok: true } });
    await expect(
      createImmichClient(CONN).removeAssetsFromAlbum(ALBUM, ["a1"])
    ).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});

describe("getAlbumInfo", () => {
  it("reads the owner as the first album user, the description and the count", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        id: ALBUM,
        albumName: "Northvale loop",
        description: "TravStats trip · 2031-05-02 – 2031-05-09",
        assetCount: 41,
        albumThumbnailAssetId: "t1",
        albumUsers: [
          { user: { id: "immich-user-1" }, role: "owner" },
          { user: { id: "immich-user-2" }, role: "viewer" },
        ],
      },
    });
    const info = await createImmichClient(CONN).getAlbumInfo(ALBUM);
    expect(info).toEqual({
      id: ALBUM,
      albumName: "Northvale loop",
      description: "TravStats trip · 2031-05-02 – 2031-05-09",
      ownerId: "immich-user-1",
      assetCount: 41,
      thumbnailAssetId: "t1",
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `https://immich.lan/api/albums/${ALBUM}`,
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
  });

  it("reads an album with no description or users as an empty description and no owner", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { id: ALBUM, albumName: "Bare" } });
    expect(await createImmichClient(CONN).getAlbumInfo(ALBUM)).toMatchObject({
      description: "",
      ownerId: null,
      assetCount: 0,
      thumbnailAssetId: null,
    });
  });
});

describe("setAlbumDescription", () => {
  it("PATCHes the description", async () => {
    mockedAxios.patch.mockResolvedValueOnce({ data: { id: ALBUM } });
    await createImmichClient(CONN).setAlbumDescription(
      ALBUM,
      "TravStats trip · 2031-05-02 – 2031-05-10"
    );
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      `https://immich.lan/api/albums/${ALBUM}`,
      { description: "TravStats trip · 2031-05-02 – 2031-05-10" },
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
  });
});
