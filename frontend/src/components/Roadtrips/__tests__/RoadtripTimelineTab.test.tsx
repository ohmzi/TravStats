import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { RoadtripDetail, RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => {
      if (o && "n" in o) return `${k}:${String(o.n)}`;
      if (o && "count" in o) return `${k}:${String(o.count)}`;
      return k;
    },
    i18n: { language: "de" },
  }),
}));

import RoadtripTimelineTab, { stationDayGroups } from "../RoadtripTimelineTab";

const at = (d: string) => `${d}T00:00:00.000Z`;

function station(id: string, over: Partial<RoadtripStation>): RoadtripStation {
  return {
    id,
    title: id,
    lat: 60,
    lon: 7,
    startDate: null,
    endDate: null,
    notes: null,
    order: 0,
    state: "pass",
    lodgingStayId: null,
    stay: null,
    ...over,
  };
}

function leg(from: string, to: string, over: Partial<TourLeg>): TourLeg {
  return {
    id: `${from}-${to}`,
    fromStopId: from,
    toStopId: to,
    distanceKm: 10,
    source: "straight",
    mode: "road",
    confidence: "estimate",
    waypoints: null,
    drivingMinutes: null,
    ...over,
  };
}

const STATIONS: RoadtripStation[] = [
  station("Hirtshals", {
    state: "free",
    startDate: at("2031-05-02"),
    endDate: at("2031-05-03"),
    notes: "Ferry queued overnight at the harbour",
  }),
  station("Fjordhotel", {
    state: "stay",
    startDate: at("2031-05-03"),
    endDate: at("2031-05-05"),
    lodgingStayId: "st1",
    stay: {
      id: "st1",
      lodgingId: "l1",
      lodgingName: "Fjordhotel",
      lodgingType: "hotel",
      city: null,
      country: null,
      checkIn: at("2031-05-03"),
      checkOut: at("2031-05-05"),
      nights: 2,
      status: "confirmed",
    },
  }),
  station("Dunholme", {
    state: "pass",
    startDate: at("2031-05-05"),
    placeId: "p1",
    place: { id: "p1", name: "Dunholme pier", category: "poi" },
  }),
];

const DETAIL = {
  startDate: at("2031-05-02"),
  stations: STATIONS,
  legs: [
    leg("Hirtshals", "Fjordhotel", {
      mode: "ferry",
      distanceKm: 140,
      drivingMinutes: 135,
      source: "routed",
    }),
    leg("Fjordhotel", "Dunholme", { mode: "road", distanceKm: 62 }),
  ],
} as unknown as RoadtripDetail;

function renderTab(): void {
  render(
    <MemoryRouter>
      <RoadtripTimelineTab detail={DETAIL} />
    </MemoryRouter>
  );
}

describe("stationDayGroups", () => {
  it("opens a group per arrival day, and one undated group for the stations without a day", () => {
    const groups = stationDayGroups(
      [
        station("a", { startDate: at("2031-05-02") }),
        station("b", { startDate: at("2031-05-02") }),
        station("c", { startDate: at("2031-05-05") }),
        station("d", {}),
      ],
      at("2031-05-02")
    );
    expect(groups.map((g) => [g.day, g.number, g.stations.map((s) => s.id)])).toEqual([
      ["2031-05-02", 1, ["a", "b"]],
      ["2031-05-05", 4, ["c"]],
      [null, null, ["d"]],
    ]);
  });
});

