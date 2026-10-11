import { describe, expect, it } from "vitest";

import type { DraftStation, DraftStopover, TripBuilderDraft } from "../tripBuilder";

// Synthetic fixtures only (public repository).
const AT_AIRPORT: DraftStation = {
  key: "-901|3374|2031-05-02",
  title: "Northvale",
  titleSource: "airport",
  kind: "airport",
  lat: -45.05,
  lon: 168.7,
  snappedKm: null,
  firstDay: "2031-05-02",
  lastDay: "2031-05-02",
  firstLocal: null,
  lastLocal: null,
  photoCount: 0,
  previewIdx: [],
  notes: null,
};

const DOWNTOWN: DraftStation = {
  ...AT_AIRPORT,
  key: "-899|3374|2031-05-02",
  title: "Elmwood",
  titleSource: "immich",
  kind: "visit",
  firstLocal: "2031-05-02 11:00",
  lastLocal: "2031-05-02 15:00",
  photoCount: 5,
  previewIdx: [0, 1, 2],
};

describe("stopover wire vocabulary", () => {
  it("describes a stopover tour that starts at the arrival airport", () => {
    const stopover: DraftStopover = {
      key: "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b#2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d",
      city: "Elmwood",
      title: "Elmwood 2031 Road Trip",
      day: "2031-05-02",
      airportIata: "NVL",
      photoCount: 7,
      outingCount: 5,
      stations: [AT_AIRPORT, DOWNTOWN],
      legs: [
        {
          fromKey: AT_AIRPORT.key,
          toKey: DOWNTOWN.key,
          chordKm: 12.8,
          routedKm: null,
          mode: "road",
          ferryEvidence: null,
        },
      ],
    };
    const draft = { stopovers: [stopover] } satisfies Partial<TripBuilderDraft>;
    expect(draft.stopovers?.[0].stations[0].kind).toBe("airport");
    expect(draft.stopovers?.[0].legs).toHaveLength(1);
  });
});
