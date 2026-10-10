import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import {
  applyEdit,
  initialReviewState,
  type DraftEdit,
} from "../../../../lib/tripBuilder/draftEdits";
import { existingDraft, KEY } from "../../../../lib/tripBuilder/__tests__/existingFixture";
import { ExistingDiffProvider, useExistingDiff } from "../ExistingDiffContext";

function Probe({ stationKey }: { stationKey: string }): JSX.Element {
  const diff = useExistingDiff();
  const draft = existingDraft();
  const station = draft.areas[0].stations.find((s) => s.key === stationKey)!;
  const info = diff.infoFor(station);
  return (
    <div>
      <span data-testid="active">{String(diff.active)}</span>
      <span data-testid="status">{String(info.status)}</span>
      <span data-testid="hidden">{String(info.hidden)}</span>
      <span data-testid="unchanged">{diff.unchangedCount}</span>
      <span data-testid="kept">{String(diff.isKept("st-d"))}</span>
      <span data-testid="notSeen">{diff.notSeenOf("2031-05-02#1").length}</span>
      <span data-testid="stops">{diff.notSeenOf(null).length}</span>
      <span data-testid="album">{String(diff.albumSync?.removeOutside)}</span>
      <button onClick={() => diff.setShowUnchanged(!diff.showUnchanged)}>toggle</button>
      <button onClick={() => diff.setKept("st-d", true)}>keep</button>
      <button onClick={() => diff.albumSync?.setRemoveOutside(false)}>album</button>
    </div>
  );
}

function renderProbe(stationKey: string, onEdit: (edit: DraftEdit) => void = vi.fn()) {
  const draft = existingDraft();
  const state = initialReviewState(draft);
  return render(
    <ExistingDiffProvider draft={draft} state={state} onEdit={onEdit}>
      <Probe stationKey={stationKey} />
    </ExistingDiffProvider>
  );
}

describe("useExistingDiff", () => {
  it("is inactive without a provider, so a new trip's rows are untouched", () => {
    render(<Probe stationKey={KEY.northvale} />);
    expect(screen.getByTestId("active")).toHaveTextContent("false");
    expect(screen.getByTestId("hidden")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("null");
  });

  it("hides unchanged rows by default when something changed, and shows them on request", () => {
    renderProbe(KEY.northvale);
    expect(screen.getByTestId("status")).toHaveTextContent("same");
    expect(screen.getByTestId("hidden")).toHaveTextContent("true");
    expect(screen.getByTestId("unchanged")).toHaveTextContent("1");
    act(() => screen.getByText("toggle").click());
    expect(screen.getByTestId("hidden")).toHaveTextContent("false");
  });

  it("never hides a changed or new row", () => {
    renderProbe(KEY.portCarrow);
    expect(screen.getByTestId("status")).toHaveTextContent("changed");
    expect(screen.getByTestId("hidden")).toHaveTextContent("false");
  });

  it("shows every row when nothing changed at all", () => {
    const draft = existingDraft();
    const quiet = {
      ...draft,
      areas: [
        {
          ...draft.areas[0],
          notSeen: [],
          stations: [draft.areas[0].stations[0]],
        },
      ],
      notSeenStops: [],
    };
    render(
      <ExistingDiffProvider draft={quiet} state={initialReviewState(quiet)} onEdit={vi.fn()}>
        <Probe stationKey={KEY.northvale} />
      </ExistingDiffProvider>
    );
    expect(screen.getByTestId("hidden")).toHaveTextContent("false");
  });

  it("follows an edit: a station whose night moved away is changed, not hidden", () => {
    const draft = existingDraft();
    const state = applyEdit(draft, initialReviewState(draft), {
      type: "assignNight",
      day: "2031-05-03",
      assign: KEY.portCarrow,
    });
    render(
      <ExistingDiffProvider draft={draft} state={state} onEdit={vi.fn()}>
        <Probe stationKey={KEY.northvale} />
      </ExistingDiffProvider>
    );
    expect(screen.getByTestId("status")).toHaveTextContent("changed");
    expect(screen.getByTestId("hidden")).toHaveTextContent("false");
  });

  it("serves the not-seen lists and the decisions, and sends decisions as edits", () => {
    const onEdit = vi.fn();
    renderProbe(KEY.northvale, onEdit);
    expect(screen.getByTestId("notSeen")).toHaveTextContent("2");
    expect(screen.getByTestId("stops")).toHaveTextContent("1");
    expect(screen.getByTestId("kept")).toHaveTextContent("false");
    act(() => screen.getByText("keep").click());
    expect(onEdit).toHaveBeenCalledWith({ type: "setKeepNotSeen", existingId: "st-d", keep: true });
    expect(screen.getByTestId("album")).toHaveTextContent("true");
    act(() => screen.getByText("album").click());
    expect(onEdit).toHaveBeenCalledWith({ type: "setRemoveOutside", remove: false });
  });
});
