import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type { ImmichAsset } from "../../immich/types";
import type {
  ExistingRoadtrip,
  ExistingStation,
  ExistingStop,
  ExistingTripState,
} from "../existingTypes";
import type { DraftStopover, TripBuilderDraft } from "../types";
import {
  annotateDraftForExisting as annotateWithCounts,
  applyExistingTarget,
  type ExistingDeps,
} from "../existingDraft";
import {
  area,
  derivedStation,
  derivedStations,
  draft,
  flight,
  K,
  STOPOVER_KEY,
  stopover,
} from "./existingDraftFixture";

/**
 * The annotation under test, with the pitstop album counts a scan carries
 * (`StoredPitstop.assetIds.length`): the tests that do not exercise a pitstop's
 * album pass none, and the pitstop tests name the area's own member count.
 */
const annotateDraftForExisting = (
  dto: TripBuilderDraft,
  state: ExistingTripState,
  counts: ReadonlyMap<string, number> = new Map()
): ReturnType<typeof annotateWithCounts> => annotateWithCounts(dto, state, counts);

// Synthetic fixtures only (public repository).
const TRIP = "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c";
const STAY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "immich-user-1";
const PATTERN = /^-?\d+\|-?\d+\|\d{4}-\d{2}-\d{2}(?:~\d+)?$/;

function stored(
  over: Partial<ExistingStation> & Pick<ExistingStation, "id" | "title" | "lat" | "lon">
): ExistingStation {
  return {
    startDate: "2031-05-02",
    endDate: "2031-05-04",
    night: "free",
    lodgingStayId: null,
    placeId: null,
    notes: null,
    ...over,
  };
}

const roadtrip: ExistingRoadtrip = {
  id: "r1",
  name: "Northvale loop",
  legs: [],
  stations: [
    stored({
      id: "st-a",
      title: "Northvale Lodge",
      lat: -45.05,
      lon: 168.7,
      notes: "Booked by phone",
    }),
    stored({
      id: "st-b",
      title: "Port Carrow",
      lat: -44.7,
      lon: 169.15,
      startDate: "2031-05-04",
      endDate: "2031-05-06",
      night: "pass",
    }),
    stored({
      id: "st-c",
      title: "Kelmore",
      lat: -45.42,
      lon: 168.52,
      startDate: "2031-05-06",
      endDate: "2031-05-07",
    }),
    stored({
      id: "st-s",
      title: "Tarnside Lodge",
      lat: -45.2,
      lon: 169.4,
      startDate: "2031-05-07",
      endDate: "2031-05-09",
      night: "stay",
      lodgingStayId: STAY,
    }),
  ],
};

const museum: ExistingStop = {
  id: "stop-m",
  title: "Kelmore Museum",
  lat: -45.42,
  lon: 168.52,
  startDay: "2031-05-06",
  endDay: "2031-05-06",
  notes: null,
};

function state(over: Partial<ExistingTripState> = {}): ExistingTripState {
  return {
    tripId: TRIP,
    tripName: "Northvale loop",
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    countries: ["NZ"],
    roadtrips: [roadtrip],
    stops: [],
    flightIds: [],
    albums: [],
    ...over,
  };
}

