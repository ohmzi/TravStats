import { clockAssets } from "../clock";
import type { ClockContext, PhotoPoint } from "../types";
import { inWindow, scanWindow } from "../window";
import { makeAsset, NORTHVALE, OWNER, SALTMERE } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.
// Each invented place sits in a real zone only so the clock has one.

/** Corvel Bay: America/Panama, UTC−5 all year. */
const CORVEL_BAY = { lat: 8.98, lon: -79.52 };
/** Tarawind: Pacific/Kiritimati, UTC+14. */
const TARAWIND = { lat: 1.95, lon: -157.45 };
/** Vaimoor: Pacific/Pago_Pago, UTC−11. */
const VAIMOOR = { lat: -14.3, lon: -170.72 };
/** Ashgrove: Australia/Adelaide, +09:30, and +10:30 in the southern summer. */
const ASHGROVE = { lat: -34.9, lon: 138.62 };
/** A camera body: no GPS, no zone, a naive EXIF clock (case C). */
const CAMERA = { make: "Canon", model: "EOS R8" };
/** A file with no camera at all: a screenshot (case B). */
const SCREENSHOT = { make: null, model: null, originalFileName: "Screenshot_0001.png" };

const NOTHING: ClockContext = { homeZone: null, areaZones: [] };
const WINDOW = scanWindow("2031-05-02", "2031-05-09");
const OPEN = { fromMs: Number.NEGATIVE_INFINITY, toMs: Number.POSITIVE_INFINITY };

const clockOne = (asset: Parameters<typeof makeAsset>[0], ctx: ClockContext = NOTHING) =>
  clockAssets([makeAsset(asset)], ctx)[0];
const byId = (photos: PhotoPoint[]): Record<string, PhotoPoint> =>
  Object.fromEntries(photos.map((p) => [p.id, p]));

describe("clockAssets: which Immich clock gives the instant (§C.1)", () => {
  it("case A: a named zone makes fileCreatedAt the instant", () => {
    const p = clockOne({
      timeZone: "Pacific/Auckland",
      fileCreatedAt: "2031-05-03T01:15:00.000Z",
      localDateTime: "2031-05-03T13:15:00",
      ...NORTHVALE,
    });
    expect(p).toMatchObject({
      tMs: Date.parse("2031-05-03T01:15:00Z"),
      zone: "Pacific/Auckland",
      local: "2031-05-03 13:15",
      day: "2031-05-03",
      nightDay: "2031-05-03",
    });
    expect(p.flags).toMatchObject({
      clockCase: "A",
      zoneSource: "gps",
      dayGuessed: false,
      exifZoneOverridden: false,
    });
  });

  it("case B: a file with no camera trusts its file time, not the UTC clock Immich wrote", () => {
    const p = clockOne({
      ...SCREENSHOT,
      fileCreatedAt: "2031-05-03T01:15:00.000Z",
      localDateTime: "2031-05-03T01:15:00",
      ...NORTHVALE,
    });
    expect(p.flags.clockCase).toBe("B");
    expect(p).toMatchObject({ tMs: Date.parse("2031-05-03T01:15:00Z"), local: "2031-05-03 13:15" });
  });

  it("case B: a file created and modified at the same instant is a file-time fallback", () => {
    const p = clockOne({
      fileCreatedAt: "2031-05-03T01:15:00.000Z",
      fileModifiedAt: "2031-05-03T01:15:00.000Z",
      localDateTime: "2031-05-03T01:15:00",
      ...NORTHVALE,
    });
    expect(p.flags.clockCase).toBe("B");
    expect(p.local).toBe("2031-05-03 13:15");
  });

  it("case C: a camera's naive wall clock becomes an instant through the GPS zone", () => {
    const p = clockOne({
      ...CAMERA,
      fileCreatedAt: "2031-05-03T09:15:00.000Z",
      localDateTime: "2031-05-03T09:15:00",
      ...NORTHVALE,
    });
    expect(p.flags.clockCase).toBe("C");
    expect(p).toMatchObject({ tMs: Date.parse("2031-05-02T21:15:00Z"), local: "2031-05-03 09:15" });
  });

  it("a phone still on its departure offset after landing gets the GPS zone's day", () => {
    // Airplane mode since a UTC−4 departure: EXIF says 14:30 on 2 May, Northvale's clock 06:30 on 3 May.
    const p = clockOne({
      timeZone: "UTC-4",
      fileCreatedAt: "2031-05-02T18:30:00.000Z",
      localDateTime: "2031-05-02T14:30:00",
      ...NORTHVALE,
    });
    expect(p).toMatchObject({ local: "2031-05-03 06:30", day: "2031-05-03" });
    expect(p.flags).toMatchObject({ zoneSource: "gps", exifZoneOverridden: true });
  });

  it("a video Immich read as UTC is a real instant, and UTC is no disagreement", () => {
    const p = clockOne({
      type: "VIDEO",
      originalFileName: "IMG_0002.MOV",
      timeZone: "UTC+0",
      fileCreatedAt: "2031-05-03T08:00:00.000Z",
      localDateTime: "2031-05-03T08:00:00",
      ...NORTHVALE,
    });
    expect(p).toMatchObject({ zone: "Pacific/Auckland", local: "2031-05-03 20:00" });
    expect(p.flags).toMatchObject({ clockCase: "A", exifZoneOverridden: false });
  });

  it("does not count an EXIF offset that agrees with the GPS zone", () => {
    const p = clockOne({
      timeZone: "UTC+12",
      fileCreatedAt: "2031-05-03T08:00:00.000Z",
      ...NORTHVALE,
    });
    expect(p.flags.exifZoneOverridden).toBe(false);
  });
});

