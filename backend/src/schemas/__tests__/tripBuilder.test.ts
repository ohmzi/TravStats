import {
  albumRetryBodySchema,
  commitBodySchema,
  previewIndexParamSchema,
  previewSizeSchema,
  scanBodySchema,
} from "../tripBuilder";

// Synthetic fixtures only (public repository): invented places, shifted years.
const TRIP_ID = "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c";
const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const FLIGHT_ID = "9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a";
const NORTHVALE = "-901|3374|2031-05-02";
const PORT_CARROW = "-894|3383|2031-05-04";
const HOME = "-900|3370|2031-05-02";
/** Synthetic: two invented flights, joined the way a stopover key joins them (spec §2.3). */
const STOPOVER_KEY = "ff0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b#1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

type Parsed = {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> };
};
const issuePaths = (result: Parsed): string[] =>
  (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));

const scan = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

function station(key: string, firstDay: string, lastDay: string, kind = "visit") {
  return { key, title: "Northvale", lat: -45.05, lon: 168.7, kind, firstDay, lastDay };
}

function area(overrides: Record<string, unknown> = {}) {
  return {
    key: "2031-05-02#1",
    as: "roadtrip",
    name: "Northvale loop",
    homeStart: false,
    homeEnd: false,
    stations: [
      station(NORTHVALE, "2031-05-02", "2031-05-03"),
      station(PORT_CARROW, "2031-05-04", "2031-05-05"),
    ],
    legModes: ["ferry"],
    album: false,
    ...overrides,
  };
}

function stopover(overrides: Record<string, unknown> = {}) {
  return { key: STOPOVER_KEY, roadtrip: true, album: false, ...overrides };
}

function commit(overrides: Record<string, unknown> = {}) {
  return {
    commitKey: COMMIT_KEY,
    window: { startDay: "2031-05-02", endDay: "2031-05-05" },
    target: { kind: "new", trip: { name: "Northvale loop" } },
    flightIds: [FLIGHT_ID],
    nights: { "2031-05-02": NORTHVALE, "2031-05-03": NORTHVALE, "2031-05-04": "unknown" },
    areas: [area()],
    photoJourneyIds: [],
    album: { create: true, name: "Northvale loop" },
    ...overrides,
  };
}

describe("scanBodySchema", () => {
  it("accepts a new-trip scan and trims its name", () => {
    expect(scanBodySchema.parse({ ...scan, name: "  Northvale loop  " }).name).toBe(
      "Northvale loop"
    );
  });

  it("accepts an existing trip as the target", () => {
    const target = { kind: "existing", tripId: TRIP_ID };
    expect(scanBodySchema.safeParse({ ...scan, target }).success).toBe(true);
  });

  it("accepts a window of exactly 62 days", () => {
    expect(scanBodySchema.safeParse({ ...scan, endDay: "2031-07-02" }).success).toBe(true);
  });

  it("refuses a window of 63 days", () => {
    expect(issuePaths(scanBodySchema.safeParse({ ...scan, endDay: "2031-07-03" }))).toEqual([
      "endDay",
    ]);
  });

  it("refuses an end before the start", () => {
    expect(issuePaths(scanBodySchema.safeParse({ ...scan, endDay: "2031-05-01" }))).toEqual([
      "endDay",
    ]);
  });

  it("refuses a day that is not on the calendar", () => {
    expect(issuePaths(scanBodySchema.safeParse({ ...scan, endDay: "2031-02-30" }))).toEqual([
      "endDay",
    ]);
  });

  it("refuses a scan with both switches off", () => {
    expect(issuePaths(scanBodySchema.safeParse({ ...scan, inspect: false }))).toEqual(["inspect"]);
  });

  it("refuses a field it does not know", () => {
    expect(scanBodySchema.safeParse({ ...scan, albumName: "Northvale" }).success).toBe(false);
  });
});

