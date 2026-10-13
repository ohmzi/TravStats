import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The right column's top on a phone (2026-10-12 collision 2, measured in
 * Chrome at 390×844): "Als Nächstes" kept the desktop `top: 64` and landed on
 * the activity strip, which on a phone sits in a full-width row of its own
 * ending at y=122 (`map/phoneChrome.ts`). The column starts at
 * PHONE_COLUMN_TOP there, and the measured `--ts-map-chrome-top` — the top of
 * the "Sichtbar" card under it — is derived from the SAME number, so the two
 * cards cannot drift apart.
 *
 * jsdom has no ResizeObserver, so this suite stubs one that never fires: the
 * offset the effect writes on mount is the measured card's own height (0 in
 * jsdom), which is exactly the value the two assertions need.
 *
 * Deliberate-break protocol: put `top: 64` back in DashboardLayout.tsx and
 * the phone case fails.
 */

vi.mock("../../../../src/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));

vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));

vi.mock("../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "all", setTab: vi.fn() }),
}));

vi.mock("../../../lib/api/upcoming", () => ({
  getUpcoming: vi.fn().mockResolvedValue([
    {
      domain: "flight",
      id: "f1",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      detailId: "f1",
      tripId: null,
      tripName: null,
      primary: "München → Wien",
      secondary: "LH 1234",
    },
  ]),
}));

// Not under test here; its own selectors need profile fields the global
// settingsStore mock does not provide.
vi.mock("../../NavigationBar", () => ({
  default: () => <div data-testid="navigation-bar-stub" />,
}));

// Imported after the mocks above so the module graph picks them up.
import { DashboardLayout } from "../DashboardLayout";
import { PHONE_COLUMN_TOP } from "../../map/phoneChrome";

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

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
});

afterEach(() => {
  setViewport(false);
});

async function renderAt(): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <DashboardLayout counts={{ flight: 1, cruise: 0, poi: 0, lodging: 0, roadtrip: 0, rail: 0 }}>
        <div />
      </DashboardLayout>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId("map-next-up-card")).toBeInTheDocument());
  return screen.getByTestId("map-next-up-card").parentElement as HTMLElement;
}

describe("the right column's top", () => {
  it("starts at the phone band's column top on a phone", async () => {
    setViewport(true);
    const wrapper = await renderAt();
    expect(wrapper.style.top).toBe(`${PHONE_COLUMN_TOP}px`);
  });

  it("starts at the desktop offset (64px) on a desktop", async () => {
    setViewport(false);
    const wrapper = await renderAt();
    expect(wrapper.style.top).toBe("64px");
  });
});