describe("annotateDraftForExisting: a roadtrip area", () => {
  const result = annotateDraftForExisting(draft(TRIP), state({ stops: [museum] }));
  const [only] = result.dto.areas;

  it("matches the area to the stored roadtrip and every station against its stored one", () => {
    expect(only.roadtripId).toBe("r1");
    expect(only.stations.map((s) => [s.title, s.status, s.existingId])).toEqual([
      ["Northvale Lodge", "same", "st-a"],
      ["Port Carrow", "changed", "st-b"],
      ["Southbridge", "new", undefined],
      ["Tarnside Lodge", "same", "st-s"],
    ]);
  });

  it("keeps the stored title, notes and coordinates of a matched station", () => {
    const [northvale] = only.stations;
    expect(northvale).toMatchObject({
      title: "Northvale Lodge",
      notes: "Booked by phone",
      lat: -45.05,
      lon: 168.7,
      snappedKm: null,
    });
    expect(northvale.key).toBe(K.northvale);
  });

  it("shows what a changed station was", () => {
    expect(only.stations[1].before).toEqual({
      startDate: "2031-05-04",
      endDate: "2031-05-06",
      slept: false,
      stay: false,
    });
  });

  it("lists a stored station the photos do not show beside the area, not inside it", () => {
    expect(only.notSeen).toHaveLength(1);
    const [kelmore] = only.notSeen ?? [];
    expect(kelmore).toMatchObject({
      title: "Kelmore",
      status: "notSeen",
      existingId: "st-c",
      titleSource: "existing",
      notSeen: { defaultKeep: true, reason: "notInPhotos" },
    });
    expect(kelmore.key).toMatch(PATTERN);
    expect(only.stations).toHaveLength(4);
    expect(only.legs).toHaveLength(3);
  });

  it("remembers what it offered, for the commit to hold the draft to", () => {
    const offer = result.existing.roadtrips.get("r1");
    expect(offer?.areaKey).toBe("2031-05-02#1");
    expect(offer?.name).toBe("Northvale loop");
    expect([...(offer?.matchedIds ?? [])].sort()).toEqual(["st-a", "st-b", "st-s"]);
    expect([...(offer?.notSeenIds ?? [])]).toEqual(["st-c"]);
    expect(result.existing.tripId).toBe(TRIP);
  });

  it("names a matched area with the stored roadtrip's own name, not the scan's derivation", () => {
    // The trip already holds a roadtrip called like the trip, so `roadtripAreaNames`
    // derives "Northvale loop · Northvale"; the review must show what the roadtrip is
    // actually called, or the name the user sees is not the name the commit would keep.
    const derived = draft(TRIP, [area({ suggestedName: "Northvale loop · Northvale" })]);
    const [only] = annotateDraftForExisting(derived, state()).dto.areas;
    expect(only.roadtripId).toBe("r1");
    expect(only.suggestedName).toBe("Northvale loop");
  });

  it("offers the stop that no area matched as not seen", () => {
    expect(result.dto.notSeenStops?.map((s) => [s.title, s.existingId])).toEqual([
      ["Kelmore Museum", "stop-m"],
    ]);
    expect([...result.existing.stops.notSeenIds]).toEqual(["stop-m"]);
    expect(result.existing.stops.matchedIds.size).toBe(0);
  });
});

describe("annotateDraftForExisting: the legs of a matched area", () => {
  /** The fixture roadtrip with the given stored legs (between its four stored ids). */
  const withStoredLegs = (legs: ExistingRoadtrip["legs"]): ExistingTripState =>
    state({ roadtrips: [{ ...roadtrip, legs }] });

  it("shows the stored mode on the leg a matched pair updates, with the scan's own mode beside it", () => {
    // The scan derived a road leg between Northvale and Port Carrow; the trip stores a ferry,
    // and the commit leaves a stored leg alone unless the reviewed mode differs. So the review
    // must start on the stored mode — otherwise it would show a ferry the commit never writes.
    const storedLegs = [{ fromStopId: "st-a", toStopId: "st-b", mode: "ferry", source: "routed" }];
    const [only] = annotateDraftForExisting(draft(TRIP), withStoredLegs(storedLegs)).dto.areas;
    expect(only.legs[0]).toMatchObject({ mode: "ferry", derivedMode: "road" });
    // The other pairs have a new station or no stored leg, so they keep the scan's mode.
    expect(only.legs[1]).toMatchObject({ mode: "road" });
    expect(only.legs[1].derivedMode).toBeUndefined();
    expect(only.legs[2]).toMatchObject({ mode: "ferry" });
    expect(only.legs[2].derivedMode).toBeUndefined();
  });

  it("reads a stored mode that is not exactly ferry as road, the roadtrip editor's own reading", () => {
    const storedLegs = [{ fromStopId: "st-a", toStopId: "st-b", mode: "rail", source: "routed" }];
    const [only] = annotateDraftForExisting(draft(TRIP), withStoredLegs(storedLegs)).dto.areas;
    expect(only.legs[0]).toMatchObject({ mode: "road", derivedMode: "road" });
  });

  it("leaves the legs of an area with no stored roadtrip untouched", () => {
    const [only] = annotateDraftForExisting(draft(TRIP), state({ roadtrips: [] })).dto.areas;
    expect(only.legs.map((leg) => [leg.mode, leg.derivedMode])).toEqual([
      ["road", undefined],
      ["road", undefined],
      ["ferry", undefined],
    ]);
  });
});

