import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import FlightLegTimeline, { type TripLegFlight } from "../FlightLegTimeline";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // The keys echo, so an assertion can name the key it is pinning.
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

/**
 * One leg YYZ → YYT, the screenshot's own shape: two airports, one flight
 * between them, real UTC times so the duration is MEASURED rather than
 * estimated.
 */
function leg(over: Partial<TripLegFlight> = {}): TripLegFlight {
  return {
    id: "f1",
    airline: "Air Canada",
    flightNumber: "AC2054",
    depIata: "YYZ",
    arrIata: "YYT",
    depLat: 43.68,
    depLon: -79.63,
    arrLat: 47.62,
    arrLon: -52.75,
    depName: "Toronto",
    arrName: "St. John's",
    departureTime: "2026-06-12T08:00:00.000Z",
    arrivalTime: "2026-06-12T11:08:00.000Z",
    depTimeSemantics: "UTC",
    ...over,
  } as TripLegFlight;
}

function renderTimeline(onSelectStation = vi.fn(), selectedKey: string | null = null) {
  return render(
    <MemoryRouter>
      <FlightLegTimeline
        flights={[leg()]}
        selectedKey={selectedKey}
        onSelectStation={onSelectStation}
      />
    </MemoryRouter>
  );
}

describe("FlightLegTimeline", () => {
  it("draws each airport as a station that rings it on the map, and lets go again", () => {
    const onSelect = vi.fn();
    renderTimeline(onSelect);
    fireEvent.click(screen.getByRole("button", { name: /YYZ/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "YYZ", iata: "YYZ" }));
  });

  it("marks the station the page is ringing as pressed", () => {
    renderTimeline(vi.fn(), "YYT");
    expect(screen.getByRole("button", { name: /YYT/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the leg's own logbook row", () => {
    renderTimeline();
    expect(screen.getByRole("link", { name: /AC2054/ })).toHaveAttribute("href", "/flights/f1");
  });

  it("keeps the roadtrip leg's line and marker geometry, not a thinner, washed one", () => {
    const { container } = renderTimeline();
    // The connector between two stations is the roadtrip leg's line — 3px,
    // solid, the domain's colour (`StationTimeline.legLine`). It shipped as 2px
    // at 55% opacity; a regression back to that thinner, washed line must fail
    // here (owner, 2026-10-08).
    const line = container.querySelector("li.items-center > div > div");
    expect(line).not.toBeNull();
    expect(line).toHaveStyle({ width: "3px" });
    expect(line?.getAttribute("style") ?? "").not.toContain("opacity");
    // The marker sits 2px down, as a roadtrip station's does.
    const marker = container.querySelector("li.grid:not(.items-center) > div.flex.justify-center");
    expect(marker).not.toBeNull();
    expect(marker).toHaveStyle({ paddingTop: "2px" });
  });

  it("reads the leg's duration in the logbook's own format, not the roadtrip's", () => {
    renderTimeline();
    // 08:00 → 11:08 UTC is 188 minutes. This is `formatDurationWithEstimate`,
    // the SAME string the table row for this flight shows — kept deliberately
    // (owner, 2026-10-08) so the route line and the row cannot disagree about
    // one flight; the roadtrip leg's "1 h 16" is a different app-wide format,
    // not a thing this page may quietly match.
    expect(screen.getByText("3h 8min")).toBeInTheDocument();
  });
});
