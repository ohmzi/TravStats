import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AddDomainPicker } from "../AddDomainPicker";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string): string => {
      const map: Record<string, string> = {
        "dashboard:addPicker.button": "Hinzufügen",
        "dashboard:addPicker.flight": "Flug",
        "dashboard:addPicker.cruise": "Kreuzfahrt",
        "common:buttons.done": "Fertig",
      };
      return map[key] ?? key;
    },
  }),
}));

/**
 * "+ Hinzufügen" on a phone (owner, 2026-10-16): its menu hung from the
 * top-right corner while every other popup on the map came up from the
 * bottom. On a phone it is the shared bottom sheet (`ui/Sheet`) now.
 *
 * Deliberate-break protocol: render the desktop `<ul role="menu">` on a
 * phone again (drop `!phone` from its condition in AddDomainPicker.tsx) and
 * the "opens a sheet" case fails on the second menu.
 */

function setViewport(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const ENABLED = {
  flight: true,
  cruise: true,
  lodging: false,
  poi: false,
  roadtrip: false,
  rail: false,
  rental: false,
  bus: false,
  tour: false,
};

beforeEach(() => setViewport(true));
afterEach(() => setViewport(false));

describe("AddDomainPicker on a phone", () => {
  it("opens the shared bottom sheet, not a dropdown", () => {
    render(<AddDomainPicker enabled={ENABLED} onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    const sheet = screen.getByRole("dialog", { name: "Hinzufügen" });
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(within(sheet).getByRole("menuitem", { name: "Flug" })).toBeInTheDocument();
    expect(within(sheet).getByRole("menuitem", { name: "Kreuzfahrt" })).toBeInTheDocument();
  });

  it("passes the pick on and closes", () => {
    const onPick = vi.fn();
    render(<AddDomainPicker enabled={ENABLED} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    // A press inside the sheet is outside the picker's own DOM (the sheet is
    // portalled) — it must not shut the menu before the click lands.
    const item = screen.getByRole("menuitem", { name: "Kreuzfahrt" });
    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(onPick).toHaveBeenCalledWith("cruise");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from Fertig without a pick", () => {
    const onPick = vi.fn();
    render(<AddDomainPicker enabled={ENABLED} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    fireEvent.click(screen.getByRole("button", { name: "Fertig" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
