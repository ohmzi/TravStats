import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import DomainImportPanel from "../../DomainImportPanel";
import { useTripImportAdapter } from "../tripAdapter";

/**
 * The trip chooser's routes. "From photos" is always offered and fetches
 * nothing to be offered (spec 2026-10-09 §G); choosing it opens the trip form
 * with "Inspect Immich" already on, which asks the server about Immich at once.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  detect: vi.fn(),
  capabilities: vi.fn(),
}));

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));
vi.mock("../../../CompanionPicker", () => ({ default: () => null }));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("@/hooks/useTripEntrySuggestions", () => ({
  useTripEntrySuggestions: () => ({ origins: [], destinations: [] }),
}));
vi.mock("../../../../lib/api", () => ({
  tripsApi: { create: mocks.create, detect: mocks.detect },
}));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { capabilities: mocks.capabilities },
}));
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../EmailImportTab", () => ({ default: () => null }));

const READY = {
  immich: {
    configured: true,
    source: "user",
    inspect: { ok: true, missingScopes: [] },
    album: { canCreate: true, reason: null },
  },
  roadtrips: true,
  routing: { available: true, canProbe: true },
  home: { known: true, confirmed: true },
};

function Host(): JSX.Element {
  const adapter = useTripImportAdapter(vi.fn());
  return <DomainImportPanel open onClose={vi.fn()} onItemsCreated={vi.fn()} adapter={adapter} />;
}

const settled = (): Promise<void> => waitFor(() => expect(screen.queryByRole("status")).toBeNull());

describe("the trip chooser", () => {
  beforeEach(() => {
    mocks.detect.mockReset();
    mocks.capabilities.mockReset().mockResolvedValue(READY);
  });

  it("offers building from existing entries first and from photos second, fetching nothing", () => {
    const { result } = renderHook(() => useTripImportAdapter(vi.fn()));
    const routes = result.current.routes ?? [];

    expect(routes.map((route) => route.id)).toEqual(["from-existing", "from-photos"]);
    expect(routes[1].title).toBe("tripBuilder:chooser.title");
    expect(routes[1].hidden).toBeUndefined();
    expect(routes[1].primary).toBeUndefined();
    expect(mocks.detect).not.toHaveBeenCalled();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it("opens the trip form with Inspect already on, and asks about Immich once", async () => {
    render(<Host />);

    fireEvent.click(screen.getByText("tripBuilder:chooser.action"));

    expect(screen.getByRole("switch", { name: "tripBuilder:popup.inspect.label" })).toBeChecked();
    expect(screen.getByText("tripBuilder:popup.scan")).toBeTruthy();
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledTimes(1));
    await settled();
  });

  it("goes back to the chooser when the form is cancelled", async () => {
    render(<Host />);
    fireEvent.click(screen.getByText("tripBuilder:chooser.action"));
    await settled();

    fireEvent.click(screen.getByText("trips:modal.cancel"));

    expect(screen.queryByText("trips:modal.cancel")).toBeNull();
    expect(screen.getByText("tripBuilder:chooser.action")).toBeTruthy();
  });
});
