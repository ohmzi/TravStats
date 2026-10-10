import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { initialReviewState, type DraftEdit } from "../../../../lib/tripBuilder/draftEdits";
import { existingDraft } from "../../../../lib/tripBuilder/__tests__/existingFixture";
import type { AlbumSyncPreview, TripBuilderDraft } from "../../../../types/tripBuilder";
import AlbumSyncPanel from "../AlbumSyncPanel";
import { ExistingDiffProvider } from "../ExistingDiffContext";

function withSync(sync: AlbumSyncPreview): TripBuilderDraft {
  const draft = existingDraft();
  return { ...draft, album: { ...draft.album!, sync } };
}

function renderPanel(draft: TripBuilderDraft, onEdit: (edit: DraftEdit) => void = vi.fn()) {
  return render(
    <ExistingDiffProvider draft={draft} state={initialReviewState(draft)} onEdit={onEdit}>
      <AlbumSyncPanel />
    </ExistingDiffProvider>
  );
}

describe("AlbumSyncPanel", () => {
  it("says which album it updates and how many photos it adds", () => {
    renderPanel(existingDraft());
    expect(screen.getByText("tripBuilder:existing.album.target.linked")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:existing.album.adds")).toBeInTheDocument();
  });

  it("offers removal on when TravStats created the album, and says so", () => {
    renderPanel(existingDraft());
    const toggle = screen.getByRole("switch") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(screen.getByText("tripBuilder:existing.album.removeOutside")).toBeInTheDocument();
    expect(
      screen.getByText("tripBuilder:existing.album.reasonCreatedByTravstats")
    ).toBeInTheDocument();
  });

  it("starts removal off on an album TravStats did not write, and says why", () => {
    renderPanel(
      withSync({
        target: "byName",
        toAdd: 1,
        alreadyIn: 5,
        removable: { count: 2, defaultOn: false, allowed: true },
      })
    );
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("tripBuilder:existing.album.reasonForeign")).toBeInTheDocument();
  });

  it("disables removal when the key lacks the scope, and names it", () => {
    renderPanel(
      withSync({
        target: "linked",
        toAdd: 0,
        alreadyIn: 5,
        removable: { count: 2, defaultOn: true, allowed: false, missingScope: "albumAsset.delete" },
      })
    );
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("tripBuilder:existing.album.needsScope")).toBeInTheDocument();
  });

  it("sends the switch as an edit", () => {
    const onEdit = vi.fn();
    renderPanel(existingDraft(), onEdit);
    fireEvent.click(screen.getByRole("switch"));
    expect(onEdit).toHaveBeenCalledWith({ type: "setRemoveOutside", remove: false });
  });

  it("draws no switch when nothing lies outside the dates", () => {
    renderPanel(
      withSync({
        target: "linked",
        toAdd: 3,
        alreadyIn: 5,
        removable: { count: 0, defaultOn: true, allowed: true },
      })
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("draws nothing for a new trip", () => {
    const { container } = render(<AlbumSyncPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
