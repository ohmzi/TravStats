import { clusterCities, clusterOfPhoto } from "../cityClusters";
import { cleanAssets } from "../clean";
import type { PhotoPoint } from "../types";
import { scanWindow } from "../window";
import { makePhoto, NORTHVALE, OWNER, PORT_CARROW, type PhotoInput } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.
// The ruling under test (owner, 2026-10-12): a photo without GPS takes the
// location of the most recent located photo before it in the trip window.

const WINDOW = scanWindow("2031-05-02", "2031-05-09");
const clean = (photos: PhotoPoint[]) => cleanAssets(photos, { ownerId: OWNER, window: WINDOW });
const byId = (photos: readonly PhotoPoint[]) => new Map(photos.map((p) => [p.id, p] as const));

/** One shot of the invented GPS-less "Lumen D40" camera: no fix, no names of its own. */
const gpsLess = (id: string, local: string, over: PhotoInput = {}): PhotoPoint =>
  makePhoto({
    id,
    local,
    lat: null,
    lon: null,
    city: null,
    state: null,
    country: null,
    make: "Lumen",
    model: "D40",
    ...over,
  });

describe("cleanAssets: the location carry (owner ruling 2026-10-12)", () => {
  it("a GPS-less day's photos take the located day's location and cluster with it", () => {
    const result = clean([
      makePhoto({ id: "fix", local: "2031-05-04 18:00" }),
      gpsLess("slr-a", "2031-05-05 09:00"),
      gpsLess("slr-b", "2031-05-05 17:00"),
    ]);
    const photos = byId(result.photos);
    expect(photos.get("slr-a")!.lat).toBe(NORTHVALE.lat);
    expect(photos.get("slr-b")!.lon).toBe(NORTHVALE.lon);
    expect(photos.get("slr-a")!.flags).toMatchObject({ located: true, locationCarried: true });
    expect(photos.get("fix")!.flags.locationCarried).toBe(false);

    const clusterOf = clusterOfPhoto(clusterCities(result.photos));
    expect(clusterOf.get("slr-a")).toBe(clusterOf.get("fix"));
    expect(clusterOf.get("slr-b")).toBe(clusterOf.get("fix"));
  });

  it("fills only the place names the photo lacks; its own city is kept", () => {
    const result = clean([
      makePhoto({ id: "fix", local: "2031-05-04 09:00", state: "Westshire", country: "Westland" }),
      gpsLess("half", "2031-05-05 09:00", { city: "Port Carrow" }),
    ]);
    const half = byId(result.photos).get("half")!;
    expect(half.city).toBe("Port Carrow");
    expect(half.state).toBe("Westshire");
    expect(half.country).toBe("Westland");
    expect(half.lat).toBe(NORTHVALE.lat);
    expect(half.lon).toBe(NORTHVALE.lon);
  });

  it("leaves a GPS-less photo before the first located one unlocated, and counts it", () => {
    const result = clean([
      gpsLess("early", "2031-05-03 09:00"),
      makePhoto({ id: "fix", local: "2031-05-03 12:00" }),
      gpsLess("late", "2031-05-03 13:00"),
    ]);
    const photos = byId(result.photos);
    expect(photos.get("early")!.flags).toMatchObject({ located: false, locationCarried: false });
    expect(photos.get("early")!.lat).toBeNull();
    expect(photos.get("late")!.flags).toMatchObject({ located: true, locationCarried: true });
    expect(result.excluded.unlocated).toBe(1);
    expect(result.excluded.locationCarried).toBe(1);
  });

  it("counts the carried photos in the carried count, not in unlocated", () => {
    const result = clean([
      makePhoto({ id: "fix" }),
      gpsLess("a", "2031-05-03 13:00"),
      gpsLess("b", "2031-05-03 14:00"),
    ]);
    expect(result.excluded).toMatchObject({ unlocated: 0, locationCarried: 2 });
  });

  it("keeps a same-day GPS-less photo earlier than the day's only located one unlocated", () => {
    const result = clean([
      gpsLess("morning", "2031-05-03 08:00"),
      makePhoto({ id: "fix", local: "2031-05-03 12:00" }),
    ]);
    const morning = byId(result.photos).get("morning")!;
    expect(morning.flags.located).toBe(false);
    expect(morning.flags.locationCarried).toBe(false);
    expect(result.excluded.unlocated).toBe(1);
    expect(result.excluded.locationCarried).toBe(0);
  });

  it("never overwrites a located photo, and carries from real fixes only", () => {
    const result = clean([
      makePhoto({ id: "a", local: "2031-05-03 09:00" }),
      gpsLess("b", "2031-05-03 10:00"),
      makePhoto({
        id: "c",
        local: "2031-05-03 11:00",
        lat: PORT_CARROW.lat,
        lon: PORT_CARROW.lon,
        city: "Port Carrow",
      }),
      gpsLess("d", "2031-05-03 12:00"),
    ]);
    const photos = byId(result.photos);
    expect([
      photos.get("a")!.lat,
      photos.get("b")!.lat,
      photos.get("c")!.lat,
      photos.get("d")!.lat,
    ]).toEqual([NORTHVALE.lat, NORTHVALE.lat, PORT_CARROW.lat, PORT_CARROW.lat]);
    expect(photos.get("c")!.flags.locationCarried).toBe(false);
    expect(photos.get("d")!.flags.locationCarried).toBe(true);
  });

  it("keeps the duplicate keeper a real fix, never a carried copy", () => {
    const result = clean([
      makePhoto({ id: "a", local: "2031-05-03 09:00" }),
      gpsLess("copy-no-gps", "2031-05-03 11:00", { duplicateId: "dup-1" }),
      makePhoto({
        id: "copy-fix",
        duplicateId: "dup-1",
        local: "2031-05-03 12:00",
        lat: PORT_CARROW.lat,
        lon: PORT_CARROW.lon,
        city: "Port Carrow",
      }),
    ]);
    const photos = byId(result.photos);
    expect(photos.get("copy-no-gps")!.flags.duplicate).toBe(true);
    expect(photos.get("copy-fix")!.flags.duplicate).toBe(false);
    expect(photos.get("copy-no-gps")!.lat).toBe(NORTHVALE.lat);
    expect(photos.get("copy-fix")!.lat).toBe(PORT_CARROW.lat);
  });

  it("changes nothing but the location: instant, day, nightDay, zone and the album stay its own", () => {
    const slr = gpsLess("slr", "2031-05-05 02:00");
    const result = clean([makePhoto({ id: "fix", local: "2031-05-04 18:00" }), slr]);
    const carried = byId(result.photos).get("slr")!;
    expect(carried.tMs).toBe(slr.tMs);
    expect(carried.day).toBe("2031-05-05");
    expect(carried.nightDay).toBe("2031-05-04");
    expect(carried.zone).toBe("Pacific/Auckland");
    expect(result.albumAssetIds).toEqual(["fix", "slr"]);
  });
});
