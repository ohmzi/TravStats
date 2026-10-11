import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ActionLink from "../ActionLink";

/**
 * The outline link is a button in everything but its element, so it must draw
 * the SAME metrics as the secondary button it sits beside (owner, 2026-10-11:
 * "all these should be same size"). jsdom cannot measure layout, so the
 * shared recipe is pinned here as tokens — the detail pages pair this link
 * with a primary button and the row has to read as one size.
 */
describe("ActionLink", () => {
  it("draws the shared secondary metrics, not a recipe of its own", () => {
    render(
      <MemoryRouter>
        <ActionLink to="/trips/t1">Open trip</ActionLink>
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "Open trip" });
    expect(link.style.height).toBe("var(--ts-size-button-secondary)");
    expect(link.style.padding).toBe("0 var(--ts-space-xl)");
    expect(link.style.borderRadius).toBe("var(--ts-radius-button)");
    expect(link.style.fontSize).toBe("16px");
    expect(link.style.fontWeight).toBe("700");
    expect(link.style.fontFamily).toBe("var(--ts-font-ui)");
    // The class is what carries the hover/active states of the shared button
    // shell onto the link.
    expect(link).toHaveClass("ts-button");
    expect(link).toHaveAttribute("data-variant", "secondary");
  });
});
