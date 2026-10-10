import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { CommitResult } from "../../../../types/tripBuilder";
import ExistingSuccessSummary from "../ExistingSuccessSummary";

const result = (over: Partial<CommitResult> = {}): CommitResult => ({
  tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  created: false,
  roadtrips: [
    {
      id: "r1",
      name: "Northvale loop",
      stations: 5,
      nights: 6,
      diff: { updated: 1, unchanged: 2, added: 1, removed: 0, kept: 1 },
    },
  ],
  stopIds: [],
  flightsAssigned: 0,
  flightsMovedFrom: [],
  routing: { routed: 2, straight: 0, ferry: 0, providerAvailable: true },
  photoJourneysResolved: 0,
  unknownNights: 0,
  stops: { updated: 1, unchanged: 0, added: 0, removed: 1, kept: 0 },
  album: { status: "linked", added: 4, alreadyIn: 36, removed: 3 },
  ...over,
});

describe("ExistingSuccessSummary", () => {
  it("draws nothing for a trip that was just created", () => {
    const { container } = render(<ExistingSuccessSummary result={result({ created: true })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing for a re-sync that touched no roadtrip, stop or album", () => {
    const { container } = render(
      <ExistingSuccessSummary
        result={result({
          roadtrips: [],
          stops: undefined,
          album: { status: "skipped", skipReason: "notRequested" },
        })}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("gives each roadtrip's counts, the stops' counts and the album's", () => {
    render(<ExistingSuccessSummary result={result()} />);
    expect(screen.getByText("tripBuilder:existing.success.roadtrip")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:existing.success.stops")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:existing.success.album")).toBeInTheDocument();
  });

  it("leaves out the stops line when the trip has none to report", () => {
    render(<ExistingSuccessSummary result={result({ stops: undefined })} />);
    expect(screen.queryByText("tripBuilder:existing.success.stops")).not.toBeInTheDocument();
  });

  it("says when photos outside the dates stayed in the album and why", () => {
    render(
      <ExistingSuccessSummary
        result={result({
          album: {
            status: "linked",
            added: 0,
            alreadyIn: 40,
            removed: 0,
            removeSkipped: "missingScope",
          },
        })}
      />
    );
    expect(
      screen.getByText("tripBuilder:existing.success.removeSkipped.missingScope")
    ).toBeInTheDocument();
  });

  it("says nothing about the album when there was none", () => {
    render(
      <ExistingSuccessSummary
        result={result({ album: { status: "skipped", skipReason: "notRequested" } })}
      />
    );
    expect(screen.queryByText("tripBuilder:existing.success.album")).not.toBeInTheDocument();
  });
});
