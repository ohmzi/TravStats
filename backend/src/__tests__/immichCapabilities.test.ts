/**
 * What an Immich API key may do, read once from `GET /api-keys/me` with a short
 * timeout. The answer is true or false when Immich said, and null when it could
 * not: callers read null as "could not verify", never as "denied".
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const getMyApiKey = jest.fn<() => Promise<{ permissions: string[] } | null>>();
const createImmichClient = jest.fn((_conn: unknown, _options?: unknown) => ({ getMyApiKey }));
jest.mock("../services/immich/immichClient", () => ({ createImmichClient }));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  ALBUM_SCOPES,
  CAPABILITY_TIMEOUT_MS,
  INSPECT_SCOPES,
  albumCapability,
  readKeyScopes,
  scopesMissing,
} from "../services/immich/immichCapabilities";
import { ImmichError } from "../services/immich/types";
import logger from "../utils/logger";

const mockedLogger = logger as jest.Mocked<typeof logger>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("scope lists", () => {
  it("pins the permissions each feature needs", () => {
    expect(ALBUM_SCOPES).toEqual(["album.read", "album.create", "albumAsset.create"]);
    expect(INSPECT_SCOPES).toEqual(["asset.read", "user.read", "asset.view"]);
    expect(CAPABILITY_TIMEOUT_MS).toBe(4_000);
  });
});

describe("scopesMissing", () => {
  it("lists what is absent, in the order required", () => {
    expect(scopesMissing(["album.read"], ALBUM_SCOPES)).toEqual([
      "album.create",
      "albumAsset.create",
    ]);
  });

  it('treats "all" as every scope', () => {
    expect(scopesMissing(["all"], ALBUM_SCOPES)).toEqual([]);
  });

  it("ignores permissions that were not asked about", () => {
    expect(scopesMissing(["asset.download", "album.read"], ["album.read"])).toEqual([]);
  });

  it("reports every scope for a key with none", () => {
    expect(scopesMissing([], INSPECT_SCOPES)).toEqual(["asset.read", "user.read", "asset.view"]);
  });
});

describe("readKeyScopes", () => {
  it("asks Immich once, as a user connection, with the short timeout", async () => {
    getMyApiKey.mockResolvedValue({ permissions: ["asset.read", "album.read"] });

    await expect(readKeyScopes("https://immich.lan", "k")).resolves.toEqual([
      "asset.read",
      "album.read",
    ]);
    expect(createImmichClient).toHaveBeenCalledWith(
      { baseUrl: "https://immich.lan", apiKey: "k", source: "user" },
      { timeoutMs: 4_000 }
    );
    expect(getMyApiKey).toHaveBeenCalledTimes(1);
  });

  it("answers null when Immich cannot say", async () => {
    getMyApiKey.mockResolvedValue(null);

    await expect(readKeyScopes("https://immich.lan", "k")).resolves.toBeNull();
  });

  it("answers null instead of throwing when the call fails, and logs the kind", async () => {
    getMyApiKey.mockRejectedValue(new ImmichError("unreachable", "Immich is unreachable"));

    await expect(readKeyScopes("https://immich.lan", "k")).resolves.toBeNull();
    expect(mockedLogger.warn).toHaveBeenCalledWith({
      message: "immich_capability_check_failed",
      context: { kind: "unreachable" },
    });
  });

  it("answers null for an unexpected throw too", async () => {
    getMyApiKey.mockRejectedValue(new TypeError("boom"));

    await expect(readKeyScopes("https://immich.lan", "k")).resolves.toBeNull();
    expect(mockedLogger.warn).toHaveBeenCalledWith({
      message: "immich_capability_check_failed",
      context: { kind: "unexpected" },
    });
  });
});

describe("albumCapability", () => {
  it("is true on both counts for a key with every scope", async () => {
    getMyApiKey.mockResolvedValue({
      permissions: [
        "asset.read",
        "user.read",
        "asset.view",
        "album.read",
        "album.create",
        "albumAsset.create",
      ],
    });

    await expect(albumCapability("https://immich.lan", "k")).resolves.toEqual({
      canCreateAlbums: true,
      canView: true,
      missingScopes: [],
    });
  });

  it('is true on both counts for an "all" key', async () => {
    getMyApiKey.mockResolvedValue({ permissions: ["all"] });

    await expect(albumCapability("https://immich.lan", "k")).resolves.toEqual({
      canCreateAlbums: true,
      canView: true,
      missingScopes: [],
    });
  });

  it("names the album scopes a read-only key lacks, and still allows viewing", async () => {
    getMyApiKey.mockResolvedValue({
      permissions: ["album.read", "asset.read", "asset.view", "asset.download", "user.read"],
    });

    await expect(albumCapability("https://immich.lan", "k")).resolves.toEqual({
      canCreateAlbums: false,
      canView: true,
      missingScopes: ["album.create", "albumAsset.create"],
    });
  });

  it("can create albums yet not view when a library-reading scope is missing", async () => {
    getMyApiKey.mockResolvedValue({
      permissions: ["album.read", "album.create", "albumAsset.create", "asset.read", "user.read"],
    });

    await expect(albumCapability("https://immich.lan", "k")).resolves.toEqual({
      canCreateAlbums: true,
      canView: false,
      missingScopes: [],
    });
  });

  it("answers null on both counts when Immich cannot say", async () => {
    getMyApiKey.mockResolvedValue(null);

    await expect(albumCapability("https://immich.lan", "k")).resolves.toEqual({
      canCreateAlbums: null,
      canView: null,
      missingScopes: [],
    });
  });

  it("never throws: a failing call reads as cannot say", async () => {
    getMyApiKey.mockRejectedValue(new ImmichError("auth", "Immich rejected the API key", 401));

    await expect(albumCapability("https://immich.lan", "k")).resolves.toEqual({
      canCreateAlbums: null,
      canView: null,
      missingScopes: [],
    });
  });
});
