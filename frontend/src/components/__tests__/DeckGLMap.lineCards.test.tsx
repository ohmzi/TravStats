import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { useMemo, useState } from "react";
import { PathLayer } from "@deck.gl/layers";

/**
 * The dashboard's LINES are drawn as decks layers, and a tap on one answers with
 * the shared pinned card. Two things the tab's own suite (with MapContainer3D
 * mocked) cannot see, and that the owner hit on the deployed dashboard, live on
 * the real flat map (owner, 2026-10-09):
 *
 *  4a/guarding — deck.gl's layer pick and MapLibre's own Map click BOTH fire for
 *  one tap, and the Map handler's background branch clears whatever the tap
 *  opened. Every layer the map builds claims the tap by setting `deckClickedRef`;
 *  a caller's `extraLayers` did not, so a roadtrip line's card was set and wiped
 *  in the same tap. This fires the real click sequence and asserts the card
 *  survives.
 *
 *  4b/one slot — the pinned card is ONE value owned by the tab. A roadtrip pick
 *  and a flight selection must replace each other, not stack. This drives both
 *  through the REAL DeckGLMap and asserts the single rendered card's kind flips.
 */

const { deckLayers, mapProps, cardProps } = vi.hoisted(() => ({
  deckLayers: [] as Array<Array<{ id: string; props: Record<string, unknown> }>>,
  mapProps: [] as Array<Record<string, unknown>>,
  cardProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../map/DeckGLOverlay", () => ({
  // The overlay only draws; the layers handed to it are the map's own output.
  DeckGLOverlay: ({ layers }: { layers: Array<{ id: string; props: Record<string, unknown> }> }) => {
    deckLayers.push(layers);
    return null;
  },
  // A jsdom canvas has no GL, but the guard is about the click WIRING, which is
  // testable without a GPU — so this pins the "device can run deck.gl" branch.
  webgl2Available: true,
}));

vi.mock("react-map-gl/maplibre", () => {
  const fakeMap = {
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 2),
    project: vi.fn(([lon, lat]: [number, number]) => ({ x: lon, y: lat })),
    flyTo: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => document.createElement("div")),
  };
  const MockMapGL = React.forwardRef(function MockMapGL(
    props: { children?: React.ReactNode; onLoad?: () => void },
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    mapProps.push(props as unknown as Record<string, unknown>);
    // DeckGLMap only mounts the overlay once the map reports it loaded.
    React.useEffect(() => {
      props.onLoad?.();
    }, []);
    return React.createElement("div", { "data-testid": "fake-maplibre-map" }, props.children);
  });
  return {
    __esModule: true,
    default: MockMapGL,
    useControl: () => null,
    useMap: () => ({ current: null }),
  };
});

vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: class {
    setProps(): void {}
  },
}));

vi.mock("../map/FlatMapControlPanel", () => ({ FlatMapControlPanel: () => null }));
vi.mock("../TimeSlider", () => ({ TimeSlider: () => null }));
vi.mock("../NativeRoutesLayer", () => ({
  NativeRoutesLayer: () => null,
  NATIVE_ROUTE_LINE_ID: "native-route-line",
  NATIVE_AIRPORT_CIRCLE_ID: "native-airport-circle",
}));
vi.mock("../Globe/mapOverlays", () => ({ applyMapOverlays: vi.fn() }));

// The card has its own suite; here we only need WHICH card the flat map mounted
// and therefore which kind won the one slot.
vi.mock("../map/cards/PinnedCard", () => ({
  PinnedCard: (props: Record<string, unknown>) => {
    cardProps.push(props);
    return React.createElement("div", { "data-testid": "shared-pinned-card" });
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

import { DeckGLMap } from "../DeckGLMap";
import { buildTourDeckLayers, roadtripPinned } from "../Dashboard/tabs/tourMapOverlay";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../../store/cruiseSelectionStore";
import { useMapCameraStore } from "../../store/mapCameraStore";
import type { TourPathDatum } from "../layers/tourPathsLayer";
import type { MapPinned } from "../map/cards/pinnedTypes";
import type { Flight, GeoJSONFeature } from "../../types";

const DATUM: TourPathDatum = {
  legId: "leg-1",
  routeId: "rt-1",
  name: "Nordkap",
  path: [
    [8, 58],
    [8.2, 58.3],
  ],
  color: [90, 120, 200],
  isPlaceholder: false,
  isRoadtrip: true,
  label: "Nordkap · 12 km",
};

function leg(id: string): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [10, 50],
        [20, 40],
      ],
    },
    properties: {
      id,
      airline: "Delta Air Lines",
      flightNumber: "DL6287",
      departureAirport: { iata: "TOS", name: "TOS Airport", country: "NO" },
      arrivalAirport: { iata: "AGP", name: "AGP Airport", country: "ES" },
      departureTime: "2021-06-05T08:00:00Z",
      arrivalTime: "2021-06-05T12:00:00Z",
      status: "flown",
      distance: 3931,
    },
  } as unknown as GeoJSONFeature;
}

