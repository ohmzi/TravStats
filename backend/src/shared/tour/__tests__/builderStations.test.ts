import { defaultStationNotes, MAX_STATION_PREVIEWS, SAME_PLACE_KM } from "../builderStations";

// Synthetic fixtures only (public repository): invented places, shifted years.
describe("defaultStationNotes", () => {
  it("reads first and last photo and the count", () => {
    expect(
      defaultStationNotes({
        firstLocal: "2031-05-04 16:00",
        lastLocal: "2031-05-05 08:30",
        photoCount: 3,
      })
    ).toBe("First photo 16:00 · last 08:30 · 3 photos");
  });

  it("says '1 photo' for one and has nothing for a station without photos of its own", () => {
    expect(
      defaultStationNotes({
        firstLocal: "2031-05-04 16:00",
        lastLocal: "2031-05-04 16:00",
        photoCount: 1,
      })
    ).toBe("First photo 16:00 · last 16:00 · 1 photo");
    expect(defaultStationNotes({ firstLocal: null, lastLocal: null, photoCount: 0 })).toBeNull();
  });
});

describe("the limits both trees read", () => {
  // Pinned as literals in both trees; the server's `thresholds.test.ts` holds them equal to
  // `PREVIEWS_PER_STATION` and `CITY_LINK_KM`.
  it("holds six thumbnails to a card and calls 30 km the same place", () => {
    expect(MAX_STATION_PREVIEWS).toBe(6);
    expect(SAME_PLACE_KM).toBe(30);
  });
});