describe("clockAssets: the zone of a photo without GPS, first rule wins (§C.1)", () => {
  /** A located phone photo at Northvale: 08:00Z, 20:00 NZST on 3 May. */
  const NEIGHBOUR = {
    id: "neighbour",
    timeZone: "Pacific/Auckland",
    fileCreatedAt: "2031-05-03T08:00:00.000Z",
    ...NORTHVALE,
  };

  it("rule 2: an EXIF zone name", () => {
    const p = clockOne({ timeZone: "Pacific/Auckland", fileCreatedAt: "2031-05-03T08:00:00.000Z" });
    expect(p).toMatchObject({ zone: "Pacific/Auckland", local: "2031-05-03 20:00" });
    expect(p.flags).toMatchObject({ zoneSource: "exif", dayGuessed: false });
  });

  it("rule 2: a whole-hour EXIF offset, as its Etc zone", () => {
    const p = clockOne({ timeZone: "UTC+12", fileCreatedAt: "2031-05-03T08:00:00.000Z" });
    expect(p).toMatchObject({ zone: "Etc/GMT-12", local: "2031-05-03 20:00" });
    expect(p.flags.zoneSource).toBe("exif");
  });

  it.each([
    ["UTC+9:30", "2031-05-02T17:15:00.000Z", "2031-05-03 02:45"],
    ["UTC+5:45", "2031-05-02T17:15:00.000Z", "2031-05-02 23:00"],
    ["UTC+10:30", "2031-01-10T12:00:00.000Z", "2031-01-10 22:30"],
    ["UTC-2:30", "2031-07-10T12:00:00.000Z", "2031-07-10 09:30"],
  ])(
    "rule 2: the fractional EXIF offset %s keeps its exact clock",
    (timeZone, fileCreatedAt, local) => {
      const p = clockOne({ timeZone, fileCreatedAt });
      expect(p.local).toBe(local);
      expect(p.flags).toMatchObject({ zoneSource: "exif", dayGuessed: false });
    }
  );

  it("rule 3: the nearest located photo within 12 h lends its zone, and the day is a guess", () => {
    const video = {
      id: "video",
      type: "VIDEO" as const,
      timeZone: "UTC",
      fileCreatedAt: "2031-05-03T10:00:00.000Z",
    };
    const p = byId(clockAssets([makeAsset(NEIGHBOUR), makeAsset(video)], NOTHING)).video;
    expect(p).toMatchObject({ zone: "Pacific/Auckland", local: "2031-05-03 22:00" });
    expect(p.flags).toMatchObject({ zoneSource: "neighbour", dayGuessed: true });
  });

  it("rule 3: a naive clock finds its neighbour by wall clock, then becomes an instant", () => {
    const phone = {
      id: "phone",
      timeZone: "Pacific/Auckland",
      fileCreatedAt: "2031-05-02T21:15:00.000Z",
      ...NORTHVALE,
    };
    const camera = {
      id: "camera",
      ...CAMERA,
      fileCreatedAt: "2031-05-03T10:00:00.000Z",
      localDateTime: "2031-05-03T10:00:00",
    };
    const p = byId(clockAssets([makeAsset(phone), makeAsset(camera)], NOTHING)).camera;
    expect(p).toMatchObject({
      zone: "Pacific/Auckland",
      tMs: Date.parse("2031-05-02T22:00:00Z"),
      local: "2031-05-03 10:00",
    });
    expect(p.flags).toMatchObject({ clockCase: "C", zoneSource: "neighbour" });
  });

  it("rule 3: a located photo more than 12 h away lends nothing", () => {
    const late = { id: "late", timeZone: "UTC", fileCreatedAt: "2031-05-03T20:00:01.000Z" };
    const p = byId(clockAssets([makeAsset(NEIGHBOUR), makeAsset(late)], NOTHING)).late;
    expect(p.flags.zoneSource).toBe("utc");
  });

  it("rule 4: the flight-bounded stretch's zone, ahead of home", () => {
    const ctx: ClockContext = {
      homeZone: "Pacific/Auckland",
      areaZones: [{ ...OPEN, zone: "America/La_Paz" }],
    };
    const p = clockOne({ timeZone: "UTC", fileCreatedAt: "2031-05-10T01:30:00.000Z" }, ctx);
    expect(p).toMatchObject({ zone: "America/La_Paz", local: "2031-05-09 21:30" });
    expect(p.flags).toMatchObject({ zoneSource: "area", dayGuessed: true });
  });

  it("rule 4: a naive clock takes the stretch whose own zone puts it inside", () => {
    const cut = Date.parse("2031-05-04T00:00:00Z");
    const ctx: ClockContext = {
      homeZone: null,
      areaZones: [
        { fromMs: Number.NEGATIVE_INFINITY, toMs: cut, zone: "Pacific/Auckland" },
        { fromMs: cut, toMs: Number.POSITIVE_INFINITY, zone: "America/La_Paz" },
      ],
    };
    const photos = byId(
      clockAssets(
        [
          makeAsset({ id: "before", ...CAMERA, localDateTime: "2031-05-03T11:30:00" }),
          makeAsset({ id: "after", ...CAMERA, localDateTime: "2031-05-04T20:00:00" }),
        ],
        ctx
      )
    );
    expect(photos.before).toMatchObject({
      zone: "Pacific/Auckland",
      tMs: Date.parse("2031-05-02T23:30:00Z"),
    });
    expect(photos.after).toMatchObject({
      zone: "America/La_Paz",
      tMs: Date.parse("2031-05-05T00:00:00Z"),
    });
  });

  it("rule 5: the home zone, when nothing else names one", () => {
    const ctx: ClockContext = { homeZone: "Pacific/Auckland", areaZones: [] };
    const p = clockOne({ timeZone: "UTC", fileCreatedAt: "2031-05-03T08:00:00.000Z" }, ctx);
    expect(p).toMatchObject({ zone: "Pacific/Auckland", local: "2031-05-03 20:00" });
    expect(p.flags).toMatchObject({ zoneSource: "home", dayGuessed: true });
  });

  it("rule 6: UTC, as the last resort", () => {
    const p = clockOne({ timeZone: "UTC", fileCreatedAt: "2031-05-03T08:00:00.000Z" });
    expect(p).toMatchObject({ zone: "UTC", local: "2031-05-03 08:00" });
    expect(p.flags).toMatchObject({ zoneSource: "utc", dayGuessed: true });
  });

  it("keeps an unlocated naive clock with nothing to go on as its own wall clock", () => {
    const p = clockOne({ ...CAMERA, localDateTime: "2031-05-03T09:15:00" });
    expect(p).toMatchObject({
      zone: "UTC",
      local: "2031-05-03 09:15",
      tMs: Date.parse("2031-05-03T09:15:00Z"),
    });
  });
});

