/**
 * The row actions have to stop propagation: since the rows navigate, a delete
 * click that bubbled would open the entry it just removed.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowActionButton, RowActions, TOUCH_HIT_AREA } from "../RowActionButton";

describe("RowActionButton", () => {
  it("calls its handler", async () => {
    const onClick = vi.fn();
    render(<RowActionButton icon="edit" label="Bearbeiten" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not let the click reach the row underneath", async () => {
    const onRow = vi.fn();
    const onDelete = vi.fn();
    render(
      <div onClick={onRow}>
        <RowActionButton icon="delete" label="Löschen" onClick={onDelete} />
      </div>
    );
    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("carries a name and a tooltip, because an icon alone is a guess", () => {
    render(<RowActionButton icon="duplicate" label="Duplizieren" onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Duplizieren" });
    expect(btn).toHaveAttribute("title", "Duplizieren");
  });

  it("hides the glyph from assistive tech, which reads the label instead", () => {
    const { container } = render(
      <RowActionButton icon="edit" label="Bearbeiten" onClick={vi.fn()} />
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("groups actions to the right", () => {
    const { container } = render(
      <RowActions>
        <RowActionButton icon="edit" label="Bearbeiten" onClick={vi.fn()} />
      </RowActions>
    );
    expect(container.firstElementChild?.className).toContain("justify-end");
  });

  // forgejo#249: the touch target must not change the layout. The action columns
  // are fixed-width, so a 44 px button overflowed them; the hit area is a
  // pseudo-element instead. jsdom cannot measure, so the classes are the contract.
  it("keeps its 28 px box on touch and extends only the hit area to 44 px", () => {
    render(<RowActionButton icon="edit" label="Bearbeiten" onClick={vi.fn()} />);
    const classes = screen.getByRole("button", { name: "Bearbeiten" }).className.split(/\s+/);

    // The drawn box: 28 px, with no pointer-dependent size.
    expect(classes).toEqual(expect.arrayContaining(["h-7", "w-7", "relative"]));
    expect(classes.filter((c) => /^pointer-coarse:(h|w|min-h|min-w|size)-/.test(c))).toEqual([]);

    // The hit area: 28 + 2 x 8 = 44 px, from an ::after on a coarse pointer only.
    expect(classes).toEqual(
      expect.arrayContaining(["pointer-coarse:after:absolute", "pointer-coarse:after:-inset-2"])
    );
    expect(TOUCH_HIT_AREA).toContain("-inset-2");
  });
});

describe("RowActionButton icons and states", () => {
  it("draws delete red at rest, not only on hover — delete is red everywhere", () => {
    render(<RowActionButton icon="delete" label="Delete" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete" }).style.color).toBe("var(--ts-bad)");
  });

  it("keeps every other icon muted at rest", () => {
    render(<RowActionButton icon="download" label="As GPX" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "As GPX" }).style.color).toBe("var(--ts-muted)");
  });

  it.each(["view", "download", "moveUp", "moveDown", "clear"] as const)(
    "draws the %s icon",
    (icon) => {
      const { container } = render(<RowActionButton icon={icon} label={icon} onClick={vi.fn()} />);
      expect(container.querySelector("svg")?.childElementCount).toBeGreaterThan(0);
    }
  );

  it("does not fire when disabled", () => {
    const onClick = vi.fn();
    render(<RowActionButton icon="moveUp" label="Up" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("still stops the click reaching the row it sits in", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <RowActionButton icon="delete" label="Delete" onClick={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(rowClick).not.toHaveBeenCalled();
  });
});
