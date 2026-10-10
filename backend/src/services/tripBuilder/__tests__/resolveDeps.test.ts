// A failed Immich call is logged with its status and detail; keep that out of the test output.
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../immich/immichClient", () => ({ createImmichClient: jest.fn() }));
jest.mock("../../immich/immichResolver", () => ({ getImmichConnection: jest.fn() }));
jest.mock("../../home/homeStore", () => ({ loadHomePeriods: jest.fn() }));
jest.mock("../../geo/countryFromCoordinates", () => ({ getCountryResolver: jest.fn() }));
jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));
jest.mock("../probe", () => ({ resolveRoadProbes: jest.fn() }));
jest.mock("../builderQueries", () => ({
  ...jest.requireActual("../builderQueries"),
  loadTargetTrip: jest.fn(),
}));
jest.mock("../existingState", () => ({
  ...jest.requireActual("../existingState"),
  loadExistingState: jest.fn(),
}));

import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { createImmichClient } from "../../immich/immichClient";
import { getImmichConnection } from "../../immich/immichResolver";
import { ImmichError } from "../../immich/types";
import { loadHomePeriods } from "../../home/homeStore";
import { getCountryResolver } from "../../geo/countryFromCoordinates";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildTripDraft } from "../buildDraft";
import { loadTargetTrip } from "../builderQueries";
import { loadExistingState } from "../existingState";
import { resolveRoadProbes } from "../probe";
import { resolveBuilderDeps } from "../resolveDeps";
import type { ScanInput } from "../types";

const mockClient = createImmichClient as jest.Mock;
const mockConnection = getImmichConnection as jest.Mock;

const ME = "0b6f3a52-5d1c-4f43-9c1e-6a7b8c9d0e1f";
const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const CONN = { baseUrl: "http://immich.test", apiKey: "key", source: "user" as const };
const INPUT: ScanInput = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-04",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const searchWindowAssets = jest.fn();
const getMyApiKey = jest.fn();
const whoami = jest.fn();
const findOwnedAlbumByName = jest.fn();

// The empty-library scan reads flights, trips and findings from the test database.
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  whoami.mockResolvedValue({ id: ME, email: "me@example.test", name: "Me" });
  searchWindowAssets.mockResolvedValue({ assets: [], truncated: false });
  mockClient.mockReturnValue({
    whoami,
    getMyApiKey,
    findOwnedAlbumByName,
    searchWindowAssets,
    searchByFileName: jest.fn().mockResolvedValue([]),
  });
  mockConnection.mockResolvedValue(CONN);
  (loadHomePeriods as jest.Mock).mockResolvedValue([]);
  (getCountryResolver as jest.Mock).mockResolvedValue({ countryAt: () => "NZ" });
  (loadVisibleDomains as jest.Mock).mockResolvedValue(["flight", "roadtrip"]);
  (resolveRoadProbes as jest.Mock).mockResolvedValue({
    available: false,
    canProbe: false,
    probes: null,
  });
  (loadTargetTrip as jest.Mock).mockResolvedValue(null);
});

