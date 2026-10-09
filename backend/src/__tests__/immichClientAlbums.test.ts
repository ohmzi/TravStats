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
