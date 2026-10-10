import { describe, expect, it } from "vitest";

import {
  STATION_STATUSES,
  type CommitBody,
  type CommitResult,
  type DraftArea,
  type DraftStation,
} from "../tripBuilder";

// Synthetic fixtures only (public repository).
const northvale: DraftStation = {
  key: "-901|3374|2031-05-02",
  title: "Northvale Lodge",
  titleSource: "existing",
  kind: "visit",
  lat: -45.05,
  lon: 168.7,
  snappedKm: null,
  firstDay: "2031-05-02",
  lastDay: "2031-05-03",
  firstLocal: null,
  lastLocal: null,
  photoCount: 12,
  previewIdx: [0],
  notes: null,
  status: "changed",
  existingId: "11111111-1111-4111-8111-111111111111",
  before: { startDate: "2031-05-02", endDate: "2031-05-03", slept: true, stay: false },
};

describe("re-sync wire vocabulary", () => {
  it("knows the four station statuses the server sends", () => {
    expect(STATION_STATUSES).toEqual(["same", "changed", "new", "notSeen"]);
  });

  it("carries a not-seen station beside the derived ones", () => {
    const kelmore: DraftStation = {
      ...northvale,
      key: "-908|3370|2031-05-06",
      title: "Kelmore",
      status: "notSeen",
      notSeen: { defaultKeep: false, reason: "outsideWindow" },
    };
    const area = {
      roadtripId: "0b1c2d3e-4f5a-4b6c-8d7e-8f9a0b1c2d3e",
      notSeen: [kelmore],
    } satisfies Pick<DraftArea, "roadtripId" | "notSeen">;
    expect(area.notSeen[0].notSeen?.reason).toBe("outsideWindow");
  });

  it("describes a commit that updates in place", () => {
    const body: Pick<CommitBody, "stops" | "album"> = {
      stops: { keep: ["33333333-3333-4333-8333-333333333333"], remove: [] },
      album: { create: true, name: "Northvale loop", removeOutside: true },
    };
    expect(body.album.removeOutside).toBe(true);
  });

  it("reports what the update did", () => {
    const result: Pick<CommitResult, "stops" | "roadtrips"> = {
      stops: { updated: 0, unchanged: 1, added: 0, removed: 0, kept: 1 },
      roadtrips: [
        {
          id: "0b1c2d3e-4f5a-4b6c-8d7e-8f9a0b1c2d3e",
          name: "Northvale loop",
          stations: 4,
          nights: 6,
          diff: { updated: 1, unchanged: 2, added: 1, removed: 0, kept: 1 },
        },
      ],
    };
    expect(result.roadtrips[0].diff?.added).toBe(1);
  });
});
