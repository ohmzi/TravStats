import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ReviewPhotoJourneys from "../ReviewPhotoJourneys";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const JOURNEYS = [
  { id: "j1", startDay: "2031-05-03", endDay: "2031-05-04", defaultTick: true as const },
  { id: "j2", startDay: "2031-05-06", endDay: "2031-05-07", defaultTick: true as const },
];

describe("ReviewPhotoJourneys", () => {
  it("draws nothing without a suggestion that covers the dates", () => {
    const { container } = render(<ReviewPhotoJourneys journeys={[]} ticks={{}} onTick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each suggestion by its dates, ticked as the review has it", () => {
    render(
      <ReviewPhotoJourneys journeys={JOURNEYS} ticks={{ j1: true, j2: false }} onTick={vi.fn()} />
    );
    const [first, second] = screen.getAllByRole("switch");
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
    expect(
      screen.getByText('tripBuilder:review.journeys.item {"start":"03.05.2031","end":"04.05.2031"}')
    ).toBeInTheDocument();
  });

  it("ticks and unticks a suggestion", () => {
    const onTick = vi.fn();
    render(
      <ReviewPhotoJourneys journeys={JOURNEYS} ticks={{ j1: true, j2: false }} onTick={onTick} />
    );
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onTick).toHaveBeenCalledWith("j1", false);
  });
});
