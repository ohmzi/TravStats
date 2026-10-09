/**
 * The two searches the trip builder runs against `POST /search/metadata`:
 * every asset of a time window, and the assets whose file name contains a
 * fragment. Both use the legacy flat body (this client is pinned to the 3.0.1
 * API; the structured `filter` body exists only from v3.2), so these tests pin
 * the exact bodies.
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
import logger from "../utils/logger";

const mockedLogger = logger as jest.Mocked<typeof logger>;

const CONN: ImmichConnection = {
  baseUrl: "https://immich.lan",
  apiKey: "secret-key",
  source: "user",
};

// Synthetic window (public repository): an invented trip in 2031.
const RANGE = {
  takenAfter: new Date("2031-05-01T10:00:00Z"),
  takenBefore: new Date("2031-05-09T12:00:00Z"),
};

beforeEach(() => {
  jest.resetAllMocks();
});

/** A search hit as Immich sends it. */
function asset(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "IMAGE",
    ownerId: "owner-1",
    fileCreatedAt: "2031-05-03T02:07:09.000Z",
    localDateTime: "2031-05-03T14:07:09.000Z",
    originalFileName: `${id}.jpg`,
    originalMimeType: "image/jpeg",
    visibility: "timeline",
    exifInfo: {
      latitude: -45.05,
      longitude: 168.7,
      timeZone: "Pacific/Auckland",
      city: "Northvale",
    },
    ...extra,
  };
}

/** One page of Immich's search answer. */
function page(items: unknown[], nextPage: string | null) {
  return { data: { assets: { items, nextPage } } };
}

describe("searchWindowAssets", () => {
  it("POSTs the flat window body: no type field, EXIF on, oldest first, 1000 a page", async () => {
    mockedAxios.post.mockResolvedValueOnce(page([asset("p1")], null));

    await createImmichClient(CONN).searchWindowAssets(RANGE);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://immich.lan/api/search/metadata",
      {
        takenAfter: "2031-05-01T10:00:00.000Z",
        takenBefore: "2031-05-09T12:00:00.000Z",
        withExif: true,
        order: "asc",
        page: 1,
        size: 1000,
      },
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } })
    );
    // Photos and videos are both wanted, so Immich must not be told a type.
    expect(mockedAxios.post.mock.calls[0][1]).not.toHaveProperty("type");
  });

  it("maps each hit to an asset with its clock, zone, owner and place", async () => {
    mockedAxios.post.mockResolvedValueOnce(page([asset("p1")], null));

    const result = await createImmichClient(CONN).searchWindowAssets(RANGE);

    expect(result.truncated).toBe(false);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      id: "p1",
      localDateTime: "2031-05-03T14:07:09",
      timeZone: "Pacific/Auckland",
      city: "Northvale",
      ownerId: "owner-1",
      visibility: "timeline",
      lat: -45.05,
      lon: 168.7,
    });
  });

  it("follows nextPage and keeps Immich's order", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(page([asset("p1")], "2"))
      .mockResolvedValueOnce(page([asset("p2")], null));

    const result = await createImmichClient(CONN).searchWindowAssets(RANGE);

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://immich.lan/api/search/metadata",
      expect.objectContaining({ page: 2, size: 1000 }),
      expect.anything()
    );
    expect(result.assets.map((a) => a.id)).toEqual(["p1", "p2"]);
  });

  it("de-duplicates by id when an upload mid-scan shifts the offset pages", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(page([asset("p1"), asset("p2")], "2"))
      .mockResolvedValueOnce(page([asset("p2"), asset("p3")], null));

    const result = await createImmichClient(CONN).searchWindowAssets(RANGE);

    expect(result.assets.map((a) => a.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("drops what is neither a photo nor a video", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      page([asset("p1"), asset("a1", { type: "AUDIO" }), asset("v1", { type: "VIDEO" })], null)
    );

    const result = await createImmichClient(CONN).searchWindowAssets(RANGE);

    expect(result.assets.map((a) => a.id)).toEqual(["p1", "v1"]);
  });

  it("tells the progress callback the page and the running total after each page", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(page([asset("p1"), asset("p2")], "2"))
      .mockResolvedValueOnce(page([asset("p2"), asset("p3")], null));
    const onPage = jest.fn();

    await createImmichClient(CONN).searchWindowAssets(RANGE, onPage);

    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenNthCalledWith(1, 1, 2);
    // p2 came twice; the total counts it once.
    expect(onPage).toHaveBeenNthCalledWith(2, 2, 3);
  });

  it("stops at 50 pages, says it was cut short and logs it", async () => {
    let calls = 0;
    mockedAxios.post.mockImplementation(async () => {
      calls += 1;
      return page([asset(`p${calls}`)], "more");
    });
    const onPage = jest.fn();

    const result = await createImmichClient(CONN).searchWindowAssets(RANGE, onPage);

    expect(mockedAxios.post).toHaveBeenCalledTimes(50);
    expect(result.assets).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(onPage).toHaveBeenLastCalledWith(50, 50);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "immich_window_search_truncated",
        context: expect.objectContaining({ maxPages: 50, collectedCount: 50 }),
      })
    );
  });

  it("is not truncated when the 50th page is the last one", async () => {
    let calls = 0;
    mockedAxios.post.mockImplementation(async () => {
      calls += 1;
      return page([asset(`p${calls}`)], calls < 50 ? "more" : null);
    });

    const result = await createImmichClient(CONN).searchWindowAssets(RANGE);

    expect(result.assets).toHaveLength(50);
    expect(result.truncated).toBe(false);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it("returns an empty window as empty, not as an error", async () => {
    mockedAxios.post.mockResolvedValueOnce(page([], null));

    await expect(createImmichClient(CONN).searchWindowAssets(RANGE)).resolves.toEqual({
      assets: [],
      truncated: false,
    });
  });

  it("rejects a payload without an item list as kind=protocol", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assets: {} } });

    await expect(createImmichClient(CONN).searchWindowAssets(RANGE)).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("maps an upstream 502 to kind=unreachable and does not retry", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 502, data: {} },
    });

    await expect(createImmichClient(CONN).searchWindowAssets(RANGE)).rejects.toMatchObject({
      kind: "unreachable",
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
