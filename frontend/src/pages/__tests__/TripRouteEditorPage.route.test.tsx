import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/roadtrips/:routeId/edit` reaches the trip's edit page (the SAME route &
 * recordings editor as `/tours/:routeId`) and not the trip page; `/roadtrips/:id`
 * still reaches the trip. Rendered through the app's OWN router, because a
 * component test stays green with the `<Route>` deleted. The mocks are the ones
 * the other route tests need: `App` boots a setup check, a session validation,
 * a what's-new lookup and a settings load before it renders any route, and a
 * frontend test may reach no network.
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
  useEnabledDomains: () => ({ enabled: ["roadtrip"], isEnabled: () => true }),
}));
// The trip page is its own suite's subject; here it only has to be the OTHER route.
vi.mock("../RoadtripDetailPage", () => ({
  default: () => <div data-testid="roadtrip-detail-stub" />,
}));
// The edit page is this task's subject; the route table is what this suite pins.
vi.mock("../TripRouteEditorPage", () => ({
  default: () => <div data-testid="trip-edit-stub" />,
}));

vi.unmock("../../store/settingsStore");

import App from "../../App";
import { useSettingsStore } from "../../store/settingsStore";

describe("the /roadtrips/:routeId/edit route", () => {
  beforeEach(() => {
    // The domain guard waits for the settings load; a cold store would make
    // this suite test the loading state instead of the route table.
    useSettingsStore.setState({ enabledDomainsLoaded: true, betaFeaturesEnabled: true });
  });

  it("reaches the trip's edit page ahead of /roadtrips/:id", async () => {
    window.history.pushState({}, "", "/roadtrips/9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a/edit");

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("trip-edit-stub")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.queryByTestId("roadtrip-detail-stub")).toBeNull();
  });

  it("still reaches a trip at /roadtrips/:id", async () => {
    window.history.pushState({}, "", "/roadtrips/9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a");

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("roadtrip-detail-stub")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.queryByTestId("trip-edit-stub")).toBeNull();
  });
});
