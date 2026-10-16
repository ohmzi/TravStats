import { beforeAll, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Sheet, { SheetItem, SHEET_DISMISS_DRAG_PX } from "../Sheet";

/**
 * The phone's one popup (owner, 2026-10-16: every popup on the phone map
 * "should have similar looking and behaving popup … ideally at the bottom of
 * screen"). What makes the five dashboard popups and the two header menus ONE
 * shape is that each renders this — so the shape is pinned here once:
 *
 * - it is the dialog shell, docked to the bottom (`data-placement="sheet"`,
 *   `data-layout="sheet"` — the CSS keys on both),
 * - it is modal and named by its title,
 * - it closes four ways: "Fertig", the scrim, Escape, and a pull on the grip,
 * - a short pull springs back instead of closing.
 *
 * Deliberate-break protocol: drop `data-placement="sheet"` in Sheet.tsx and
 * the first case fails (the panel would centre on a tablet again); make
 * `onPointerEnd` close unconditionally and the "short pull" case fails.
 */

// jsdom has no PointerEvent, and without one `fireEvent.pointerMove` builds a
// plain Event that carries no `clientY` — the pull would measure nothing.
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
  }
});

function renderSheet(onClose = vi.fn()) {
  render(
    <Sheet open onClose={onClose} title="Legende">
      <p>Body</p>
    </Sheet>
  );
  return onClose;
}

describe("Sheet", () => {
  it("is the dialog shell docked to the bottom edge, modal and named by its title", () => {
    renderSheet();
    const sheet = screen.getByRole("dialog", { name: "Legende" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    expect(sheet.className).toContain("ts-dialog-panel");
    const scrim = sheet.parentElement as HTMLElement;
    expect(scrim.className).toContain("ts-dialog-scrim");
    expect(scrim).toHaveAttribute("data-placement", "sheet");
    expect(within(sheet).getByText("Body")).toBeInTheDocument();
  });

  it("renders nothing while shut", () => {
    render(
      <Sheet open={false} onClose={() => {}} title="Legende">
        <p>Body</p>
      </Sheet>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from its Done button", () => {
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /done|fertig/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes a caller's own Done label", () => {
    render(
      <Sheet open onClose={() => {}} title="Domänen" doneLabel="Übernehmen">
        <p>Body</p>
      </Sheet>
    );
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeInTheDocument();
  });

  it("closes on a tap beside it, but not on a tap inside it", () => {
    const onClose = renderSheet();
    const sheet = screen.getByRole("dialog");
    fireEvent.mouseDown(screen.getByText("Body"));
    fireEvent.click(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
    const scrim = sheet.parentElement as HTMLElement;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = renderSheet();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the grip is pulled down far enough", () => {
    const onClose = renderSheet();
    const grip = screen.getByTestId("sheet-grip");
    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 100 + SHEET_DISMISS_DRAG_PX + 10, pointerId: 1 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("springs back after a short pull instead of closing", () => {
    const onClose = renderSheet();
    const grip = screen.getByTestId("sheet-grip");
    const sheet = screen.getByRole("dialog");
    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 120, pointerId: 1 });
    expect(sheet.style.transform).toBe("translateY(20px)");
    fireEvent.pointerUp(grip, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("does not start a pull from the Done button", () => {
    const onClose = renderSheet();
    const grip = screen.getByTestId("sheet-grip");
    const done = screen.getByRole("button", { name: /done|fertig/i });
    fireEvent.pointerDown(done, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SheetItem", () => {
  it("is a full-width menu row that reports its pick", () => {
    const onSelect = vi.fn();
    render(<SheetItem label="Flug" onSelect={onSelect} />);
    const item = screen.getByRole("menuitem", { name: "Flug" });
    expect(item.className).toContain("ts-sheet-item");
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("swallows a pick while disabled", () => {
    const onSelect = vi.fn();
    render(<SheetItem label="Strava" onSelect={onSelect} disabled />);
    const item = screen.getByRole("menuitem", { name: "Strava" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
