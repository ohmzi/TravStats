import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import MenuButton, { type MenuItem } from "../MenuButton";

const items = (over: Partial<Record<string, Partial<MenuItem>>> = {}): MenuItem[] => [
  { id: "upload", label: "Upload file…", onSelect: vi.fn(), ...over.upload },
  { id: "dawarich", label: "From Dawarich", onSelect: vi.fn(), ...over.dawarich },
  { id: "strava", label: "From Strava", onSelect: vi.fn(), ...over.strava },
];

describe("MenuButton", () => {
  it("is a black toolbar control that announces its menu", () => {
    render(<MenuButton label="Add recording" items={items()} />);
    const trigger = screen.getByRole("button", { name: /Add recording/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-variant", "secondary");
    expect(trigger.style.height).toBe("var(--ts-size-button-secondary)");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens, focuses the first item and selects with a click", () => {
    const list = items();
    render(<MenuButton label="Add recording" items={list} />);
    fireEvent.click(screen.getByRole("button", { name: /Add recording/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Upload file…" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "From Strava" }));
    expect(list[2].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves with the arrow keys, skips nothing, wraps, and closes on Escape back to the trigger", () => {
    render(<MenuButton label="Add recording" items={items()} />);
    const trigger = screen.getByRole("button", { name: /Add recording/ });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "From Dawarich" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "From Strava" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows a disabled item with its reason and does not select it", () => {
    const list = items({ dawarich: { disabled: true, reason: "No Dawarich connection." } });
    render(<MenuButton label="Add recording" items={list} />);
    fireEvent.click(screen.getByRole("button", { name: /Add recording/ }));
    const item = screen.getByRole("menuitem", { name: /From Dawarich/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("No Dawarich connection.")).toBeVisible();
    fireEvent.click(item);
    expect(list[1].onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on a click outside", () => {
    render(
      <div>
        <MenuButton label="Add recording" items={items()} />
        <p>outside</p>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /Add recording/ }));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not open while disabled", () => {
    render(<MenuButton label="Uploading…" items={items()} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /Uploading/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
