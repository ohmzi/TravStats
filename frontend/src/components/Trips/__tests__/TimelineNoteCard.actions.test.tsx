import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TripNotesNotice } from "../TimelineNoteCard";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

describe("TripNotesNotice", () => {
  it("ends its retry button at the right of the message and wires it", async () => {
    const onRetry = vi.fn();
    render(<TripNotesNotice failed truncated={false} onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    // Actions live on the right (owner, 2026-10-15); the message takes the rest.
    expect(alert.className).toContain("justify-between");
    expect(screen.getByText("trips:detail.timeline.note.loadFailed").className).toContain("flex-1");

    await userEvent.click(screen.getByRole("button", { name: "trips:detail.timeline.note.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
