import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The roadtrip card is the SHARED map card — the same `PinnedCard` the flight
 * line answers with — carrying a `roadtrip` datum. Its one action is a real
 * link to the roadtrip's own page, read-only and middle-clickable, and its
 * wording follows the count the line carries: "last" only when more than one
 * roadtrip sits on the line, the plain wording otherwise (owner, 2026-10-09).
 *
 * It used to be a standalone overlay docked bottom-left of the map, which is
 * why the owner saw it in a corner instead of beside the line. Being a datum on
 * the shared card is what puts it where the renderer projects its anchor.
 *
 * The suite renders raw i18n keys (no resources are loaded), so the assertion
 * names the KEY. The German and English copy behind it is what
 * `i18n/__tests__/localeKeyParity.test.ts` holds.
 */
const get = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/roadtrips", () => ({ roadtripsApi: { get } }));

import { PinnedCard } from "../PinnedCard";
import type { MapPinned } from "../pinnedTypes";

const DETAIL = {
  roadtrip: { name: "Norwegen", drivenKm: 1200, stopCount: 4 },
  nights: { nights: 3 },
  countries: ["NO", "SE"],
};

function roadtripPinned(count = 1): MapPinned {
  return {
    kind: "roadtrip",
    anchorLngLat: [8, 58],
    data: { routeId: "rt", name: "Norwegen", count },
  };
}

async function renderCard(count = 1): Promise<void> {
  render(
    <MemoryRouter>
      <PinnedCard pinned={roadtripPinned(count)} flights={[]} cruises={[]} onClose={vi.fn()} />
    </MemoryRouter>
  );
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue(DETAIL);
});

describe("the roadtrip card in the shared PinnedCard", () => {
  it("links to the roadtrip's own page with the plain label for a single roadtrip", async () => {
    await renderCard();

    const link = await screen.findByRole("link", { name: "roadtrips:list.openDetails" });
    expect(link).toHaveAttribute("href", "/roadtrips/rt");
    expect(screen.queryByRole("link", { name: "roadtrips:list.lastRoadtrip" })).toBeNull();
  });

  it("says 'last' only when the line carries more than one roadtrip", async () => {
    await renderCard(2);

    const link = await screen.findByRole("link", { name: "roadtrips:list.lastRoadtrip" });
    expect(link).toHaveAttribute("href", "/roadtrips/rt");
    expect(screen.queryByRole("link", { name: "roadtrips:list.openDetails" })).toBeNull();
  });

  it("shows the fetched figures once they land", async () => {
    await renderCard();
    expect(await screen.findByText("1,200 km")).toBeInTheDocument();
    expect(screen.getByText("Norwegen")).toBeInTheDocument();
  });

  it("puts the way in up even when the figures failed — never a 0 for an unknown km", async () => {
    get.mockRejectedValue(new Error("offline"));
    await renderCard();

    // The action survives a failed fetch: the card still opens the roadtrip.
    expect(await screen.findByRole("link", { name: "roadtrips:list.openDetails" })).toHaveAttribute(
      "href",
      "/roadtrips/rt"
    );
    // …and the km is a dash with its reason, not "0 km".
    expect(screen.queryByText(/0 km/)).toBeNull();
    expect(screen.getByText("roadtrips:detailLoadError")).toBeInTheDocument();
  });
});
