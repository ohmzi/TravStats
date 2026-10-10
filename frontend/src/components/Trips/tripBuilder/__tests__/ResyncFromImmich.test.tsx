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
});
