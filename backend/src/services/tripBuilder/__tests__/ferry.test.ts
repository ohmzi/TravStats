import { countSeaPhotosBetween, decideLegMode } from "../ferry";
import type { LegEvidence } from "../types";

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
