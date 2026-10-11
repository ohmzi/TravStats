import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ResyncFromImmich from "../ResyncFromImmich";

describe("ResyncFromImmich", () => {
  it("links to the trip's re-sync", () => {
    render(
      <MemoryRouter>
        <ResyncFromImmich tripId="t1" />
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "tripBuilder:resync.action" });
    expect(link).toHaveAttribute("href", "/trips/t1/resync");
  });

  it("draws the same secondary metrics as the buttons beside it", () => {
    render(
      <MemoryRouter>
        <ResyncFromImmich tripId="t1" />
      </MemoryRouter>
    );
    // It sits between Edit and Delete on the trip page (both 46 high), so it
    // must be the SAME control, not a narrower copy (owner, 2026-10-11).
    const link = screen.getByRole("link", { name: "tripBuilder:resync.action" });
    expect(link.style.height).toBe("var(--ts-size-button-secondary)");
    expect(link.style.padding).toBe("0 var(--ts-space-xl)");
    expect(link.style.fontFamily).toBe("var(--ts-font-ui)");
    expect(link).toHaveClass("ts-button");
  });
});
