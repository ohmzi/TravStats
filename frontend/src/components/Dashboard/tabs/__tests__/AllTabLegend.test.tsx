import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AllTabLegend, useLegendOpen } from "../AllTabLegend";
import { PHONE_KEY_BOTTOM } from "../../../map/phoneChrome";

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

/**
 * Below 640px the key's floating card was the third overlay in a corner with
 * room for two: at 390×844 its rows sat on the "Karte" panel's pill and under
 * "Domänen · x/y" (2026-10-12). On a phone it keeps its pill in its own row
 * above the filter button and opens as the shared bottom sheet (`ui/Sheet`),
 * the one shape every popup over the phone map has since 2026-10-16.
 *
 * Deliberate-break protocol: in AllTabLegend.tsx drop the `phone` branch and
 * both cases below fail (the closed pill moves back to the attribution
 * clearance and the opened key is an absolutely positioned card again).
 */
describe("AllTabLegend on a phone", () => {
  const rows = [<span key="a">A</span>, <span key="b">B</span>];

  beforeEach(() => {
    window.localStorage.clear();
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 639px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    // Back to jsdom's own answer, which is not a phone.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it("keeps the shut key as a pill in the row above the filter button", () => {
    render(
      <AllTabLegend rows={rows} open={false} onToggle={() => {}} title="dashboard:legend.title" />
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("ts-chrome-pill");
    const pill = button.parentElement as HTMLElement;
    expect(pill.style.position).toBe("absolute");
    // PHONE_KEY_BOTTOM, plus the safe-area inset (0 until the viewport meta
    // carries viewport-fit=cover). jsdom re-serialises `env()` in its own
    // spelling, so the offset and the inset are asserted as parts.
    expect(pill.style.bottom).toContain(`${PHONE_KEY_BOTTOM}px`);
    expect(pill.style.bottom).toContain("safe-area-inset-bottom");
    // The count still says how much is behind it.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as the shared bottom sheet, not as a floating card", () => {
    const onToggle = vi.fn();
    render(<AllTabLegend rows={rows} open onToggle={onToggle} title="dashboard:legend.title" />);
    const sheet = screen.getByRole("dialog", { name: "dashboard:legend.title" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    // Its rows are inside it...
    expect(within(sheet).getByText("A")).toBeInTheDocument();
    // ...and the scrim closes it through the same toggle that opened it.
    const scrim = sheet.parentElement as HTMLElement;
    expect(scrim.className).toContain("ts-dialog-scrim");
    fireEvent.click(scrim);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