describe("annotateDraftForExisting: other cases", () => {
  it("calls every station of an area with no stored roadtrip new", () => {
    const { dto, existing } = annotateDraftForExisting(draft(TRIP), state({ roadtrips: [] }));
    expect(dto.areas[0].roadtripId).toBeUndefined();
    expect(dto.areas[0].stations.map((s) => s.status)).toEqual(["new", "new", "new", "new"]);
    expect(existing.roadtrips.size).toBe(0);
  });

  it("matches a stops area to a stored timeline stop and carries the status on its first ground station", () => {
    const stopsArea = area({
      key: "2031-05-06#1",
      defaultAs: "stops",
      stations: [
        derivedStation(
          "-908|3370|2031-05-06",
          "Kelmore Museum",
          { lat: -45.42, lon: 168.52 },
          "2031-05-06",
          "2031-05-07"
        ),
      ],
    });
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [stopsArea]),
      state({ roadtrips: [], stops: [museum] })
    );
    const [anchor] = dto.areas[0].stations;
    expect(anchor).toMatchObject({ status: "changed", existingId: "stop-m" });
    expect(anchor.before).toEqual({
      startDate: "2031-05-06",
      endDate: "2031-05-06",
      slept: false,
      stay: false,
    });
    expect([...existing.stops.matchedIds]).toEqual(["stop-m"]);
    expect(dto.notSeenStops).toEqual([]);
  });

  it("lists the flights already on the trip as locked and ticked", () => {
    const f = flight();
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area()], { flights: [f] }),
      state({ flightIds: [f.id] })
    );
    expect(dto.flights[0]).toMatchObject({ locked: true, defaultAssign: true });
  });

  it("gives a not-seen station a key that cannot collide with a derived one", () => {
    // The first stored station is the derived Northvale (same place, overlapping days), so it
    // matches. The second is at the same place and first day but is not what the photos show:
    // its own key would be the derived station's key, so it has to be claimed with a suffix.
    const matched = stored({
      id: "st-a",
      title: "Northvale",
      lat: -45.05,
      lon: 168.7,
      startDate: "2031-05-02",
      endDate: "2031-05-03",
      night: "pass",
    });
    const clash = stored({
      id: "st-x",
      title: "Elsewhere",
      lat: -45.05,
      lon: 168.7,
      startDate: "2031-05-02",
      endDate: "2031-05-02",
      night: "pass",
    });
    const rt: ExistingRoadtrip = { ...roadtrip, stations: [matched, clash] };
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area({ stations: derivedStations().slice(0, 1) })]),
      state({ roadtrips: [rt] })
    );
    const [only] = dto.areas;
    expect(only.stations.map((s) => [s.key, s.status, s.existingId])).toEqual([
      [K.northvale, "changed", "st-a"],
    ]);
    const [elsewhere] = only.notSeen ?? [];
    expect(only.notSeen).toHaveLength(1);
    expect(elsewhere).toMatchObject({ title: "Elsewhere", status: "notSeen", existingId: "st-x" });
    expect(elsewhere.key).not.toBe(K.northvale);
    expect(elsewhere.key).toMatch(/~\d+$/);
    const keys = [...only.stations, ...(only.notSeen ?? [])].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("annotateDraftForExisting: a stopover", () => {
  // The roadtrip a first sync wrote for the fixture stopover: two stations, one day.
  const stopoverRoadtrip: ExistingRoadtrip = {
    id: "r9",
    name: "Northvale loop · Northvale",
    legs: [],
    stations: [
      stored({
        id: "st-air",
        title: "ZZA Airport",
        lat: -44.7,
        lon: 169.15,
        startDate: "2031-05-04",
        endDate: "2031-05-04",
        night: "pass",
      }),
      stored({
        id: "st-town",
        title: "Northvale",
        lat: -45.45,
        lon: 169.1,
        startDate: "2031-05-04",
        endDate: "2031-05-04",
        night: "pass",
      }),
    ],
  };
  const held = (over: Partial<ExistingTripState> = {}): ExistingTripState =>
    state({ roadtrips: [stopoverRoadtrip], ...over });

  it("marks a matched stopover as already synced and remembers what it offered", () => {
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [], { stopovers: [stopover()] }),
      held()
    );
    expect(dto.stopovers?.[0].stored).toEqual({
      roadtripId: "r9",
      name: "Northvale loop · Northvale",
      albumAssetCount: null,
    });
    const offer = existing.stopovers.get("r9");
    expect(offer?.key).toBe(STOPOVER_KEY);
    expect(offer?.name).toBe("Northvale loop · Northvale");
    expect([...(offer?.stationIds ?? [])].sort()).toEqual(["st-air", "st-town"]);
  });

  it("shows the stored album's count beside the current one", () => {
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [], { stopovers: [stopover()] }),
      held({
        albums: [
          {
            linkId: "l9",
            immichAlbumId: "al-9",
            albumName: "Northvale loop · Northvale",
            assetCount: 96,
            ownedByUser: true,
            travstatsMarker: true,
          },
        ],
      })
    );
    expect(dto.stopovers?.[0].stored?.albumAssetCount).toBe(96);
    expect(dto.stopovers?.[0].photoCount).toBe(98);
  });

  it("leaves a stopover with no stored roadtrip a plain new candidate", () => {
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [], { stopovers: [stopover()] }),
      state({ roadtrips: [] })
    );
    expect(dto.stopovers?.[0].stored).toBeUndefined();
    expect(existing.stopovers.size).toBe(0);
  });

  it("keeps the stopover roadtrip out of the area match, even for an area that would claim it", () => {
    const steal = area({
      key: "2031-05-04#1",
      suggestedName: "Northvale loop · Northvale",
      stations: [
        derivedStation(
          "-893|3382|2031-05-04",
          "ZZA Airport",
          { lat: -44.7, lon: 169.15 },
          "2031-05-04",
          "2031-05-04",
          { kind: "airport" }
        ),
        derivedStation(
          "-894|3384|2031-05-04",
          "Northvale",
          { lat: -45.45, lon: 169.1 },
          "2031-05-04",
          "2031-05-04"
        ),
      ],
    });
    const tripState = held();
    // Without the stopover the area takes the one-day roadtrip: same name, both stations match.
    expect(annotateDraftForExisting(draft(TRIP, [steal]), tripState).dto.areas[0].roadtripId).toBe(
      "r9"
    );
    // With it, the claim runs first and the area becomes a roadtrip of its own.
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [steal], { stopovers: [stopover()] }),
      tripState
    );
    expect(dto.areas[0].roadtripId).toBeUndefined();
    expect(dto.areas[0].stations.map((s) => s.status)).toEqual(["new", "new"]);
    expect(dto.stopovers?.[0].stored?.roadtripId).toBe("r9");
  });

  // ── A tour that runs past midnight (final review, finding S1) ──────────────
  // The A2 fixture's shape (buildDraft.stopover.test.ts): the flight lands late,
  // the outing set runs past midnight, so the visit station spans two days while
  // the stopover day stays the first outing photo's. The commit writes exactly
  // those spans back (deriveStationRows with no nights), so the stored roadtrip
  // ends one day past `day` — and can never be re-claimed from the single day.

  /** A midnight-crossing stopover: `day` is the first outing photo's, the airport's its arrival's. */
  function midnightStopover(day: string, airportDay: string, outingLastDay: string): DraftStopover {
    const stations = [
      derivedStation(
        `-894|3382|${airportDay}`,
        "ZZA Airport",
        { lat: -44.7, lon: 169.15 },
        airportDay,
        airportDay,
        { kind: "airport" }
      ),
      derivedStation(
        `-909|3382|${day}`,
        "Elmwood",
        { lat: -45.45, lon: 169.1 },
        day,
        outingLastDay
      ),
    ];
    return stopover({
      day,
      title: "Northvale loop · Elmwood",
      stations,
      legs: [
        {
          fromKey: stations[0].key,
          toKey: stations[1].key,
          chordKm: 52,
          routedKm: null,
          mode: "road",
          ferryEvidence: null,
        },
      ],
    });
  }

  /** The rows a first sync wrote for such a tour, read back: `night: "pass"`, spans unchanged. */
  function crossingRoadtrip(
    id: string,
    airportDay: string,
    outingStart: string,
    outingEnd: string
  ): ExistingRoadtrip {
    return {
      id,
      name: "Northvale loop · Elmwood",
      legs: [],
      stations: [
        stored({
          id: `${id}-a`,
          title: "ZZA Airport",
          lat: -44.7,
          lon: 169.15,
          startDate: airportDay,
          endDate: airportDay,
          night: "pass",
        }),
        stored({
          id: `${id}-b`,
          title: "Elmwood",
          lat: -45.45,
          lon: 169.1,
          startDate: outingStart,
          endDate: outingEnd,
          night: "pass",
        }),
      ],
    };
  }

  it("re-claims a midnight-crossing stopover by the tour's own span, not its single day", () => {
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [], { stopovers: [midnightStopover("2031-05-02", "2031-05-02", "2031-05-03")] }),
      state({ roadtrips: [crossingRoadtrip("r9", "2031-05-02", "2031-05-02", "2031-05-03")] })
    );
    expect(dto.stopovers?.[0].stored).toEqual({
      roadtripId: "r9",
      name: "Northvale loop · Elmwood",
      albumAssetCount: null,
    });
    expect([...(existing.stopovers.get("r9")?.stationIds ?? [])].sort()).toEqual(["r9-a", "r9-b"]);
  });

  it("re-claims a stopover whose first outing photo fell after midnight", () => {
    // Landing 23:50 on 02 May, first downtown photo 00:10 on 03 May: `day` is the
    // photo's (03 May), the airport station's is the arrival's (02 May) — before
    // `day`, so only the tour's own span holds both.
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [], { stopovers: [midnightStopover("2031-05-03", "2031-05-02", "2031-05-03")] }),
      state({ roadtrips: [crossingRoadtrip("r9", "2031-05-02", "2031-05-03", "2031-05-03")] })
    );
    expect(dto.stopovers?.[0].stored?.roadtripId).toBe("r9");
  });

  it("still offers a stopover as new when its stored roadtrip reaches beyond the tour's span", () => {
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [], { stopovers: [midnightStopover("2031-05-02", "2031-05-02", "2031-05-03")] }),
      state({ roadtrips: [crossingRoadtrip("r9", "2031-05-02", "2031-05-02", "2031-05-04")] })
    );
    expect(dto.stopovers?.[0].stored).toBeUndefined();
    expect(existing.stopovers.size).toBe(0);
  });
});

