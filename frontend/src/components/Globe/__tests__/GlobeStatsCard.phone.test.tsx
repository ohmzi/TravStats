import { describe, it, expect, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GlobeStatsCard, type GlobeLiveStats } from "../GlobeStatsCard";
import { PHONE_COLUMN_TOP } from "../../map/phoneChrome";

/**
 * The "Sichtbar" card on a phone (2026-10-12 collision 3: its six rows
 * "overlap the globe and its labels" at 390×844). On a phone it is the
 * secondary card in the right column — "Als Nächstes" above it is the
 * essential one — so it is a pill with its heading and count, and its rows
 * open in the shared bottom sheet (`ui/Sheet`) like every popup on the phone
 * map (owner, 2026-10-16). It used to unfold in place, into the map panel's
 * band.
 *
 * jsdom has no layout: what is asserted is what the layout READS — which
 * rows render, where, and the pill's aria-expanded.
 *
 * Deliberate-break protocol: render `rows(true)` beside the pill instead of
 * inside the `<Sheet>` in GlobeStatsCard.tsx and the "opens a sheet" case
 * fails.
 */

const STATS: GlobeLiveStats = {
  flights: 42,
  routes: 37,
  flightKm: 123456,
  cruises: 3,
  ports: 11,
  topAirport: { iata: "FRA", name: "Frankfurt", size: 9 },
};

/** Forces `useIsPhoneViewport` (max-width: 639px). */
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

/** The desktop card's inner box, which the rows render into. */
function body(container: HTMLElement): HTMLElement {
  const rows = container.querySelector(".space-y-0\\.5") as HTMLElement;
  return rows.parentElement as HTMLElement;
}

afterEach(() => {
  setViewport(false);
});

describe("GlobeStatsCard on a phone", () => {
  it("starts as its heading with the flight count, rows closed", () => {
    setViewport(true);
    const { container } = render(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    const toggle = screen.getByRole("button", { name: /stats\.title/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The one number that earns its place beside the title while shut.
    expect(toggle.textContent).toContain("42");
    expect(screen.queryByText(/stats\.flightKm/)).toBeNull();
    expect(container.querySelector(".space-y-0\\.5")).toBeNull();
    // With no next-up card there is no measured offset: a phone still falls
    // back to the band's column top, never to the desktop 4rem, which would
    // put the card on the activity strip.
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.top).toBe(`var(--ts-map-chrome-top, ${PHONE_COLUMN_TOP}px)`);
  });

  it("opens its rows in the shared bottom sheet, not in place", () => {
    setViewport(true);
    const { container } = render(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    fireEvent.click(screen.getByRole("button", { name: /stats\.title/ }));
    const sheet = screen.getByRole("dialog", { name: /stats\.title/ });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    // Every row is there once opened — nothing is dropped on a phone...
    expect(within(sheet).getByText(/stats\.flightKm/)).toBeTruthy();
    expect(within(sheet).getByText(/stats\.top/)).toBeTruthy();
    // ...and none of them in the map's right column, where they used to unfold.
    expect(within(container).queryByText(/stats\.flightKm/)).toBeNull();
  });

  it("closes the sheet with its Done button and keeps the pill", () => {
    setViewport(true);
    render(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    fireEvent.click(screen.getByRole("button", { name: /stats\.title/ }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /done|fertig/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /stats\.title/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});

describe("GlobeStatsCard on a desktop", () => {
  it("renders the rows directly, with no toggle and no cap", () => {
    setViewport(false);
    const { container } = render(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    expect(screen.getByText(/stats\.flights/)).toBeTruthy();
    expect(screen.getByText(/stats\.flightKm/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(body(container).style.maxHeight).toBe("");
  });

  it("still renders nothing without any flights or cruises", () => {
    setViewport(false);
    const { container } = render(
      <GlobeStatsCard stats={{ ...STATS, flights: 0, cruises: 0 }} t={(k) => k} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
