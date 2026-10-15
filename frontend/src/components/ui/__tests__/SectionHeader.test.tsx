import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import SectionHeader from "../SectionHeader";

describe("SectionHeader", () => {
  it("puts the title left and the actions on the same line at the right", () => {
    render(<SectionHeader title="Recordings" actions={<button type="button">Add</button>} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Recordings" });
    const row = heading.parentElement as HTMLElement;
    expect(row.className).toContain("justify-between");
    const actions = screen.getByRole("button", { name: "Add" }).parentElement as HTMLElement;
    expect(actions.className).toContain("ml-auto");
  });

  it("draws no empty action slot", () => {
    const { container } = render(<SectionHeader title="Dates" />);
    // The row holds the heading only.
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});