describe("annotateDraftForExisting: a pitstop area", () => {
  /** The album the scan computes for the fixture's roadtrip area (spec pitstop §6). */
  const ALBUM = "Northvale loop · Northvale";
  const linked = (name: string, assetCount: number) => ({
    linkId: "l10",
    immichAlbumId: "al-10",
    albumName: name,
    assetCount,
    ownedByUser: true,
    travstatsMarker: true,
  });

  it("marks a matched pitstop's album as already synced when the trip links it, with both counts", () => {
    // The "now" count is the scan's own member count for the area
    // (`storedPitstops`' `assetIds.length`): the movement and at-sea photos the
    // album takes, not the four fixture stations' 48 — sea and transit-noise
    // photos never become stations but are album members (finding Q3-1).
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area({ pitstop: { albumName: ALBUM } })]),
      state({ albums: [linked(ALBUM, 96)] }),
      new Map([["2031-05-02#1", 55]])
    );
    // The area match is the existing one, untouched: the roadtrip is still the match.
    expect(dto.areas[0].roadtripId).toBe("r1");
    expect(dto.areas[0].pitstop).toEqual({
      albumName: ALBUM,
      stored: { albumAssetCount: 96, photoCount: 55 },
    });
  });

  it("keeps a matched pitstop unmarked while no linked album carries its exact name", () => {
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area({ pitstop: { albumName: ALBUM } })]),
      state({ albums: [linked("Northvale loop", 96)] })
    );
    expect(dto.areas[0].roadtripId).toBe("r1");
    expect(dto.areas[0].pitstop).toEqual({ albumName: ALBUM });
  });

  it("keeps a matched pitstop unmarked while the same-named link is not the user's", () => {
    // Final review, finding Q3-6: the writer resolves a named album only through
    // a link the user owns (`pickLinkedAlbum`, `ownedByUser === true`) and
    // otherwise creates a fresh album of that name. A same-named link that is
    // the partner's — or one the scan could not describe — is not the write's
    // target, so "already synced" with a locked switch would promise a re-sync
    // the commit does not make.
    for (const ownedByUser of [false, null]) {
      const foreign = { ...linked(ALBUM, 96), ownedByUser };
      const { dto } = annotateDraftForExisting(
        draft(TRIP, [area({ pitstop: { albumName: ALBUM } })]),
        state({ albums: [foreign] })
      );
      expect(dto.areas[0].roadtripId).toBe("r1");
      expect(dto.areas[0].pitstop).toEqual({ albumName: ALBUM });
    }
  });

  it("leaves an unmatched pitstop alone: the annotation is the match's to make", () => {
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area({ pitstop: { albumName: ALBUM } })]),
      state({ roadtrips: [], albums: [linked(ALBUM, 96)] })
    );
    expect(dto.areas[0].roadtripId).toBeUndefined();
    expect(dto.areas[0].pitstop).toEqual({ albumName: ALBUM });
  });

  it("matches the stored stop a pitstop supersedes onto its anchor, and offers it nowhere else", () => {
    // Final review, finding Q2: the pre-feature build wrote the same stay as a
    // timeline stop, so a pitstop area the trip holds no roadtrip for still has
    // the stop it succeeds. The stop is matched onto the area's anchor — the one
    // match the commit can act on — instead of being offered as an unrelated
    // "not seen" stop the user would silently keep beside the new roadtrip.
    const pitstopArea = area({
      key: "2031-05-06#1",
      defaultAs: "roadtrip",
      pitstop: { albumName: ALBUM },
      stations: [
        derivedStation(
          "-908|3370|2031-05-06",
          "Kelmore Museum",
          { lat: -45.42, lon: 168.52 },
          "2031-05-06",
          "2031-05-07"
        ),
      ],
    });
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [pitstopArea]),
      state({ roadtrips: [], stops: [museum] })
    );
    const [anchor] = dto.areas[0].stations;
    expect(anchor).toMatchObject({ status: "changed", existingId: "stop-m" });
    expect(anchor.before).toEqual({
      startDate: "2031-05-06",
      endDate: "2031-05-06",
      slept: false,
      stay: false,
    });
    expect(dto.areas[0].roadtripId).toBeUndefined();
    expect([...existing.stops.matchedIds]).toEqual(["stop-m"]);
    expect([...existing.stops.notSeenIds]).toEqual([]);
    expect(dto.notSeenStops).toEqual([]);
  });

  it("leaves an ordinary area without a pitstop untouched", () => {
    const { dto } = annotateDraftForExisting(draft(TRIP, [area()]), state());
    expect(dto.areas[0].pitstop).toBeUndefined();
    expect(dto.areas[0].roadtripId).toBe("r1");
  });
});

