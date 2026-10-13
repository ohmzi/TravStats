import { cleanAssets } from "../clean";
import type { PhotoPoint } from "../types";
import { scanWindow } from "../window";
import { makePhoto, OWNER } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

const WINDOW = scanWindow("2031-05-02", "2031-05-09");
const clean = (photos: PhotoPoint[]) => cleanAssets(photos, { ownerId: OWNER, window: WINDOW });
const ids = (photos: readonly PhotoPoint[]) => photos.map((p) => p.id);

/**
 * The scan must not read archived assets (owner ruling 2026-10-13, "Sumayya's
 * wedding"): two archived videos still shaped the Karachi stay. An archived
 * asset shapes nothing — no cluster, no station, no night, no context — while
 * the album list keeps it, exactly as the app defines that list.
 */
describe("cleanAssets: archived assets", () => {
  it("keeps an archived own photo out of the photos and the context, and in the album", () => {
    const result = clean([
      makePhoto({ id: "still", local: "2031-05-03 12:00" }),
      makePhoto({ id: "archived", visibility: "archive", local: "2031-05-03 12:05" }),
      makePhoto({ id: "archived-context", visibility: "archive", local: "2031-05-01 12:00" }),
    ]);

    expect(ids(result.photos)).toEqual(["still"]);
    expect(ids(result.context)).toEqual([]);
    // The album is every own photo and video of the window, archived included —
    // the app's own definition, unchanged by this rule.
    expect(result.albumAssetIds).toEqual(["still", "archived"]);
  });

  it("keeps a normal photo in the photos", () => {
    const result = clean([makePhoto({ id: "normal", visibility: "timeline" })]);
    expect(ids(result.photos)).toEqual(["normal"]);
  });

  it("does not let an archived photo pass a location on to the GPS-less photos after it", () => {
    const result = clean([
      makePhoto({
        id: "away",
        visibility: "archive",
        lat: -44.7,
        lon: 169.15,
        local: "2031-05-03 10:00",
      }),
      makePhoto({ id: "gpsless", lat: null, lon: null, local: "2031-05-03 11:00" }),
    ]);

    expect(ids(result.photos)).toEqual(["gpsless"]);
    expect(result.photos[0].flags.located).toBe(false);
    expect(result.excluded.unlocated).toBe(1);
  });
});