describe("resolveBuilderDeps", () => {
  it("takes the Immich user from whoami and roadtrip visibility from the user's domains", async () => {
    const deps = await resolveBuilderDeps(USER, INPUT, CONN);
    expect(deps).toMatchObject({
      immichUserId: ME,
      connSource: "user",
      roadtripsVisible: true,
      album: null,
      existing: null,
    });
    expect(deps.countryAt(-45, 168)).toBe("NZ");

    (loadVisibleDomains as jest.Mock).mockResolvedValue(["flight"]);
    expect((await resolveBuilderDeps(USER, INPUT, CONN)).roadtripsVisible).toBe(false);
  });

  it("gates the album with a four-second client and the user's own key scopes", async () => {
    getMyApiKey.mockResolvedValue({ permissions: ["album.read"] });
    findOwnedAlbumByName.mockResolvedValue({
      id: "album-1",
      albumName: "Northvale loop",
      assetCount: 7,
    });

    const deps = await resolveBuilderDeps(USER, { ...INPUT, createAlbum: true }, CONN);

    expect(mockClient).toHaveBeenCalledWith(CONN, { timeoutMs: 4000 });
    expect(deps.album?.gate).toEqual({
      allowed: false,
      blockedReason: "missingScopes",
      missingScopes: ["album.create", "albumAsset.create"],
    });
    expect(await deps.album?.findOwned("Northvale loop")).toEqual({
      immichAlbumId: "album-1",
      assetCount: 7,
    });
    expect(findOwnedAlbumByName).toHaveBeenCalledWith("Northvale loop", ME);
  });

  it("loads the target trip for an existing-trip scan", async () => {
    const trip = {
      id: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01",
      name: "Spring",
      countries: [],
      roadtripNames: [],
    };
    (loadTargetTrip as jest.Mock).mockResolvedValue(trip);
    const deps = await resolveBuilderDeps(
      USER,
      { ...INPUT, target: { kind: "existing", tripId: trip.id } },
      CONN
    );
    expect(deps.targetTrip).toEqual(trip);
    expect(loadTargetTrip).toHaveBeenCalledWith(USER, trip.id);
  });

  it("reads what an existing trip holds, with the Immich user and client to preview its album", async () => {
    const tripId = "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01";
    const state = { tripId, tripName: "Spring", albums: [] };
    (loadExistingState as jest.Mock).mockResolvedValue(state);

    const deps = await resolveBuilderDeps(
      USER,
      { ...INPUT, target: { kind: "existing", tripId } },
      CONN
    );

    expect(loadExistingState).toHaveBeenCalledWith(USER, tripId, expect.any(Function));
    expect(deps.existing).toEqual({
      state,
      client: mockClient.mock.results[0].value,
      immichUserId: ME,
    });
  });

  it("reads no trip state for a new trip", async () => {
    await resolveBuilderDeps(USER, INPUT, CONN);
    expect(loadExistingState).not.toHaveBeenCalled();
  });
});

describe("buildTripDraft", () => {
  it("refuses a user with no Immich connection", async () => {
    mockConnection.mockResolvedValue(null);
    await expect(buildTripDraft(USER, INPUT, () => undefined)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("builds an empty draft over an empty library", async () => {
    const draft = await buildTripDraft(USER, INPUT, () => undefined);
    expect(draft).toMatchObject({ ownerId: USER, immichUserId: ME, status: "ready" });
    expect(draft.dto.warnings).toEqual([
      {
        code: "emptyWindow",
        params: {
          checkedFrom: "2031-04-29",
          checkedTo: "2031-05-07",
          partner: 0,
          trashedNote: true,
        },
      },
    ]);
  });

  it("turns an Immich failure into a stable job error code", async () => {
    whoami.mockRejectedValue(new ImmichError("unreachable", "Immich is unreachable (users/me)"));
    await expect(buildTripDraft(USER, INPUT, () => undefined)).rejects.toMatchObject({
      message: "immich_unreachable",
      statusCode: 502,
    });
  });

  it("logs the failing call, status and missing scope before the code replaces them", async () => {
    whoami.mockRejectedValue(
      new ImmichError("auth", "Immich key lacks the album.create permission", 403, {
        missingScope: "album.create",
      })
    );
    await expect(buildTripDraft(USER, INPUT, () => undefined)).rejects.toMatchObject({
      message: "immich_auth",
      statusCode: 502,
    });
    expect(logger.warn).toHaveBeenCalledWith({
      message: "trip_builder_immich_failure",
      context: {
        kind: "auth",
        status: 403,
        detail: "Immich key lacks the album.create permission",
      },
    });
  });

  it("does not log an error that is not an Immich failure", async () => {
    whoami.mockRejectedValue(new Error("boom"));
    await expect(buildTripDraft(USER, INPUT, () => undefined)).rejects.toThrow("boom");
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
