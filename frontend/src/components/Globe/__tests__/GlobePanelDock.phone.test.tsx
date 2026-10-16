import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobePanelDock } from "../GlobePanelDock";
import { GlobeControlPanel } from "../GlobeControlPanel";
import { PHONE_PANEL_BOTTOM } from "../../map/phoneChrome";
import { saveMapAppearance } from "../../map/mapAppearance";
import { DEFAULT_FLIGHT_COLOR_CONFIG } from "../../../lib/flightColor";
import { DEFAULT_CRUISE_COLOR_CONFIG } from "../../../lib/cruiseColor";

/**
 * The map panel's phone band (2026-10-12 collision 4, measured in Chrome at
 * 390×844): the panel is 232px of a 390px screen, and its bottom-left corner
 * is where the map key's pill and "Domänen · x/y" live too — the panel's
 * bottom edge sat on the key's rows and its width reached under the button.
 * On a phone the panel is therefore a pill in the bottom row
 * (`map/phoneChrome.ts`, PHONE_PANEL_BOTTOM) that opens the shared bottom
 * sheet (`ui/Sheet`), the shape every popup over the phone map has since
 * 2026-10-16.
 *
 * Deliberate-break protocol: remove the `phone` branches in GlobePanelDock.tsx
 * and the two placement cases fail; in MapPanelFrame.tsx, drop the `phone`
 * branch and the pill and sheet cases fail.
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

  it("docks the pill into the bottom row's left end on a phone", () => {
    setViewport(true);
    const { container } = render(
      <GlobePanelDock>
        <div />
      </GlobePanelDock>
    );
    const dock = container.firstElementChild as HTMLElement;
    expect(dock.className).not.toContain("bottom-4");
    expect(dock.style.left).toBe("16px");
    // No right edge: the pill keeps its own width, so "Domänen · x/y" at the
    // row's other end is never under it.
    expect(dock.style.right).toBe("");
    expect(dock.style.bottom).toContain(`${PHONE_PANEL_BOTTOM}px`);
    expect(dock.style.bottom).toContain("safe-area-inset-bottom");
  });
});

describe("GlobeControlPanel on a phone", () => {
  it("is a pill, not a card, while shut", () => {
    setViewport(true);
    render(panel());
    const pill = screen.getByRole("button", { name: /globe\.panel\.title/ });
    expect(pill.className).toContain("ts-chrome-pill");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens its sections in the shared bottom sheet", () => {
    setViewport(true);
    // The opened body IS `MapChromeSections`, which reads the dashboard route.
    render(<MemoryRouter initialEntries={["/dashboard"]}>{panel()}</MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /globe\.panel\.title/ }));
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    expect(within(sheet).getByText(/globe\.panel\.layers/)).toBeTruthy();
  });

  it("never starts with the sheet up, whatever the desktop remembered", () => {
    // The desktop's expanded state is persisted; a sheet on load would hide
    // the map behind a scrim before the reader has seen it.
    saveMapAppearance({ panelExpanded: true });
    setViewport(true);
    render(panel());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("GlobeControlPanel on a desktop", () => {
  it("is the 232px card with its old cap", () => {
    setViewport(false);
    const { container } = render(panel());
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("w-[232px]");
    expect(card.style.maxHeight).toBe("calc(100vh - 232px)");
  });
});
