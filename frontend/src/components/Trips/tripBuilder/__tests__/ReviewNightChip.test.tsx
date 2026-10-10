import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { NightChoice } from "../../../../lib/tripBuilder/reviewView";
import ReviewNightChip from "../ReviewNightChip";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const CHOICES: NightChoice[] = [
  { value: "-904|3388|2031-05-06", title: "Tarnside", suggested: true },
  { value: "-908|3382|2031-05-05", title: "Southbridge", suggested: false },
  { value: "home", title: null, suggested: false },
  { value: "unknown", title: null, suggested: false },
];

function renderChip(assign: string, onAssign = vi.fn()) {
  render(
    <ReviewNightChip day="2031-05-06" assign={assign} choices={CHOICES} onAssign={onAssign} />
  );
  return onAssign;
}

describe("ReviewNightChip", () => {
  it("offers the places, home and unknown, with the suggestion marked", () => {
    renderChip("-908|3382|2031-05-05");
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      'tripBuilder:review.night.suggested {"title":"Tarnside"}',
      "Southbridge",
      "tripBuilder:review.night.home",
      "tripBuilder:review.night.unknown",
    ]);
    expect(screen.getByRole("combobox")).toHaveValue("-908|3382|2031-05-05");
  });

  it("answers the night with the place picked", () => {
    const onAssign = renderChip("unknown");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "-904|3388|2031-05-06" } });
    expect(onAssign).toHaveBeenCalledWith("-904|3388|2031-05-06");
  });

  it("asks about a night nobody has answered", () => {
    renderChip("unknown");
    expect(screen.getByText("tripBuilder:review.night.unknownHint")).toBeInTheDocument();
  });

  it("does not ask about a night that was answered", () => {
    renderChip("home");
    expect(screen.queryByText("tripBuilder:review.night.unknownHint")).not.toBeInTheDocument();
  });

  it("states a night in the air and offers no choice for it", () => {
    renderChip("flight");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.night.flight {"date":"06.05.2031"}')
    ).toBeInTheDocument();
  });
});