function flight(id: string): Flight {
  return {
    id,
    depIata: "TOS",
    arrIata: "AGP",
    depLon: 10,
    depLat: 50,
    arrLon: 20,
    arrLat: 40,
    departureTime: "2021-06-05T08:00:00Z",
  } as unknown as Flight;
}

/** The tour layer the overlay actually received, cloned by DeckGLMap's guard. */
function drawnLayer(id = "dashboard-tour-paths") {
  const latest = deckLayers[deckLayers.length - 1] ?? [];
  return latest.find((l) => l.id === id);
}

/** The MapLibre click handler DeckGLMap wired, for firing a background click. */
function nativeClick(evt: unknown): void {
  const handler = mapProps[mapProps.length - 1]?.onClick as ((e: unknown) => void) | undefined;
  handler?.(evt);
}

async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

beforeEach(() => {
  deckLayers.length = 0;
  mapProps.length = 0;
  cardProps.length = 0;
  useFlightSelectionStore.getState().clearSelection();
  useCruiseSelectionStore.getState().clearSelection();
  useMapCameraStore.setState({ camera: {} });
  window.localStorage.clear();
  vi.useFakeTimers();
});

describe("the flat map guards a caller's extra-layer pick", () => {
  it("keeps the card a tap on an extra layer opened, instead of letting the background click wipe it", () => {
    const setPinned = vi.fn();
    const layer = new PathLayer({
      id: "dashboard-tour-paths",
      data: [DATUM],
      pickable: true,
      // Stands in for the tab's handler: the tap opens a card.
      onClick: () => setPinned(roadtripPinned(DATUM, [8.1, 58.15])),
    });

    render(
      <DeckGLMap flights={[]} visMode="routes" extraLayers={[layer]} pinned={null} onPinnedChange={setPinned} />
    );

    const drawn = drawnLayer();
    expect(drawn).toBeDefined();
    // The map wrapped it: the instance the overlay got is not the caller's.
    expect(drawn).not.toBe(layer);
    expect(typeof drawn!.props.onClick).toBe("function");

    const before = setPinned.mock.calls.length;
    // The deck layer's pick fires first and claims the tap…
    act(() => {
      (drawn!.props.onClick as (info: unknown, event: unknown) => void)(
        { object: DATUM, coordinate: [8.1, 58.15] },
        {}
      );
    });
    expect(setPinned).toHaveBeenLastCalledWith(roadtripPinned(DATUM, [8.1, 58.15]));

    // …then MapLibre's own background click runs; the guard must swallow it.
    act(() => nativeClick({ features: [] }));
    expect(setPinned.mock.calls.length).toBe(before + 1);
    expect(setPinned).toHaveBeenLastCalledWith(roadtripPinned(DATUM, [8.1, 58.15]));
  });
});

describe("the flat map holds ONE pinned slot across both line kinds", () => {
  function Harness(): JSX.Element {
    const [pinned, setPinned] = useState<MapPinned | null>(null);
    const layers = useMemo(
      () => buildTourDeckLayers([DATUM], 0, undefined, (d, c) => setPinned(roadtripPinned(d, c))),
      []
    );
    return (
      <DeckGLMap flights={[leg("f1")]} visMode="routes" extraLayers={layers} pinned={pinned} onPinnedChange={setPinned} />
    );
  }

  it("replaces an open roadtrip card when a flight is selected, not stack a second", async () => {
    render(<Harness />);

    const drawn = drawnLayer();
    expect(drawn).toBeDefined();

    // A roadtrip line pick opens the roadtrip card…
    await act(async () => {
      (drawn!.props.onClick as (info: unknown, event: unknown) => void)(
        { object: DATUM, coordinate: [8.1, 58.15] },
        {}
      );
    });
    expect(screen.getByTestId("shared-pinned-card")).toBeInTheDocument();
    expect((cardProps[cardProps.length - 1].pinned as { kind: string }).kind).toBe("roadtrip");

    // …then the SAME slot takes a flight selection, so only one card remains.
    act(() => {
      useFlightSelectionStore.getState().setSelection([flight("f1")]);
    });
    await settle();

    expect((cardProps[cardProps.length - 1].pinned as { kind: string }).kind).toBe("arc");
  });
});
