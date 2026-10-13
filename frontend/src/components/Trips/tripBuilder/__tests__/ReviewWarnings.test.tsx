import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { BuilderWarning } from "../../../../types/tripBuilder";
import ReviewWarnings from "../ReviewWarnings";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-07" };

function renderWarnings(warnings: BuilderWarning[], onExtend = vi.fn()) {
  render(<ReviewWarnings warnings={warnings} window={WINDOW} onExtend={onExtend} />);
  return onExtend;
}

describe("ReviewWarnings", () => {
  it("draws nothing without a warning, nor for the two that are said elsewhere", () => {
    const { container } = render(
      <ReviewWarnings
        warnings={[
          {
            code: "emptyWindow",
            params: {
              checkedFrom: "2031-04-29",
              checkedTo: "2031-05-10",
              partner: 0,
              trashedNote: false,
            },
          },
          { code: "albumLinkedElsewhere", params: { tripName: "Kelmore weekend" } },
        ]}
        window={WINDOW}
        onExtend={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says each warning with the facts it carries, days in the user's format", () => {
    renderWarnings([
      {
        code: "possibleUnrecordedFlight",
        params: {
          fromDay: "2031-05-03",
          toDay: "2031-05-04",
          nearestAirports: { from: "ZNV", to: null },
        },
      },
      { code: "noRoadData", params: { stations: ["a", "b"] } },
      { code: "photosFarFromStay", params: { count: 3 } },
      { code: "pendingPhotoJourneys", params: { ids: ["j1"] } },
      {
        code: "overlappingTrip",
        params: {
          name: "Kelmore weekend",
          startDay: "2031-05-01",
          endDay: "2031-05-03",
          suspiciouslyLong: false,
        },
      },
    ]);
    expect(
      screen.getByText(
        'tripBuilder:warnings.possibleUnrecordedFlight {"from":"03.05.2031","to":"04.05.2031","fromAirport":"ZNV","toAirport":"?"}'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('tripBuilder:warnings.noRoadData {"count":2}')).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:warnings.photosFarFromStay {"count":3}')
    ).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:warnings.pendingPhotoJourneys {"count":1}')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'tripBuilder:warnings.overlappingTrip {"name":"Kelmore weekend","start":"01.05.2031","end":"03.05.2031"}'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("tripBuilder:warnings.suspiciouslyLong")).not.toBeInTheDocument();
  });

  it("says how many entries the commit's caps left out of the flights, areas and findings", () => {
    renderWarnings([
      { code: "truncatedFlights", params: { count: 10 } },
      { code: "truncatedAreas", params: { count: 2 } },
      { code: "truncatedJourneys", params: { count: 5 } },
    ]);
    expect(
      screen.getByText('tripBuilder:warnings.truncatedFlights {"count":10}')
    ).toBeInTheDocument();
    expect(screen.getByText('tripBuilder:warnings.truncatedAreas {"count":2}')).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:warnings.truncatedJourneys {"count":5}')
    ).toBeInTheDocument();
  });

  it("adds a line for an overlapping trip that runs suspiciously long", () => {
    renderWarnings([
      {
        code: "overlappingTrip",
        params: {
          name: "Kelmore weekend",
          startDay: "2031-05-01",
          endDay: "2032-05-03",
          suspiciouslyLong: true,
        },
      },
    ]);
    expect(screen.getByText("tripBuilder:warnings.suspiciouslyLong")).toBeInTheDocument();
  });

  it("offers to start the trip earlier or end it later for a flight just outside the dates", () => {
    const onExtend = renderWarnings([
      {
        code: "flightOutsideDates",
        params: { flightId: "f1", suggestStartDay: "2031-05-01", suggestEndDay: "2031-05-08" },
      },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: 'tripBuilder:warnings.extendStart {"day":"01.05.2031"}' })
    );
    fireEvent.click(
      screen.getByRole("button", { name: 'tripBuilder:warnings.extendEnd {"day":"08.05.2031"}' })
    );
    expect(onExtend).toHaveBeenNthCalledWith(1, { startDay: "2031-05-01" });
    expect(onExtend).toHaveBeenNthCalledWith(2, { endDay: "2031-05-08" });
  });

  it("offers to take in the day photos from home were found on, on the side they lie", () => {
    const before = renderWarnings([
      { code: "movementOutsideDates", params: { day: "2031-05-01", km: 212.4 } },
    ]);
    expect(
      screen.getByText('tripBuilder:warnings.movementOutsideDates {"day":"01.05.2031","km":212}')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /extendStart/ }));
    expect(before).toHaveBeenCalledWith({ startDay: "2031-05-01" });
  });

  it("offers the end side for a day after the window, and nothing for a day inside it", () => {
    const after = renderWarnings([
      { code: "movementOutsideDates", params: { day: "2031-05-09", km: 80 } },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /extendEnd/ }));
    expect(after).toHaveBeenCalledWith({ endDay: "2031-05-09" });
  });

  it("offers no chip for photos from home on a day the window already covers", () => {
    renderWarnings([{ code: "movementOutsideDates", params: { day: "2031-05-04", km: 40 } }]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers no chip for a warning that has no other window to offer", () => {
    renderWarnings([{ code: "truncated", params: {} }]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