describe("applyExistingTarget", () => {
  const album = {
    name: "Northvale loop",
    existing: null,
    assetCount: 3,
    images: 3,
    videos: 0,
    allowed: true,
    missingScopes: [],
  };
  const facts = {
    windowAssetIds: ["w1", "w2", "w3"],
    contextIds: new Set(["c1"]),
    fetchFrom: new Date("2031-04-28T10:00:00.000Z"),
    fetchTo: new Date("2031-05-13T12:00:00.000Z"),
  };
  const asset = (id: string, at: string): ImmichAsset => ({
    id,
    type: "IMAGE",
    fileCreatedAt: at,
    originalFileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: null,
    lat: null,
    lon: null,
  });

  function deps(listAlbumAssets: ExistingDeps["client"]["listAlbumAssets"]): ExistingDeps {
    return {
      immichUserId: ME,
      state: state({
        albums: [
          {
            linkId: "l1",
            immichAlbumId: "al-1",
            albumName: "Northvale loop",
            assetCount: 3,
            ownedByUser: true,
            travstatsMarker: true,
          },
        ],
      }),
      client: {
        getAlbumInfo: jest.fn(async (id: string) => ({
          id,
          albumName: "Northvale loop",
          description: "TravStats trip · x",
          ownerId: ME,
          assetCount: 2,
          thumbnailAssetId: null,
        })),
        listAlbumAssets,
        findOwnedAlbumByName: jest.fn(async () => null),
        getMyApiKey: jest.fn(async () => ({ permissions: ["albumAsset.delete"] })),
      },
    };
  }

  it("changes nothing for a new trip", async () => {
    const dto = draft(TRIP);
    expect(await applyExistingTarget(null, facts, dto, new Map())).toEqual({ dto });
  });

  it("previews the album sync and remembers which album and which members it judged", async () => {
    const list = jest.fn(async () => [
      asset("w1", "2031-05-03T09:00:00.000Z"),
      asset("c1", "2031-05-01T09:00:00.000Z"),
    ]);
    const out = await applyExistingTarget(
      deps(list),
      facts,
      draft(TRIP, [area()], { album }),
      new Map()
    );
    expect(out.dto.album?.sync).toEqual({
      target: "linked",
      toAdd: 2,
      alreadyIn: 1,
      removable: { count: 1, defaultOn: true, allowed: true },
    });
    expect(out.existing?.album).toEqual({ immichAlbumId: "al-1", outsideIds: ["c1"] });
  });

  it("blocks the album as unverified when Immich cannot be read, instead of previewing nothing", async () => {
    const failing = jest.fn(async () => {
      throw new Error("immich unreachable");
    });
    const out = await applyExistingTarget(
      deps(failing),
      facts,
      draft(TRIP, [area()], { album }),
      new Map()
    );
    expect(out.dto.album).toMatchObject({ allowed: false, blockedReason: "unverified" });
    expect(out.dto.album?.sync).toBeUndefined();
    expect(out.existing?.album).toBeNull();
  });
});