describe("clockAssets: the trip's days on the place's own clock (decision 10)", () => {
  it("keeps a screenshot taken at 21:30 on E at UTC−4", () => {
    const evening = {
      id: "evening",
      timeZone: "America/La_Paz",
      fileCreatedAt: "2031-05-10T00:00:00.000Z",
      ...SALTMERE,
    };
    const shot = {
      id: "shot",
      ...SCREENSHOT,
      fileCreatedAt: "2031-05-10T01:30:00.000Z",
      localDateTime: "2031-05-10T01:30:00",
    };
    const p = byId(clockAssets([makeAsset(evening), makeAsset(shot)], NOTHING)).shot;
    expect(p).toMatchObject({ local: "2031-05-09 21:30", day: "2031-05-09" });
    expect(p.flags.dayGuessed).toBe(true);
    expect(inWindow(p.day, WINDOW)).toBe(true);
    expect(p.tMs).toBeLessThan(WINDOW.fetchTo.getTime());
  });

  it("drops a screenshot taken at 21:00 on S − 1 at UTC−4", () => {
    const evening = {
      id: "evening",
      timeZone: "America/La_Paz",
      fileCreatedAt: "2031-05-01T23:00:00.000Z",
      ...SALTMERE,
    };
    const shot = {
      id: "shot",
      ...SCREENSHOT,
      fileCreatedAt: "2031-05-02T01:00:00.000Z",
      localDateTime: "2031-05-02T01:00:00",
    };
    const p = byId(clockAssets([makeAsset(evening), makeAsset(shot)], NOTHING)).shot;
    expect(p.day).toBe("2031-05-01");
    expect(inWindow(p.day, WINDOW)).toBe(false);
  });

  it("keeps a photo taken at 21:30 on E at UTC−5", () => {
    const p = clockOne({
      timeZone: "America/Panama",
      fileCreatedAt: "2031-05-10T02:30:00.000Z",
      ...CORVEL_BAY,
    });
    expect(p).toMatchObject({ local: "2031-05-09 21:30", day: "2031-05-09" });
    expect(inWindow(p.day, WINDOW)).toBe(true);
    expect(p.tMs).toBeLessThan(WINDOW.fetchTo.getTime());
  });

  it("keeps 00:30 on S at UTC+14, and gives it to the night before", () => {
    const p = clockOne({ ...CAMERA, localDateTime: "2031-05-02T00:30:00", ...TARAWIND });
    expect(p).toMatchObject({
      tMs: Date.parse("2031-05-01T10:30:00Z"),
      day: "2031-05-02",
      nightDay: "2031-05-01",
    });
    expect(inWindow(p.day, WINDOW)).toBe(true);
    expect(p.tMs).toBeGreaterThanOrEqual(WINDOW.fetchFrom.getTime());
  });

  it("keeps 23:30 on E at UTC−11", () => {
    const p = clockOne({
      timeZone: "Pacific/Pago_Pago",
      fileCreatedAt: "2031-05-10T10:30:00.000Z",
      ...VAIMOOR,
    });
    expect(p).toMatchObject({ local: "2031-05-09 23:30", day: "2031-05-09" });
    expect(inWindow(p.day, WINDOW)).toBe(true);
  });

  it("reads a half-hour zone's naive clock on both sides of its daylight change", () => {
    const photos = byId(
      clockAssets(
        [
          makeAsset({ id: "winter", ...CAMERA, localDateTime: "2031-05-03T02:45:00", ...ASHGROVE }),
          makeAsset({ id: "summer", ...CAMERA, localDateTime: "2031-01-10T22:30:00", ...ASHGROVE }),
        ],
        NOTHING
      )
    );
    expect(photos.winter).toMatchObject({
      tMs: Date.parse("2031-05-02T17:15:00Z"),
      nightDay: "2031-05-02",
    });
    expect(photos.summer).toMatchObject({
      tMs: Date.parse("2031-01-10T12:00:00Z"),
      local: "2031-01-10 22:30",
    });
  });
});

