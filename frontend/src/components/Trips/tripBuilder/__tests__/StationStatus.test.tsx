import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import StationDiff from "../StationDiff";
import StationStatusPill from "../StationStatusPill";

describe("StationStatusPill", () => {
  it.each(["same", "changed", "new", "notSeen"] as const)("says %s in words", (status) => {
    render(<StationStatusPill status={status} />);
    expect(screen.getByText(`tripBuilder:existing.status.${status}`)).toBeInTheDocument();
  });
});

describe("StationDiff", () => {
  it("shows what was stored and what the photos give now, dates and nights", () => {
    const { container } = render(
      <StationDiff
        before={{ startDate: "2031-05-04", endDate: "2031-05-06", slept: false, stay: false }}
        facts={{ startDate: "2031-05-04", endDate: "2031-05-07", slept: true }}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("tripBuilder:existing.diff.was");
    expect(text).toContain("04.05.2031 – 06.05.2031");
    expect(text).toContain("04.05.2031 – 07.05.2031");
    expect(text).toContain("→");
    expect(screen.getByText("tripBuilder:existing.diff.noNights")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:existing.diff.nights")).toBeInTheDocument();
  });

  it("counts a stay as a slept night even where the photos say pass", () => {
    render(
      <StationDiff
        before={{ startDate: "2031-05-02", endDate: "2031-05-04", slept: true, stay: true }}
        facts={{ startDate: "2031-05-02", endDate: "2031-05-05", slept: false }}
      />
    );
    expect(screen.queryByText("tripBuilder:existing.diff.noNights")).not.toBeInTheDocument();
  });

  it("says undated for a stored station with no dates", () => {
    render(
      <StationDiff
        before={{ startDate: null, endDate: null, slept: false, stay: false }}
        facts={{ startDate: "2031-05-02", endDate: "2031-05-03", slept: false }}
      />
    );
    expect(screen.getByText("tripBuilder:existing.diff.undated")).toBeInTheDocument();
  });
});
