import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DraftFlight } from "../../../../types/tripBuilder";
import ReviewFlightRows from "../ReviewFlightRows";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

// Synthetic fixtures only (public repository): invented places, shifted years.
const OUT: DraftFlight = {
  id: "f1",
  label: "ZZ101 ZNV→ZSB",
  depIata: "ZNV",
  arrIata: "ZSB",
  depLocal: "2031-05-04 09:10",
  arrLocal: "2031-05-04 11:40",
  precise: true,
  currentTrip: null,
  defaultAssign: true,
  locked: false,
};
const ELSEWHERE: DraftFlight = {
  ...OUT,
  id: "f2",
  label: "ZZ202 ZSB→ZNV",
  depLocal: "2031-05-07",
  arrLocal: "2031-05-07",
  precise: false,
  currentTrip: { id: "t9", name: "Kelmore weekend" },
  defaultAssign: false,
};

describe("ReviewFlightRows", () => {
  it("draws nothing when the scan lists no flight", () => {
    const { container } = render(<ReviewFlightRows flights={[]} ticks={{}} onTick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each flight with its times and whether it is ticked", () => {
    render(
      <ReviewFlightRows
        flights={[OUT, ELSEWHERE]}
        ticks={{ f1: true, f2: false }}
        onTick={vi.fn()}
      />
    );
    const [first, second] = screen.getAllByRole("switch");
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
    expect(screen.getByText("04.05.2031 09:10 → 04.05.2031 11:40")).toBeInTheDocument();
    expect(screen.getByText("07.05.2031 → 07.05.2031")).toBeInTheDocument();
  });

  it("says a flight on another trip is, and that its times are approximate", () => {
    render(<ReviewFlightRows flights={[ELSEWHERE]} ticks={{ f2: false }} onTick={vi.fn()} />);
    expect(
      screen.getByText('tripBuilder:review.flights.currentTrip {"trip":"Kelmore weekend"}')
    ).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.flights.approximate")).toBeInTheDocument();
  });

  it("ticks and unticks a flight", () => {
    const onTick = vi.fn();
    render(
      <ReviewFlightRows
        flights={[OUT, ELSEWHERE]}
        ticks={{ f1: true, f2: false }}
        onTick={onTick}
      />
    );
    const [first, second] = screen.getAllByRole("switch");
    fireEvent.click(second);
    fireEvent.click(first);
    expect(onTick).toHaveBeenNthCalledWith(1, "f2", true);
    expect(onTick).toHaveBeenNthCalledWith(2, "f1", false);
  });

  it("keeps a flight that is already on the trip ticked and cannot be unticked", () => {
    render(<ReviewFlightRows flights={[{ ...OUT, locked: true }]} ticks={{}} onTick={vi.fn()} />);
    const only = screen.getByRole("switch");
    expect(only).toBeChecked();
    expect(only).toBeDisabled();
    expect(screen.getByText("tripBuilder:review.flights.locked")).toBeInTheDocument();
  });

  it("mentions the photos taken during a layover", () => {
    const layover = { ...OUT, layover: { photoCount: 4, airportIata: "ZSB" } };
    render(<ReviewFlightRows flights={[layover]} ticks={{ f1: true }} onTick={vi.fn()} />);
    expect(
      screen.getByText('tripBuilder:review.flights.layover {"count":4,"airport":"ZSB"}')
    ).toBeInTheDocument();
  });
});
