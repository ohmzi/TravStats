import * as thresholds from "../thresholds";
import { BUILD_PHASES, STATION_KINDS } from "../types";

describe("trip builder thresholds", () => {
  it("keeps the owner's accepted recipe exactly as accepted", () => {
    expect({
      CITY_LINK_KM: thresholds.CITY_LINK_KM,
      SEGMENT_CONTINUE_GAP_H: thresholds.SEGMENT_CONTINUE_GAP_H,
      EXCURSION_MAX_H: thresholds.EXCURSION_MAX_H,
      VISIT_MIN_H: thresholds.VISIT_MIN_H,
      MISDATED_COUNTER_WINDOW: thresholds.MISDATED_COUNTER_WINDOW,
      MISDATED_COUNTER_DAYS: thresholds.MISDATED_COUNTER_DAYS,
      MISDATED_MIN_NEIGHBOURS: thresholds.MISDATED_MIN_NEIGHBOURS,
    }).toEqual({
      CITY_LINK_KM: 30,
      SEGMENT_CONTINUE_GAP_H: 30,
      EXCURSION_MAX_H: 8,
      VISIT_MIN_H: 6,
      MISDATED_COUNTER_WINDOW: 25,
      MISDATED_COUNTER_DAYS: 3,
      MISDATED_MIN_NEIGHBOURS: 5,
    });
  });

  it("pads the fetch by the widest offsets on Earth, UTC+14 before and UTC−12 after", () => {
    expect(thresholds.WINDOW_PAD_BEFORE_H).toBe(14);
    expect(thresholds.WINDOW_PAD_AFTER_H).toBe(12);
  });

  it("starts a night's evening at 18:00 and ends it at 04:00", () => {
    expect(thresholds.NIGHT_BOUNDARY_H).toBe(4);
    expect(thresholds.NIGHT_DRIVE_LAST_AFTER).toBe("18:00");
    expect(thresholds.NIGHT_DRIVE_FIRST_BEFORE).toBe("09:00");
  });

  it("never addresses more thumbnails than the preview route accepts", () => {
    expect(thresholds.MAX_PREVIEWS).toBe(400);
    expect(thresholds.PREVIEWS_PER_STATION).toBeLessThanOrEqual(thresholds.MAX_PREVIEWS);
  });

  it("lets a draft live 2 h untouched and 6 h at most", () => {
    expect(thresholds.DRAFT_IDLE_TTL_MS).toBe(2 * 3_600_000);
    expect(thresholds.DRAFT_MAX_TTL_MS).toBe(6 * 3_600_000);
  });
});

describe("trip builder vocabulary", () => {
  it("reports seven build phases in the order the progress line counts them", () => {
    expect(BUILD_PHASES).toEqual([
      "fetch",
      "clean",
      "flights",
      "movement",
      "names",
      "roads",
      "nights",
    ]);
  });

  it("knows exactly five station kinds", () => {
    expect(STATION_KINDS).toEqual(["visit", "brief", "dayTrip", "home", "airport"]);
  });
});
