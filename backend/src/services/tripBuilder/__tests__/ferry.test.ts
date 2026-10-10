import { countSeaPhotosBetween, decideLegMode, looksLikeWaterCrossing } from "../ferry";
import type { CountryAt, LegEvidence } from "../types";

// Synthetic fixtures only (public repository): invented crossings, shifted years.
const HOUR = 3_600_000;
const DEPARTS = Date.UTC(2031, 4, 4, 21, 0);
const ARRIVES = Date.UTC(2031, 4, 5, 6, 30);

function evidence(over: Partial<LegEvidence> = {}): LegEvidence {
  return { chordKm: 214, probe: null, seaPhotosBetween: 0, waterChip: false, ...over };
}

describe("countSeaPhotosBetween", () => {
  it("counts only the sea photos taken between the last photo and the next first photo", () => {
    const sea = [
      { tMs: DEPARTS - HOUR },
      { tMs: DEPARTS + HOUR },
      { tMs: DEPARTS + 3 * HOUR },
      { tMs: ARRIVES + HOUR },
    ];
    expect(countSeaPhotosBetween(DEPARTS, ARRIVES, sea)).toBe(2);
  });

  it("leaves out a photo taken at the very instant of either station's photo", () => {
    const sea = [{ tMs: DEPARTS }, { tMs: ARRIVES }];
    expect(countSeaPhotosBetween(DEPARTS, ARRIVES, sea)).toBe(0);
  });

  it("counts none when nothing was taken at sea", () => {
    expect(countSeaPhotosBetween(DEPARTS, ARRIVES, [])).toBe(0);
  });
});

describe("decideLegMode", () => {
  it("makes a leg a ferry when the router's ferry steps cover half of it or more", () => {
    const probe = { distanceKm: 120, ferryKm: 60 };
    expect(decideLegMode(evidence({ probe }))).toEqual({
      mode: "ferry",
      ferryEvidence: "router",
      routedKm: 120,
    });
  });

  it("keeps a leg a road when the ferry steps cover less than half, and shows the routed km", () => {
    const probe = { distanceKm: 120, ferryKm: 59 };
    expect(decideLegMode(evidence({ probe }))).toEqual({
      mode: "road",
      ferryEvidence: null,
      routedKm: 120,
    });
  });

  it("never reads a route with no ferry steps as a ferry, even a zero-length one", () => {
    expect(decideLegMode(evidence({ probe: { distanceKm: 0, ferryKm: 0 } })).mode).toBe("road");
    expect(decideLegMode(evidence({ probe: { distanceKm: 8, ferryKm: 0 } })).mode).toBe("road");
  });

  it("makes a leg a ferry when two photos were taken at sea between its stations", () => {
    expect(decideLegMode(evidence({ seaPhotosBetween: 2 }))).toEqual({
      mode: "ferry",
      ferryEvidence: "seaPhotos",
      routedKm: null,
    });
    expect(decideLegMode(evidence({ seaPhotosBetween: 1 })).mode).toBe("road");
  });

  it("names the router first when both the router and the deck photos say ferry", () => {
    const probe = { distanceKm: 100, ferryKm: 90 };
    const decided = decideLegMode(evidence({ probe, seaPhotosBetween: 5 }));
    expect([decided.mode, decided.ferryEvidence]).toEqual(["ferry", "router"]);
  });

  it("gives a bay or a bridge the chip only and leaves the leg a road", () => {
    expect(decideLegMode(evidence({ waterChip: true }))).toEqual({
      mode: "road",
      ferryEvidence: "chip",
      routedKm: null,
    });
  });

  it("lets real ferry evidence outrank the chip", () => {
    const decided = decideLegMode(evidence({ waterChip: true, seaPhotosBetween: 3 }));
    expect([decided.mode, decided.ferryEvidence]).toEqual(["ferry", "seaPhotos"]);
  });

  it("is a plain road with no evidence at all", () => {
    expect(decideLegMode(evidence())).toEqual({
      mode: "road",
      ferryEvidence: null,
      routedKm: null,
    });
  });
});

describe("looksLikeWaterCrossing", () => {
  // At latitude 45°S one degree of longitude is 78.6 km, so a band of water
  // between two longitudes has a length that is easy to read off.
  const WEST = { lat: -45, lon: 168 };
  const water =
    (from: number, to: number): CountryAt =>
    (_lat, lon) =>
      lon > from && lon < to ? null : "NZ";

  it("flags a chord that crosses a long stretch of water", () => {
    // 236 km chord, 79 km of it water: a third of the chord, but one long run.
    expect(looksLikeWaterCrossing(WEST, { lat: -45, lon: 171 }, water(169, 170))).toBe(true);
  });

  it("flags a short chord that is mostly water, without any 30 km run", () => {
    // 24 km chord, 20 km of it water: over half the chord.
    expect(looksLikeWaterCrossing(WEST, { lat: -45, lon: 168.305 }, water(168.02, 168.28))).toBe(
      true
    );
  });

  it("flags a 66 km chord with 39 km of water", () => {
    expect(looksLikeWaterCrossing(WEST, { lat: -45, lon: 168.84 }, water(168.15, 168.65))).toBe(
      true
    );
  });

  it("leaves a narrow channel on a long chord alone", () => {
    // 16 km of water in 236 km: neither half the chord nor a 30 km run.
    expect(looksLikeWaterCrossing(WEST, { lat: -45, lon: 171 }, water(169.4, 169.6))).toBe(false);
  });

  it("never looks at a chord shorter than 20 km", () => {
    // 15.7 km, all of it water.
    expect(looksLikeWaterCrossing(WEST, { lat: -45, lon: 168.2 }, () => null)).toBe(false);
  });

  it("finds no water on a chord that stays on land", () => {
    expect(looksLikeWaterCrossing(WEST, { lat: -45, lon: 171 }, () => "NZ")).toBe(false);
  });

  it("follows the short way round the antimeridian", () => {
    // 64 km chord from 179.7°E to 179.7°W; the sea lies at |longitude| > 179.8°.
    const sea: CountryAt = (_lat, lon) => (Math.abs(lon) > 179.8 ? null : "FJ");
    const a = { lat: -16.8, lon: 179.7 };
    const b = { lat: -16.8, lon: -179.7 };
    expect(looksLikeWaterCrossing(a, b, sea)).toBe(true);
  });
});
