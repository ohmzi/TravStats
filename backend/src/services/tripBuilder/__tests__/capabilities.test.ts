// An unverifiable key is logged (kind only); keep the warning out of the test output.
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../immich/immichClient", () => ({ createImmichClient: jest.fn() }));
jest.mock("../../immich/immichResolver", () => ({ getImmichConnection: jest.fn() }));
jest.mock("../../home/homeStore", () => ({ loadHomePeriods: jest.fn() }));
jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));
jest.mock("../probe", () => ({ resolveRoadProbes: jest.fn() }));

import logger from "../../../utils/logger";
import { loadVisibleDomains } from "../../domainVisibility";
import { loadHomePeriods } from "../../home/homeStore";
import { createImmichClient } from "../../immich/immichClient";
import { getImmichConnection } from "../../immich/immichResolver";
import { ImmichError } from "../../immich/types";
import { builderCapabilities } from "../capabilities";
import { resolveRoadProbes } from "../probe";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const getMyApiKey = jest.fn();
const userConn = { baseUrl: "http://immich.test", apiKey: "key", source: "user" as const };
const FULL = [
  "asset.read",
  "user.read",
  "asset.view",
  "album.read",
  "album.create",
  "albumAsset.create",
];

beforeEach(() => {
  jest.clearAllMocks();
  (createImmichClient as jest.Mock).mockReturnValue({ getMyApiKey });
  (getImmichConnection as jest.Mock).mockResolvedValue(userConn);
  (loadVisibleDomains as jest.Mock).mockResolvedValue(["flight", "roadtrip"]);
  (resolveRoadProbes as jest.Mock).mockResolvedValue({
    available: true,
    canProbe: true,
    probes: {},
  });
  (loadHomePeriods as jest.Mock).mockResolvedValue([]);
  getMyApiKey.mockResolvedValue({ permissions: FULL });
});

describe("builderCapabilities", () => {
  it("reports nothing configured without a connection", async () => {
    (getImmichConnection as jest.Mock).mockResolvedValue(null);
    const caps = await builderCapabilities(USER);
    expect(caps.immich).toEqual({
      configured: false,
      source: null,
      inspect: { ok: null, missingScopes: [] },
      album: { canCreate: false, reason: "notConfigured" },
    });
    expect(createImmichClient).not.toHaveBeenCalled();
  });

  it("allows both on the user's own full key, asking Immich with a four-second client", async () => {
    const caps = await builderCapabilities(USER);
    expect(createImmichClient).toHaveBeenCalledWith(userConn, { timeoutMs: 4000 });
    expect(caps.immich).toEqual({
      configured: true,
      source: "user",
      inspect: { ok: true, missingScopes: [] },
      album: { canCreate: true, reason: null },
    });
  });

  it("lists what a read-only key lacks for inspecting and for albums", async () => {
    getMyApiKey.mockResolvedValue({ permissions: ["asset.read", "album.read"] });
    const { immich } = await builderCapabilities(USER);
    expect(immich.inspect).toEqual({ ok: false, missingScopes: ["user.read", "asset.view"] });
    expect(immich.album).toEqual({ canCreate: false, reason: "missingScopes" });
  });

  it("refuses albums on a shared connection without asking Immich for its key", async () => {
    (getImmichConnection as jest.Mock).mockResolvedValue({ ...userConn, source: "global" });
    const { immich } = await builderCapabilities(USER);
    expect(immich).toEqual({
      configured: true,
      source: "global",
      inspect: { ok: null, missingScopes: [] },
      album: { canCreate: false, reason: "sharedConnection" },
    });
    expect(getMyApiKey).not.toHaveBeenCalled();
    expect(createImmichClient).not.toHaveBeenCalled();
  });

  it("makes no Immich call at all for the server's environment connection either", async () => {
    (getImmichConnection as jest.Mock).mockResolvedValue({ ...userConn, source: "env" });
    const { immich } = await builderCapabilities(USER);
    expect(immich).toEqual({
      configured: true,
      source: "env",
      inspect: { ok: null, missingScopes: [] },
      album: { canCreate: false, reason: "sharedConnection" },
    });
    expect(createImmichClient).not.toHaveBeenCalled();
    expect(getMyApiKey).not.toHaveBeenCalled();
  });

  it("says 'unverified' when Immich cannot be asked", async () => {
    getMyApiKey.mockRejectedValue(new Error("timeout"));
    expect((await builderCapabilities(USER)).immich).toMatchObject({
      inspect: { ok: null },
      album: { canCreate: null, reason: "unverified" },
    });
    getMyApiKey.mockResolvedValue(null);
    expect((await builderCapabilities(USER)).immich.album).toEqual({
      canCreate: null,
      reason: "unverified",
    });
  });

  it("logs why a key could not be verified, with the error kind and no detail", async () => {
    const warn = jest.mocked(logger.warn);
    warn.mockClear();

    getMyApiKey.mockRejectedValue(new ImmichError("unreachable", "Immich is unreachable"));
    await builderCapabilities(USER);
    getMyApiKey.mockRejectedValue(new Error("timeout"));
    await builderCapabilities(USER);

    expect(warn.mock.calls).toEqual([
      [{ message: "immich_capability_check_failed", context: { kind: "unreachable" } }],
      [{ message: "immich_capability_check_failed", context: { kind: "unexpected" } }],
    ]);
  });

  it("reports roadtrips, routing and home", async () => {
    (loadVisibleDomains as jest.Mock).mockResolvedValue(["flight"]);
    (resolveRoadProbes as jest.Mock).mockResolvedValue({
      available: true,
      canProbe: false,
      probes: null,
    });
    (loadHomePeriods as jest.Mock).mockResolvedValue([
      {
        fromDate: "2020-01-01",
        toDate: null,
        residence: { name: "Kelmore, Westshire", lat: -45.6, lon: 169.3 },
        residenceConfirmed: false,
        airports: [{ code: "ZKM", primary: true }],
      },
    ]);
    const caps = await builderCapabilities(USER);
    expect(caps).toMatchObject({
      roadtrips: false,
      routing: { available: true, canProbe: false },
      home: { known: true, confirmed: false },
    });
  });
});