describe("RoadtripTimelineTab", () => {
  it("heads each day and spells out what the chain leaves out: the stay, the place, the nights, the notes", () => {
    renderTab();
    // The head carries the day number and the weekday/date beside it, so the
    // key is matched inside the one text node.
    expect(screen.getByText(/roadtrips:timeline\.day:1/)).toBeInTheDocument();
    expect(screen.getByText(/roadtrips:timeline\.day:4/)).toBeInTheDocument();
    // The chain draws the state chip and the night word; this tab adds the
    // dates, the linked stay and place, and the station's notes.
    expect(screen.getByText("Ferry queued overnight at the harbour")).toBeInTheDocument();
    // The station carries the stay's name as its title too, so the link is
    // reached by role.
    expect(screen.getByRole("link", { name: "Fjordhotel" })).toHaveAttribute("href", "/lodging/l1");
    expect(screen.getByRole("link", { name: "Dunholme pier" })).toHaveAttribute(
      "href",
      "/places/p1"
    );
    expect(screen.getByText("roadtrips:nightsCount:2")).toBeInTheDocument();
    expect(screen.getAllByText(/02\.05\. – 03\.05\./).length).toBeGreaterThan(0);
  });

  it("counts no night for a pass-through, even one re-kinded with both dates still on it", () => {
    render(
      <MemoryRouter>
        <RoadtripTimelineTab
          detail={{
            ...DETAIL,
            stations: [
              station("Dunholme", {
                state: "pass",
                startDate: at("2031-05-06"),
                endDate: at("2031-05-08"),
              }),
            ],
            legs: [],
          }}
        />
      </MemoryRouter>
    );
    // The chain draws a pass-through's arrival day alone, and a re-kinded
    // station keeps its dates (the editor clears them for "via" only): the tab
    // must not turn those dates into a night.
    expect(screen.queryByText(/roadtrips:nightsCount/)).toBeNull();
    expect(screen.getByText("06.05.")).toBeInTheDocument();
    expect(screen.queryByText(/08\.05\./)).toBeNull();
  });

  it("warns approxNight for a half-dated station, as the chain does", () => {
    render(
      <MemoryRouter>
        <RoadtripTimelineTab
          detail={{
            ...DETAIL,
            stations: [station("Kaupanger", { state: "free", startDate: at("2031-05-06") })],
            legs: [],
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("roadtrips:timeline.approxNight")).toBeInTheDocument();
    expect(screen.queryByText(/roadtrips:nightsCount/)).toBeNull();
  });

  it("draws the leg between two stations with its mode, distance and duration", () => {
    renderTab();
    expect(screen.getByText("roadtrips:timeline.leg.ferry")).toBeInTheDocument();
    expect(screen.getByText(/140 km · roadtrips:timeline.duration/)).toBeInTheDocument();
    expect(screen.getByText("roadtrips:timeline.source.routed")).toBeInTheDocument();
  });

  it("folds a route correction away, so the leg across it is one row", () => {
    const withVia = {
      ...DETAIL,
      // The correction bends the route: the fold merges the two legs into one
      // Hirtshals → Dunholme row of their summed distance.
      legs: [
        leg("Hirtshals", "Correction", { distanceKm: 90 }),
        leg("Correction", "Dunholme", { distanceKm: 62 }),
      ],
    } as RoadtripDetail;
    render(
      <MemoryRouter>
        <RoadtripTimelineTab
          detail={{
            ...withVia,
            stations: [
              STATIONS[0],
              station("Correction", { state: "via", lat: 61, lon: 8 }),
              STATIONS[2],
            ],
          }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText("Correction")).toBeNull();
    expect(screen.getByText(/152 km/)).toBeInTheDocument();
  });

  it("heads two groups of the SAME day with their own keys — an undated station in between", () => {
    // Grouping is by consecutive runs of equal arrival day, so an undated
    // station between two stations of one day really does open a second group
    // for that day. The section's key was the day itself, so the two sections
    // collided and React warned about duplicate keys ("may cause children to
    // be duplicated and/or omitted") — the key has to be unique per group
    // without changing the grouping.
    const errorSpy = vi.spyOn(console, "error");
    render(
      <MemoryRouter>
        <RoadtripTimelineTab
          detail={{
            ...DETAIL,
            stations: [
              station("Hirtshals", {
                state: "free",
                startDate: at("2031-05-02"),
                endDate: at("2031-05-03"),
              }),
              station("Kaupanger", { state: "free" }),
              station("Dunholme", { state: "pass", startDate: at("2031-05-02") }),
            ],
            legs: [],
          }}
        />
      </MemoryRouter>
    );
    const warned = errorSpy.mock.calls
      .flat()
      .map((a) => String(a))
      .join(" ");
    errorSpy.mockRestore();

    expect(warned).not.toContain("same key");
    // Both runs of the day are ON SCREEN — the collision must not drop one.
    expect(screen.getAllByText(/roadtrips:timeline\.day:1 · /)).toHaveLength(2);
    expect(screen.getByText("roadtrips:undated")).toBeInTheDocument();
  });

  it("says there is nothing yet instead of drawing an empty page", () => {
    render(
      <MemoryRouter>
        <RoadtripTimelineTab detail={{ ...DETAIL, stations: [], legs: [] }} />
      </MemoryRouter>
    );
    expect(screen.getByText("roadtrips:stations.empty")).toBeInTheDocument();
  });
});
