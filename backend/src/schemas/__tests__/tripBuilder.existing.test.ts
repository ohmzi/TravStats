import { commitBodySchema } from "../tripBuilder";

// Synthetic fixtures only (public repository).
const TRIP_ID = "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c";
const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const ROADTRIP_ID = "0b1c2d3e-4f5a-4b6c-8d7e-8f9a0b1c2d3e";
const STATION_A = "11111111-1111-4111-8111-111111111111";
const STATION_B = "22222222-2222-4222-8222-222222222222";
const STOP_ID = "33333333-3333-4333-8333-333333333333";
const NOT_SEEN = "44444444-4444-4444-8444-444444444444";
const NORTHVALE = "-901|3374|2031-05-02";
const PORT_CARROW = "-894|3383|2031-05-04";
const KELMORE = "-908|3370|2031-05-06";

type Parsed = {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> };
};
const issuePaths = (result: Parsed): string[] =>
  (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));

function station(
  key: string,
  firstDay: string,
  lastDay: string,
  extra: Record<string, unknown> = {}
) {
  return {
    key,
    title: "Northvale",
    lat: -45.05,
    lon: 168.7,
    kind: "visit",
    firstDay,
    lastDay,
    ...extra,
  };
}

function roadtripArea(overrides: Record<string, unknown> = {}) {
  return {
    key: "2031-05-02#1",
    as: "roadtrip",
    name: "Northvale loop",
    homeStart: false,
    homeEnd: false,
    roadtripId: ROADTRIP_ID,
    stations: [
      station(NORTHVALE, "2031-05-02", "2031-05-03", { existingId: STATION_A }),
      station(PORT_CARROW, "2031-05-04", "2031-05-05", { existingId: STATION_B }),
    ],
    legModes: ["road"],
    keepNotSeen: [NOT_SEEN],
    ...overrides,
  };
}

function stopsArea(overrides: Record<string, unknown> = {}) {
  return {
    key: "2031-05-06#1",
    as: "stops",
    name: "Kelmore",
    homeStart: false,
    homeEnd: false,
    stations: [station(KELMORE, "2031-05-06", "2031-05-07", { existingId: STOP_ID })],
    legModes: [],
    ...overrides,
  };
}

function commit(overrides: Record<string, unknown> = {}) {
  return {
    commitKey: COMMIT_KEY,
    window: { startDay: "2031-05-02", endDay: "2031-05-07" },
    target: { kind: "existing", tripId: TRIP_ID, applyWindow: false },
    flightIds: [],
    nights: { "2031-05-02": NORTHVALE },
    areas: [roadtripArea()],
    photoJourneyIds: [],
    album: { create: true, name: "Northvale loop", removeOutside: true },
    ...overrides,
  };
}

const NEW_TARGET = { kind: "new", trip: { name: "Northvale loop" } };

describe("commitBodySchema, existing target", () => {
  it("accepts a commit that updates one roadtrip and one timeline stop in place", () => {
    const body = commit({ areas: [roadtripArea(), stopsArea()], stops: { keep: [], remove: [] } });
    expect(commitBodySchema.safeParse(body).success).toBe(true);
  });

  it("defaults the keep and remove lists to empty", () => {
    const parsed = commitBodySchema.parse(
      commit({ areas: [roadtripArea({ keepNotSeen: undefined })] })
    );
    expect(parsed.areas[0].keepNotSeen).toEqual([]);
    expect(parsed.areas[0].removeNotSeen).toEqual([]);
    expect(parsed.stops).toEqual({ keep: [], remove: [] });
  });

  it("refuses a roadtrip id on a new trip", () => {
    const body = commit({
      target: NEW_TARGET,
      album: { create: true, name: "Northvale loop" },
      areas: [
        roadtripArea({
          keepNotSeen: [],
          stations: [
            station(NORTHVALE, "2031-05-02", "2031-05-03"),
            station(PORT_CARROW, "2031-05-04", "2031-05-05"),
          ],
        }),
      ],
    });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.roadtripId"]);
  });

  it("refuses a stored station on a roadtrip that is new", () => {
    const body = commit({ areas: [roadtripArea({ roadtripId: undefined, keepNotSeen: [] })] });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual([
      "areas.0.stations.0.existingId",
      "areas.0.stations.1.existingId",
    ]);
  });

  it("refuses a stored station named twice", () => {
    const body = commit({
      areas: [
        roadtripArea({
          stations: [
            station(NORTHVALE, "2031-05-02", "2031-05-03", { existingId: STATION_A }),
            station(PORT_CARROW, "2031-05-04", "2031-05-05", { existingId: STATION_A }),
          ],
        }),
      ],
    });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.stations.1.existingId"]);
  });

  it("refuses a station that is both kept and removed", () => {
    const body = commit({
      areas: [roadtripArea({ keepNotSeen: [NOT_SEEN], removeNotSeen: [NOT_SEEN] })],
    });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.removeNotSeen.0"]);
  });

  it("refuses to call a listed station not seen", () => {
    const body = commit({ areas: [roadtripArea({ keepNotSeen: [STATION_A] })] });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.keepNotSeen.0"]);
  });

  it("refuses to turn a stored roadtrip into timeline stops", () => {
    const body = commit({ areas: [stopsArea({ roadtripId: ROADTRIP_ID })] });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.roadtripId"]);
  });

  it("refuses a timeline stop that is both kept and removed", () => {
    const body = commit({ areas: [], stops: { keep: [STOP_ID], remove: [STOP_ID] } });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["stops.remove.0"]);
  });

  it("refuses to call a listed timeline stop not seen", () => {
    const body = commit({ areas: [stopsArea()], stops: { keep: [STOP_ID], remove: [] } });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["stops.keep.0"]);
  });

  it("refuses album removal on a new trip", () => {
    const body = commit({
      target: NEW_TARGET,
      areas: [],
      album: { create: true, name: "Northvale loop", removeOutside: true },
    });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["album.removeOutside"]);
  });

  it("never takes an asset id from the client", () => {
    const ids = ["55555555-5555-4555-8555-555555555555"];
    const album = { create: true, name: "Northvale loop", removeOutside: true, ids };
    expect(commitBodySchema.safeParse(commit({ album })).success).toBe(false);
    const area = roadtripArea({ removeAssetIds: ids });
    expect(commitBodySchema.safeParse(commit({ areas: [area] })).success).toBe(false);
  });
});
