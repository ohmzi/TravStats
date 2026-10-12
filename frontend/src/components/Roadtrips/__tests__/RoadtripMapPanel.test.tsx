import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { TripMapContent } from "../../Trips/TripMap";
import type { RoadtripDetail, RoadtripStation } from "../../../types/roadtrip";
import type { TourGeometry } from "../../../types/tour";

// The map is a WebGL canvas; the stand-in draws what the panel hands it — the
// stops with their domain colours, the roadtrip's own line, the empty-state
// key and the extra highlight layers.
vi.mock("../../Trips/TripMap", () => ({
  default: ({
    trip,
    tourGeometries = [],
    extraLayers = [],
  }: {
    trip: TripMapContent;
    tourGeometries?: readonly { routeId: string; name: string; rgb?: [number, number, number] }[];
    extraLayers?: readonly unknown[];
  }) => (
    <div data-testid="map">
      <ul data-testid="stops">
        {(trip.stops ?? []).map((s) => (
          <li key={s.title}>{`${s.title}:${s.domain}`}</li>
        ))}
      </ul>
      <ul data-testid="lines">
        {tourGeometries.map((g) => (
          <li key={g.routeId}>{`${g.name}:${Array.isArray(g.rgb) ? g.rgb.length : 0}`}</li>
        ))}
      </ul>
      <span data-testid="empty-key">{trip.emptyKey}</span>
      <span data-testid="highlight">{String(extraLayers.length)}</span>
    </div>
  ),
}));

import RoadtripMapPanel from "../RoadtripMapPanel";

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

const GEOMETRY = { type: "FeatureCollection", features: [] } as unknown as TourGeometry;

const DETAIL = {
  roadtrip: { id: "rt1", name: "Coast run" },
  stations: [
    station("Hirtshals", { state: "free" }),
    station("Fjordhotel", { state: "stay" }),
    // A route correction bends the line; it is no station marker.
    station("Correction", { state: "via" }),
    station("Dunholme", { state: "pass" }),
  ],
  legs: [],
} as unknown as RoadtripDetail;

describe("RoadtripMapPanel", () => {
  it("hands the map the trip's stations with their colours, its own line and the roadtrip empty state", () => {
    render(<RoadtripMapPanel detail={DETAIL} geometry={GEOMETRY} />);

    const stops = screen.getByTestId("stops");
    expect(stops).toHaveTextContent("Hirtshals:roadtrip");
    expect(stops).toHaveTextContent("Fjordhotel:hotel");
    expect(stops).not.toHaveTextContent("Correction");
    expect(stops).toHaveTextContent("Dunholme:roadtrip");

    // The travelled line is the trip's own, in the roadtrip's colour.
    expect(screen.getByTestId("lines")).toHaveTextContent("Coast run:3");
    expect(screen.getByTestId("empty-key")).toHaveTextContent("roadtrips:map.empty");
  });

  it("draws no line before the geometry is there", () => {
    render(<RoadtripMapPanel detail={DETAIL} geometry={null} />);
    expect(screen.getByTestId("lines").childNodes).toHaveLength(0);
  });

  it("rings the station the chain selected, and rings nothing without one", () => {
    const { unmount } = render(
      <RoadtripMapPanel detail={DETAIL} geometry={null} selected={DETAIL.stations[0]} />
    );
    expect(screen.getByTestId("highlight")).toHaveTextContent("1");
    unmount();

    render(<RoadtripMapPanel detail={DETAIL} geometry={null} />);
    expect(screen.getByTestId("highlight")).toHaveTextContent("0");
  });

  it("rings no station without a coordinate — a highlight needs a point", () => {
    render(
      <RoadtripMapPanel
        detail={DETAIL}
        geometry={null}
        selected={station("Undated", { lat: null, lon: null })}
      />
    );
    expect(screen.getByTestId("highlight")).toHaveTextContent("0");
  });
});