describe("clockAssets: what it hands on", () => {
  it("orders by instant even where the wall clocks say otherwise", () => {
    const photos = clockAssets(
      [
        makeAsset({
          id: "west",
          timeZone: "Pacific/Pago_Pago",
          fileCreatedAt: "2031-05-02T10:30:00.000Z",
          ...VAIMOOR,
        }),
        makeAsset({ id: "east", ...CAMERA, localDateTime: "2031-05-02T00:30:00", ...TARAWIND }),
      ],
      NOTHING
    );
    expect(photos.map((p) => [p.id, p.day])).toEqual([
      ["east", "2031-05-02"],
      ["west", "2031-05-01"],
    ]);
  });

  it("copies what later steps read and leaves every movement flag off", () => {
    const p = clockOne({
      id: "copied",
      timeZone: "Pacific/Auckland",
      city: "Northvale",
      state: "Westshire",
      country: "Carrow Isles",
      duplicateId: "dup-1",
      isFavorite: true,
      visibility: "archive",
      ...NORTHVALE,
    });
    expect(p).toMatchObject({
      id: "copied",
      type: "IMAGE",
      ownerId: OWNER,
      visibility: "archive",
      city: "Northvale",
      state: "Westshire",
      country: "Carrow Isles",
      make: "Apple",
      model: "iPhone 14",
      originalFileName: "IMG_0001.HEIC",
      isFavorite: true,
      duplicateId: "dup-1",
      lat: NORTHVALE.lat,
      lon: NORTHVALE.lon,
    });
    expect(p.flags).toMatchObject({
      located: false,
      duplicate: false,
      misdated: null,
      atSea: false,
      inFlight: false,
      layover: false,
    });
  });
});
