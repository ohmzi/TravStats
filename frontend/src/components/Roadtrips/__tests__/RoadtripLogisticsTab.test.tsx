import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import RoadtripLogisticsTab from "../RoadtripLogisticsTab";
import type { RoadtripDetail } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

// Each section fetches and renders its own furniture; the three have their
// own suites. This one owns the tab's composition: which sections it holds
// and what it hands them from the detail.
vi.mock("../RoadtripTourCards", () => ({
  default: ({ tours }: { tours: { name: string }[] }) => (
    <div data-testid="day-tours">{tours.map((tour) => tour.name).join(",")}</div>
  ),
}));
vi.mock("../RoadtripCostsSection", () => ({
  default: ({
    roadtripId,
    costs,
  }: {
    roadtripId: string;
    costs: { total: Record<string, number> };
  }) => (
    <div data-testid="costs">
      {roadtripId}|{JSON.stringify(costs.total)}
    </div>
  ),
}));
vi.mock("../../rail/RoadtripRailConversion", () => ({
  RoadtripRailConversion: ({ routeId }: { routeId: string }) => (
    <div data-testid="rail-conversion">{routeId}</div>
  ),
}));

const DETAIL: RoadtripDetail = {
  roadtrip: { id: "rt1", name: "Fjorde 2026", vehicle: "campervan" } as never,
  countries: [],
  trip: null,
  startDate: null,
  endDate: null,
  nights: { stayNights: 0, freeNights: 0, nights: 0, nightsKnown: true, placesSlept: 0 },
  stations: [],
  legs: [],
  tours: [{ id: "t1", name: "Ridge walk" } as never],
  routingAvailable: true,
  expenses: [],
  costs: { total: { NOK: 1200 }, byStation: [], byLeg: [], unpinned: {} },
};

describe("RoadtripLogisticsTab", () => {
  it("holds the day tours, the rail conversion and the costs of THIS roadtrip", () => {
    render(<RoadtripLogisticsTab detail={DETAIL} onChanged={vi.fn()} />);

    expect(screen.getByText("roadtrips:detail.toursTitle")).toBeInTheDocument();
    expect(screen.getByTestId("day-tours")).toHaveTextContent("Ridge walk");
    expect(screen.getByTestId("rail-conversion")).toHaveTextContent("rt1");
    expect(screen.getByTestId("costs")).toHaveTextContent('rt1|{"NOK":1200}');
  });
});
