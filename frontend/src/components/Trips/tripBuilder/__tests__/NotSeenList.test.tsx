import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { initialReviewState, type DraftEdit } from "../../../../lib/tripBuilder/draftEdits";
import { existingDraft } from "../../../../lib/tripBuilder/__tests__/existingFixture";
import { ExistingDiffProvider, useExistingDiff } from "../ExistingDiffContext";
import NotSeenList from "../NotSeenList";
import ShowUnchangedToggle from "../ShowUnchangedToggle";

function Hidden(): JSX.Element {
  const diff = useExistingDiff();
  const station = existingDraft().areas[0].stations[0];
  return <span data-testid="hidden">{String(diff.infoFor(station).hidden)}</span>;
}

function renderWith(ui: JSX.Element, onEdit: (edit: DraftEdit) => void = vi.fn()) {
  const draft = existingDraft();
  return render(
    <ExistingDiffProvider draft={draft} state={initialReviewState(draft)} onEdit={onEdit}>
      {ui}
    </ExistingDiffProvider>
  );
}

describe("NotSeenList", () => {
  it("lists the stored stations the photos do not show, each with its reason and its default", () => {
    renderWith(<NotSeenList areaKey="2031-05-02#1" />);
    expect(screen.getByText("tripBuilder:existing.notSeen.title")).toBeInTheDocument();
    expect(screen.getByText("Kelmore")).toBeInTheDocument();
    expect(screen.getByText("Tarnside")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:existing.notSeen.reasonNotInPhotos")).toBeInTheDocument();
    expect(
      screen.getByText("tripBuilder:existing.notSeen.reasonOutsideWindow")
    ).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches.map((s) => (s as HTMLInputElement).checked)).toEqual([true, false]);
  });

  it("sends the user's decision as an edit", () => {
    const onEdit = vi.fn();
    renderWith(<NotSeenList areaKey="2031-05-02#1" />, onEdit);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onEdit).toHaveBeenCalledWith({
      type: "setKeepNotSeen",
      existingId: "st-c",
      keep: false,
    });
  });

  it("lists the timeline stops the photos do not show under their own heading", () => {
    renderWith(<NotSeenList areaKey={null} />);
    expect(screen.getByText("tripBuilder:existing.notSeenStops.title")).toBeInTheDocument();
    expect(screen.getByText("Port Carrow Harbour")).toBeInTheDocument();
  });

  it("draws nothing for an area with nothing unseen, or without a provider", () => {
    const { container } = renderWith(<NotSeenList areaKey="no-such-area" />);
    expect(container).toBeEmptyDOMElement();
    const bare = render(<NotSeenList areaKey="2031-05-02#1" />);
    expect(bare.container).toBeEmptyDOMElement();
  });
});

describe("ShowUnchangedToggle", () => {
  it("collapses and expands the unchanged rows, and counts them", () => {
    renderWith(
      <>
        <ShowUnchangedToggle />
        <Hidden />
      </>
    );
    expect(screen.getByTestId("hidden")).toHaveTextContent("true");
    expect(screen.getByText("tripBuilder:existing.showUnchanged")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByTestId("hidden")).toHaveTextContent("false");
  });

  it("is not drawn for a new trip", () => {
    const { container } = render(<ShowUnchangedToggle />);
    expect(container).toBeEmptyDOMElement();
  });
});
