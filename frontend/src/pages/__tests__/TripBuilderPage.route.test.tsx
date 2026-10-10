import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/trips/builder` reaches the builder page and not a trip whose id is
 * "builder"; `/trips/:id` still reaches a trip. Rendered through the app's OWN
 * router, because a component test stays green with the `<Route>` deleted.
 * The mocks are the ones the other route tests need: `App` boots a setup
 * check, a session validation, a what's-new lookup and a settings load before
 * it renders any route, and a frontend test may reach no network.
 */
vi.mock("../../lib/api", () => ({
  setupApi: {
    getStatus: vi.fn().mockResolvedValue({ requiresSetup: false }),
    getAirportSeedingStatus: vi.fn().mockResolvedValue(null),
  },
  usageStatsApi: { get: vi.fn().mockResolvedValue({ consent: "granted" }) },
  settingsApi: {
    getProfile: vi.fn().mockResolvedValue({ birthdate: null }),
    get: vi.fn().mockResolvedValue({}),
  },
  pendingUpdatesApi: { getAll: vi.fn().mockResolvedValue({ updates: [] }) },
  dataQualityFlagsApi: { getAll: vi.fn().mockResolvedValue({ flags: [] }) },
}));

vi.mock("../../hooks/useWebPrefsSync", () => ({ useWebPrefsSync: () => undefined }));
vi.mock("../../hooks/useSessionValidation", () => ({
  useSessionValidation: () => ({ sessionChecked: true }),
}));
vi.mock("../../hooks/useWhatsNew", () => ({
  useWhatsNew: () => ({ entry: null, shouldShow: false, dismiss: vi.fn() }),
}));

const authState = {
  user: { id: "u1", username: "demo", isAdmin: false },
  _hasHydrated: true,
};
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));
// The trip page is its own suite's subject; here it only has to be the OTHER route.
vi.mock("../TripDetailPage", () => ({
  default: () => <div data-testid="trip-detail-stub" />,
}));

vi.unmock("../../store/settingsStore");

import App from "../../App";

describe("the /trips/builder route", () => {
  it("reaches the builder page, ahead of /trips/:id", async () => {
    window.history.pushState({}, "", "/trips/builder?job=6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d");

    render(<App />);

    await waitFor(() => expect(screen.getByText("tripBuilder:page.title")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.queryByTestId("trip-detail-stub")).toBeNull();
  });

  it("still reaches a trip at /trips/:id", async () => {
    window.history.pushState({}, "", "/trips/9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a");

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("trip-detail-stub")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.queryByText("tripBuilder:page.title")).toBeNull();
  });
});