describe("commitBodySchema", () => {
  it("accepts a one-roadtrip commit and drives it by car unless told otherwise", () => {
    expect(commitBodySchema.parse(commit()).areas[0].vehicle).toBe("car");
  });

  it("wants one leg mode per consecutive pair of stations", () => {
    const body = commit({ areas: [area({ legModes: ["ferry", "road"] })] });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.legModes"]);
  });

  it("refuses a station that ends before it starts", () => {
    const stations = [
      station(NORTHVALE, "2031-05-03", "2031-05-02"),
      station(PORT_CARROW, "2031-05-04", "2031-05-05"),
    ];
    const body = commit({ areas: [area({ stations })] });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["areas.0.stations.0.lastDay"]);
  });

  it("refuses a station key used twice across areas", () => {
    const body = commit({ areas: [area(), area({ key: "2031-05-04#1" })] });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual([
      "areas.1.stations.0.key",
      "areas.1.stations.1.key",
    ]);
  });

  it("ties homeStart to a home first station on a roadtrip", () => {
    expect(
      issuePaths(commitBodySchema.safeParse(commit({ areas: [area({ homeStart: true })] })))
    ).toEqual(["areas.0.homeStart"]);
    const stations = [
      station(HOME, "2031-05-02", "2031-05-02", "home"),
      station(NORTHVALE, "2031-05-02", "2031-05-03"),
      station(PORT_CARROW, "2031-05-04", "2031-05-05"),
    ];
    const withHome = area({ homeStart: true, stations, legModes: ["road", "ferry"] });
    expect(commitBodySchema.safeParse(commit({ areas: [withHome] })).success).toBe(true);
  });

  it("does not tie the home switches of a timeline-stop area", () => {
    const body = commit({ areas: [area({ as: "stops", homeStart: true })] });
    expect(commitBodySchema.safeParse(body).success).toBe(true);
  });

  it("refuses a night that is neither a station key nor home, unknown or flight", () => {
    const body = commit({ nights: { "2031-05-02": "Northvale" } });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["nights.2031-05-02"]);
  });

  it("caps the flights at 100", () => {
    const flightIds = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    expect(issuePaths(commitBodySchema.safeParse(commit({ flightIds })))).toEqual(["flightIds"]);
  });

  it("refuses a window longer than 62 days", () => {
    const body = commit({ window: { startDay: "2031-05-02", endDay: "2031-07-03" } });
    expect(issuePaths(commitBodySchema.safeParse(body))).toEqual(["window.endDay"]);
  });

  it("takes an existing trip with upper-case country codes only", () => {
    const target = { kind: "existing", tripId: TRIP_ID, applyWindow: true, countries: ["NZ"] };
    expect(commitBodySchema.safeParse(commit({ target })).success).toBe(true);
    const lower = { ...target, countries: ["nz"] };
    expect(issuePaths(commitBodySchema.safeParse(commit({ target: lower })))).toEqual([
      "target.countries.0",
    ]);
  });

  it("takes a pitstop area's album, refusing it beside a kind that is not a roadtrip", () => {
    expect(commitBodySchema.safeParse(commit({ areas: [area({ album: true })] })).success).toBe(
      true
    );
    const stops = commit({ areas: [area({ as: "stops", album: true })] });
    expect(issuePaths(commitBodySchema.safeParse(stops))).toEqual(["areas.0.album"]);
    const skipped = commit({ areas: [area({ as: "skip", album: true })] });
    expect(issuePaths(commitBodySchema.safeParse(skipped))).toEqual(["areas.0.album"]);
  });

  it("refuses a field inside an area it does not know", () => {
    expect(
      commitBodySchema.safeParse(commit({ areas: [area({ albumName: "Northvale" })] })).success
    ).toBe(false);
  });

  it("takes a stopover's switches, refusing an album without its roadtrip", () => {
    const body = commit({ stopovers: [stopover({ album: true })] });
    expect(commitBodySchema.safeParse(body).success).toBe(true);
    const albumOnly = commit({ stopovers: [stopover({ roadtrip: false, album: true })] });
    expect(issuePaths(commitBodySchema.safeParse(albumOnly))).toEqual(["stopovers.0.album"]);
  });

  it("refuses a stopover key used twice, or one that is not two flight ids", () => {
    const twice = commit({ stopovers: [stopover(), stopover()] });
    expect(issuePaths(commitBodySchema.safeParse(twice))).toEqual(["stopovers.1.key"]);
    const notAKey = commit({ stopovers: [stopover({ key: "2031-05-02#1" })] });
    expect(issuePaths(commitBodySchema.safeParse(notAKey))).toEqual(["stopovers.0.key"]);
  });

  it("defaults the stopovers to none and caps them at the flight budget", () => {
    expect(commitBodySchema.parse(commit()).stopovers).toEqual([]);
    const key = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}#00000000-0000-4000-8000-${String(
        n + 1000
      ).padStart(12, "0")}`;
    const stopovers = Array.from({ length: 101 }, (_, i) => stopover({ key: key(i) }));
    expect(issuePaths(commitBodySchema.safeParse(commit({ stopovers })))).toEqual(["stopovers"]);
  });

  it("refuses a field inside a stopover it does not know", () => {
    expect(
      commitBodySchema.safeParse(commit({ stopovers: [stopover({ name: "Northvale" })] })).success
    ).toBe(false);
  });
});

describe("route parameters", () => {
  it("addresses previews 0 … 399 and nothing else", () => {
    expect(previewIndexParamSchema.parse("0")).toBe(0);
    expect(previewIndexParamSchema.parse("399")).toBe(399);
    for (const bad of ["400", "-1", "x", "1.5"]) {
      expect(previewIndexParamSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("serves thumbnails by default and never an original", () => {
    expect(previewSizeSchema.parse(undefined)).toBe("thumbnail");
    expect(previewSizeSchema.parse("preview")).toBe("preview");
    expect(previewSizeSchema.safeParse("original").success).toBe(false);
  });

  it("takes an optional, trimmed album name, the pitstop key and nothing else", () => {
    expect(albumRetryBodySchema.parse({})).toEqual({});
    expect(albumRetryBodySchema.parse({ name: " Northvale " })).toEqual({ name: "Northvale" });
    expect(albumRetryBodySchema.safeParse({ name: "" }).success).toBe(false);
    expect(albumRetryBodySchema.safeParse({ name: "Northvale", extra: 1 }).success).toBe(false);
    expect(albumRetryBodySchema.parse({ pitstopKey: "2031-05-02#1" })).toEqual({
      pitstopKey: "2031-05-02#1",
    });
    expect(albumRetryBodySchema.safeParse({ pitstopKey: "not-a-key" }).success).toBe(false);
    expect(albumRetryBodySchema.safeParse({ pitstopKey: "" }).success).toBe(false);
    // The album's name may not name a pitstop's record: two areas in one city
    // and year share it (review round 2), so the old field is gone.
    expect(
      albumRetryBodySchema.safeParse({
        pitstopName: "Southbridge 2031 Road Trip (Southern loop)",
      }).success
    ).toBe(false);
  });
});
