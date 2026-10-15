import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { dayAsTimeValue } from "../../../lib/tripTimeline";
import { JournalCard, RowActions } from "../TimelineJournalCard";
import type { TripJournalEntry } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const entry: TripJournalEntry = {
  id: "e1",
  tripId: "t1",
  date: "2024-07-15T00:00:00.000Z",
  title: "Tram 28",
  body: "Up the hill.",
  mood: null,
  weather: null,
  photos: [],
  createdAt: "",
  updatedAt: "",
};

/**
 * Edit and delete became icons (owner, 2026-10-15), so their visible text is an
 * `aria-label` now. A swapped handler would pass every layout check, which is
 * why the wiring is pinned here.
 */
describe("JournalCard actions", () => {
  const renderCard = () => {
    const handlers = { onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
    render(
      <JournalCard
        ev={
          {
            id: "j-e1",
            kind: "journal",
            date: entry.date,
            when: dayAsTimeValue({ date: "2024-07-15", zone: null, precision: "day" }),
            entry,
          } as never
        }
        language="de"
        {...handlers}
      />
    );
    return handlers;
  };

  it("the opened card's edit icon edits and its delete icon deletes", async () => {
    const { onEdit, onDelete, onView } = renderCard();
    await userEvent.click(screen.getByText("Tram 28"));

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onView).not.toHaveBeenCalled();
  });

  it("the opened card's text button opens the whole journal entry", async () => {
    const { onView, onEdit } = renderCard();
    await userEvent.click(screen.getByText("Tram 28"));

    await userEvent.click(
      screen.getByRole("button", { name: "trips:detail.timeline.openJournal" })
    );
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("RowActions (the strip TripDetailPage imports)", () => {
  it("wires view, edit and delete to their own handlers", async () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<RowActions onView={onView} onEdit={onEdit} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "common:accessibility.view" }));
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.edit" }));
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("draws no view icon when it has no view handler", () => {
    render(<RowActions onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "common:accessibility.view" })
    ).not.toBeInTheDocument();
  });
});
