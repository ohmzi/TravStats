import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import EntityTabBar from "../EntityTabBar";

/**
 * The shared strip both detail pages draw (the journey's and the trip's):
 * text tabs on the accent underline, the logbook's furniture. It is a strip
 * with no opinion — the gate that hides a tab (the roadtrips beta key) lives
 * on the page that builds the list, so a tab handed in here is a tab shown.
 */
const TABS = ["overview", "timeline", "map"] as const;

describe("EntityTabBar", () => {
  it("draws one tab per key, with the open one marked", () => {
    render(
      <EntityTabBar tabs={TABS} tab="timeline" onChange={() => undefined} label={(key) => key} />
    );

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "timeline" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "overview" })).toHaveAttribute("aria-selected", "false");
  });

  it("hands the clicked key to the page, which owns the URL", async () => {
    const onChange = vi.fn();
    render(<EntityTabBar tabs={TABS} tab="overview" onChange={onChange} label={(key) => key} />);

    await userEvent.click(screen.getByRole("tab", { name: "map" }));

    expect(onChange).toHaveBeenCalledWith("map");
  });
});
