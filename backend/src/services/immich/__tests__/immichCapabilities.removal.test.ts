import { describe, it, expect, jest } from "@jest/globals";

import {
  ALBUM_OPTIONAL_SCOPES,
  ALBUM_REMOVE_SCOPE,
  ALBUM_SCOPES,
  albumRemovalCapability,
} from "../immichCapabilities";

const keyWith = (permissions: string[] | null) => ({
  getMyApiKey: jest.fn(async () => (permissions === null ? null : { permissions })),
});

describe("the optional album scope", () => {
  it("is optional: the scopes an album needs do not include it", () => {
    expect(ALBUM_REMOVE_SCOPE).toBe("albumAsset.delete");
    expect(ALBUM_OPTIONAL_SCOPES).toEqual(["albumAsset.delete"]);
    expect(ALBUM_SCOPES).not.toContain("albumAsset.delete");
  });

  it("allows removal when the key grants the scope", async () => {
    const granted = ["album.read", "album.create", "albumAsset.create", "albumAsset.delete"];
    expect(await albumRemovalCapability(keyWith(granted))).toEqual({ allowed: true });
  });

  it("allows removal for an all-access key", async () => {
    expect(await albumRemovalCapability(keyWith(["all"]))).toEqual({ allowed: true });
  });

  it("names the scope when the key lacks it", async () => {
    const granted = ["album.read", "album.create", "albumAsset.create"];
    expect(await albumRemovalCapability(keyWith(granted))).toEqual({
      allowed: false,
      missingScope: "albumAsset.delete",
    });
  });

  it("says unknown when the key cannot be read, and when the call fails", async () => {
    expect(await albumRemovalCapability(keyWith(null))).toEqual({ allowed: null });
    const failing = {
      getMyApiKey: jest.fn(async () => {
        throw new Error("timeout");
      }),
    };
    expect(await albumRemovalCapability(failing)).toEqual({ allowed: null });
  });
});
