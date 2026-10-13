import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ExcludedCounts } from "../../../../types/tripBuilder";
import ReviewExcluded from "../ReviewExcluded";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const NONE: ExcludedCounts = {
  partner: 0,
  hiddenLivePart: 0,
  misdated: 0,
  inFlight: 0,
  atSea: 0,
  unlocated: 0,
  locationCarried: 0,
  dayGuessed: 0,
  otherTrip: 0,
};

describe("ReviewExcluded", () => {
  it("draws nothing when nothing was left out", () => {
    const { container } = render(<ReviewExcluded excluded={NONE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each reason with its count, in a fixed order, and skips the ones at zero", () => {
    render(<ReviewExcluded excluded={{ ...NONE, unlocated: 2, partner: 5, inFlight: 3 }} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      'tripBuilder:review.excluded.partner {"count":5}',
      'tripBuilder:review.excluded.inFlight {"count":3}',
      'tripBuilder:review.excluded.unlocated {"count":2}',
    ]);
  });

  it("says how many photos stand on another trip of this journey", () => {
    // Route-scoped only (owner request 2026-10-12): the scan left these photos
    // out of the route because they stand on another trip; the count keeps the
    // "photos considered" figures coherent.
    render(<ReviewExcluded excluded={{ ...NONE, otherTrip: 4 }} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      'tripBuilder:review.excluded.otherTrip {"count":4}',
    ]);
  });

  it("says how many photos took the last located photo's place", () => {
    render(<ReviewExcluded excluded={{ ...NONE, unlocated: 1, locationCarried: 4 }} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      'tripBuilder:review.excluded.unlocated {"count":1}',
      'tripBuilder:review.excluded.locationCarried {"count":4}',
    ]);
  });
});
