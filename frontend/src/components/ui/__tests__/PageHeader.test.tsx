import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import PageHeader from "../PageHeader";

describe("PageHeader", () => {
  it("puts the title left and the page's actions at the right of its line", () => {
    render(<PageHeader title="Alpen 2026" actions={<button type="button">Edit</button>} />);
    const title = screen.getByRole("heading", { level: 1, name: "Alpen 2026" });
    const row = title.parentElement!.parentElement as HTMLElement;
    expect(row.className).toContain("justify-between");

    const actions = screen.getByRole("button", { name: "Edit" }).parentElement as HTMLElement;
    // `ml-auto` + `justify-end`, not only the row's `justify-between`: a long
    // title ("Skandinavien Sommer 2026") wraps the actions onto a line of their
    // own at iPad portrait, and with `space-between` alone that line's single
    // item lands at the LEFT edge (forgejo round of 2026-10-15). SectionHeader
    // carries the same pair for the same wrap case.
    expect(actions.className).toContain("ml-auto");
    expect(actions.className).toContain("justify-end");
  });

  it("draws no action slot when the page has none", () => {
    const { container } = render(<PageHeader title="Tours" />);
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});
