import { describe, it, expect, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobeStatsCard, type GlobeLiveStats } from "../GlobeStatsCard";
import { PHONE_COLUMN_RESERVED, PHONE_COLUMN_TOP } from "../../map/phoneChrome";

/**
 * The "Sichtbar" card on a phone (2026-10-12 collision 3: its six rows
 * "overlap the globe and its labels" at 390×844). On a phone it is the
 * secondary card in the right column — "Als Nächstes" above it is the
 * essential one — so it starts as its heading and opens on tap, its opened
 * body capped to the room the column reserves for it (`phoneChrome.ts`,
 * PHONE_COLUMN_RESERVED).
 *
 * jsdom has no layout: what is asserted is what the layout READS — which
 * rows render, the button's aria-expanded, and the cap on the opened body.
 *
 * Deliberate-break protocol: make the default `open` unconditionally true in
 * GlobeStatsCard.tsx and the two "starts as its heading" cases fail.
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

/** The element the rows were rendered into (the card's inner box). */
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

  it("caps and scrolls the opened rows inside the column's reserved room", () => {
    setViewport(true);
    const { container } = render(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    fireEvent.click(screen.getByRole("button", { name: /stats\.title/ }));
    expect(screen.getByRole("button", { name: /stats\.title/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    // Every row is there once opened — nothing is dropped on a phone...
    expect(screen.getByText(/stats\.flightKm/)).toBeTruthy();
    expect(screen.getByText(/stats\.top/)).toBeTruthy();
    // ...but the body may not grow past the band the panel below it leaves.
    const capped = body(container);
    expect(capped.style.maxHeight).toBe(`min(20vh, ${PHONE_COLUMN_RESERVED - 8}px)`);
    expect(capped.style.overflowY).toBe("auto");
  });

  it("stays shut after a second tap — the choice, once made, is not the width's", () => {
    setViewport(true);
    const { rerender } = render(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    fireEvent.click(screen.getByRole("button", { name: /stats\.title/ }));
    fireEvent.click(screen.getByRole("button", { name: /stats\.title/ }));
    expect(screen.queryByText(/stats\.flightKm/)).toBeNull();

    // A re-render at the same width keeps it shut rather than falling back to
    // the phone default — the rule `useLegendOpen` follows for the map key.
    rerender(<GlobeStatsCard stats={STATS} t={(k) => k} />);
    expect(screen.queryByText(/stats\.flightKm/)).toBeNull();
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
