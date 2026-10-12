import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import EntityPage from "../EntityPage";
import type { Trip } from "../../../types";
import type { RoadtripDetail } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

// Synthetic fixtures only (public repository).

function journey(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    name: "Eastport loop",
    countries: [],
    startDate: null,
    endDate: null,
    immichAlbums: [],
    ...over,
  } as unknown as Trip;
}

/** The roadtrip half, narrowed to the fields the band reads. */
interface RoadtripFixture {
  name?: string;
  drivenKm?: number;
  distanceKm?: number;
  startOdometerKm?: number | null;
  endOdometerKm?: number | null;
}

type TripFixture = Omit<Partial<RoadtripDetail>, "roadtrip"> & { roadtrip?: RoadtripFixture };

function trip(over: TripFixture = {}): RoadtripDetail {
  return {
    countries: [],
    trip: null,
    startDate: null,
    endDate: null,
    nights: { nights: 1, stayNights: 0, freeNights: 1, placesSlept: 1, nightsKnown: true },
    stations: [],
    legs: [],
    tours: [],
    routingAvailable: true,
    expenses: [],
    costs: {},
    ...over,
    roadtrip: {
      name: "Northvale loop",
      drivenKm: 0,
      distanceKm: 0,
      startOdometerKm: null,
      endOdometerKm: null,
      ...over.roadtrip,
    },
  } as unknown as RoadtripDetail;
}

/** True when `a` comes before `b` in the document (design §2's order). */
function before(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("the shared page shell (design §2)", () => {
  it("draws head, figures, tab bar and body in that order", () => {
    render(
      <MemoryRouter>
        <EntityPage
          level="journey"
          trip={journey({ startDate: "2031-05-02", endDate: "2031-05-07" })}
          roadtrips={[{ drivenKm: 812 }]}
          flights={[]}
          header={<h1>Eastport loop</h1>}
          tabBar={<div role="tablist">die Tabs</div>}
        >
          <p>der offene Tab</p>
        </EntityPage>
      </MemoryRouter>
    );
    const head = screen.getByRole("heading", { level: 1, name: "Eastport loop" });
    const figures = screen.getByText("Zeitraum");
    const tabs = screen.getByRole("tablist");
    const body = screen.getByText("der offene Tab");
    expect(before(head, figures)).toBe(true);
    expect(before(figures, tabs)).toBe(true);
    expect(before(tabs, body)).toBe(true);
  });

  it("draws the level's own figures — the trip's, not the journey's", () => {
    render(
      <MemoryRouter>
        <EntityPage
          level="trip"
          detail={trip({
            startDate: "2031-05-02T00:00:00.000Z",
            endDate: "2031-05-04T00:00:00.000Z",
          })}
          today="2031-05-03"
          header={<h1>Northvale loop</h1>}
        >
          <p>der offene Tab</p>
        </EntityPage>
      </MemoryRouter>
    );
    expect(screen.getByText("Strecke")).toBeInTheDocument();
    expect(screen.queryByText("Gefahrene km")).not.toBeInTheDocument();
  });

  it("draws no tab bar region for a level that passes none", () => {
    render(
      <MemoryRouter>
        <EntityPage
          level="journey"
          trip={journey()}
          roadtrips={[]}
          flights={[]}
          header={<h1>Eastport</h1>}
        >
          <p>der offene Tab</p>
        </EntityPage>
      </MemoryRouter>
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("der offene Tab")).toBeInTheDocument();
  });
});
