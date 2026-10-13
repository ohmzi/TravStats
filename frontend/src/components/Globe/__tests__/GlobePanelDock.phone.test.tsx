import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobePanelDock } from "../GlobePanelDock";
import { GlobeControlPanel } from "../GlobeControlPanel";
import { PHONE_COLUMN_RESERVED, PHONE_PANEL_BOTTOM, PHONE_COLUMN_TOP } from "../../map/phoneChrome";
import { DEFAULT_FLIGHT_COLOR_CONFIG } from "../../../lib/flightColor";
import { DEFAULT_CRUISE_COLOR_CONFIG } from "../../../lib/cruiseColor";

/**
 * The map panel's phone band (2026-10-12 collision 4, measured in Chrome at
 * 390×844): the panel is 232px of a 390px screen, and its bottom-left corner
 * is where the map key's pill and "Domänen · x/y" live too — the panel's
 * bottom edge sat on the key's rows and its width reached under the button.
 * On a phone `GlobePanelDock` therefore gives it a band of its own
 * (`map/phoneChrome.ts`) and the card shrinks to its header while shut.
 *
 * Deliberate-break protocol: remove the `phone` branches in GlobePanelDock.tsx
 * and the two placement cases fail; in GlobeControlPanel.tsx, restore
 * `className="flex w-[232px] …"` and the width case fails.
 */

function setViewport(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** The panel with every required prop, but no appearance sections to draw. */
function panel(): JSX.Element {
  const noop = (): void => {};
  return (
    <GlobeControlPanel
      autoRotate={false}
      onAutoRotateChange={noop}
      showNight={false}
      onShowNightChange={noop}
      labelsMode="off"
      onLabelsModeChange={noop}
      showTerrain={false}
      onShowTerrainChange={noop}
      showPlaceLabels={false}
      onShowPlaceLabelsChange={noop}
      styleOptions={[{ id: "dark", label: "Dark" }]}
      styleId="dark"
      onStyleChange={noop}
      liteMode="auto"
      lite={false}
      onLiteModeChange={noop}
      onRecenter={noop}
      legendRanges={[]}
      activeQuartile={null}
      onQuartileChange={noop}
      hasArcs={false}
      antipodalCount={0}
      hasWeakArcs={false}
      appearanceDomains={[]}
      flightAppearance={{
        colorConfig: DEFAULT_FLIGHT_COLOR_CONFIG,
        onColorModeChange: noop,
        onColorChange: noop,
        routeWidth: 1,
        onRouteWidthChange: noop,
        markerColor: null,
        onMarkerColorChange: noop,
        markerSize: 1,
        onMarkerSizeChange: noop,
      }}
      cruiseAppearance={{
        colorConfig: DEFAULT_CRUISE_COLOR_CONFIG,
        onColorModeChange: noop,
        onColorChange: noop,
        routeWidth: 1,
        onRouteWidthChange: noop,
        markerColor: null,
        onMarkerColorChange: noop,
        markerSize: 1,
        onMarkerSizeChange: noop,
      }}
      lodgingAppearance={{ markerSize: 1, onMarkerSizeChange: noop }}
      placeAppearance={{ markerSize: 1, onMarkerSizeChange: noop }}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  setViewport(false);
});

describe("GlobePanelDock", () => {
  it("keeps the bottom-left corner on a desktop", () => {
    setViewport(false);
    const { container } = render(
      <GlobePanelDock>
        <div />
      </GlobePanelDock>
    );
    const dock = container.firstElementChild as HTMLElement;
    expect(dock.className).toContain("bottom-4");
    expect(dock.className).toContain("left-4");
    expect(dock.style.bottom).toBe("");
  });

  it("docks into the panel band on a phone, above the key pill and the filter button", () => {
    setViewport(true);
    const { container } = render(
      <GlobePanelDock>
        <div />
      </GlobePanelDock>
    );
    const dock = container.firstElementChild as HTMLElement;
    expect(dock.className).not.toContain("bottom-4");
    expect(dock.style.left).toBe("12px");
    expect(dock.style.right).toBe("12px");
    expect(dock.style.bottom).toContain(`${PHONE_PANEL_BOTTOM}px`);
    expect(dock.style.bottom).toContain("safe-area-inset-bottom");
  });
});

describe("GlobeControlPanel in that band", () => {
  it("shrinks to its header while shut on a phone", () => {
    setViewport(true);
    const { container } = render(panel());
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("w-auto");
    expect(card.className).not.toContain("w-[232px]");
    expect(card.style.maxHeight).toBe(
      `calc(100vh - var(--ts-map-chrome-top, ${PHONE_COLUMN_TOP}px) - ${PHONE_COLUMN_RESERVED}px - ${PHONE_PANEL_BOTTOM}px)`
    );
  });

  it("fills the width and stays above the right column once open", () => {
    setViewport(true);
    // The opened body IS `MapChromeSections`, which reads the dashboard route.
    const { container } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>{panel()}</MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /globe\.panel\.title/ }));
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("w-full");
    // The cap names the measured column top (`--ts-map-chrome-top`), so the
    // open panel can never reach the stats card above it.
    expect(card.style.maxHeight).toContain("--ts-map-chrome-top");
  });

  it("is the 232px card with its old cap on a desktop", () => {
    setViewport(false);
    const { container } = render(panel());
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("w-[232px]");
    expect(card.style.maxHeight).toBe("calc(100vh - 232px)");
  });
});
