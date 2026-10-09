import { describe, it, expect, beforeEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AllTabLegend, useLegendOpen } from "../AllTabLegend";

/**
 * The All tab's colour key, split out of AllTab.tsx to keep that file under its
 * line ceiling. These pin what moved with it: it draws nothing without rows, it
 * remembers whether it is open under the key other code documents, and its
 * toggle stays the first child of the container with the rows beside it.
 */
describe("AllTabLegend", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders nothing when no domain contributes a row", () => {
    const { container } = render(
      <AllTabLegend rows={[]} open onToggle={() => {}} title="dashboard:legend.title" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the rows beside the toggle when open and only a count when closed", () => {
    const rows = [<span key="a">A</span>, <span key="b">B</span>];
    const onToggle = () => {};
    const { rerender } = render(
      <AllTabLegend rows={rows} open onToggle={onToggle} title="dashboard:legend.title" />
    );
    const toggle = screen.getByRole("button", { name: /dashboard:legend.title/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.parentElement?.firstElementChild).toBe(toggle);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();

    rerender(
      <AllTabLegend rows={rows} open={false} onToggle={onToggle} title="dashboard:legend.title" />
    );
    expect(screen.getByRole("button", { name: /dashboard:legend.title/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    // The count stays visible when collapsed.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onToggle when the toggle is pressed", async () => {
    let calls = 0;
    render(
      <AllTabLegend
        rows={[<span key="a">A</span>]}
        open
        onToggle={() => {
          calls += 1;
        }}
        title="dashboard:legend.title"
      />
    );
    await userEvent.click(screen.getByRole("button"));
    expect(calls).toBe(1);
  });
});

describe("useLegendOpen", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the choice under dashboard.legendOpen", () => {
    const { result } = renderHook(() => useLegendOpen());
    // jsdom is not a phone viewport, so the default is open.
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("dashboard.legendOpen")).toBe("true");

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("dashboard.legendOpen")).toBe("false");
  });

  it("starts from the remembered choice", () => {
    window.localStorage.setItem("dashboard.legendOpen", "false");
    const { result } = renderHook(() => useLegendOpen());
    expect(result.current[0]).toBe(false);
  });
});
