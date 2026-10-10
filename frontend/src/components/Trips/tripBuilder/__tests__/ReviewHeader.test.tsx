import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { reviewDraft } from "../../../../lib/tripBuilder/__tests__/reviewFixtures";
import type { TripBuilderDraft } from "../../../../types/tripBuilder";
import ReviewHeader from "../ReviewHeader";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

function renderHeader(
  draft: TripBuilderDraft = reviewDraft(),
  props: Partial<Parameters<typeof ReviewHeader>[0]> = {}
) {
  const handlers = { onTripName: vi.fn(), onCountries: vi.fn(), onChangeDates: vi.fn() };
  render(
    <ReviewHeader
      draft={draft}
      tripName="Southern loop"
      countries={["NZ"]}
      unknownNights={0}
      carried={null}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("ReviewHeader for a new trip", () => {
  it("lets the name be changed", () => {
    const { onTripName } = renderHeader();
    const name = screen.getByLabelText("tripBuilder:review.header.name");
    expect(name).toHaveValue("Southern loop");
    fireEvent.change(name, { target: { value: "Autumn loop" } });
    expect(onTripName).toHaveBeenCalledWith("Autumn loop");
  });

  it("shows the dates the draft was scanned for", () => {
    renderHeader();
    expect(screen.getByText("02.05.2031 – 07.05.2031")).toBeInTheDocument();
  });

  it("shows the countries", () => {
    renderHeader();
    expect(screen.getByText("NZ")).toBeInTheDocument();
  });
});

describe("ReviewHeader for an existing trip", () => {
  const existing = reviewDraft({
    target: {
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      tripName: "Southern loop",
    },
  });

  it("names the trip it adds to and does not offer to rename it", () => {
    renderHeader(existing);
    expect(screen.getByText("Southern loop")).toBeInTheDocument();
    expect(screen.queryByLabelText("tripBuilder:review.header.name")).not.toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.header.existingTrip")).toBeInTheDocument();
  });
});

describe("ReviewHeader, the rest", () => {
  it("asks the page to open the dates dialog", () => {
    const { onChangeDates } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.header.changeDates" }));
    expect(onChangeDates).toHaveBeenCalledTimes(1);
  });

  it("says how many nights are still open, and nothing when none are", () => {
    renderHeader(reviewDraft(), { unknownNights: 2 });
    expect(
      screen.getByText('tripBuilder:review.header.unknownNights {"count":2}')
    ).toBeInTheDocument();
  });

  it("draws no open-nights pill when every night is answered", () => {
    renderHeader();
    expect(screen.queryByText(/unknownNights/)).not.toBeInTheDocument();
  });

  it("says how many edits a re-scan carried over", () => {
    renderHeader(reviewDraft(), { carried: { kept: 3, total: 4 } });
    expect(screen.getByRole("status")).toHaveTextContent(
      'tripBuilder:review.header.carried {"kept":3,"total":4}'
    );
  });

  it("passes the countries up", () => {
    const { onCountries } = renderHeader();
    fireEvent.click(
      screen.getByRole("button", { name: 'tripBuilder:review.header.removeCountry {"code":"NZ"}' })
    );
    expect(onCountries).toHaveBeenCalledWith([]);
  });
});
