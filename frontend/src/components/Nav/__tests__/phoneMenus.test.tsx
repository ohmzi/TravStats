import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "de" },
  }),
}));

import MoreMenu from "../MoreMenu";
import UserMenu from "../UserMenu";
import type { NavSection } from "../useNavItems";

/**
 * The header's two menus on a phone (owner, 2026-10-16: every popup on a
 * phone the same shape, from the bottom edge). Both open the shared sheet.
 *
 * The case that matters most is the pick: the sheet is portalled to <body>,
 * outside the menu's own root, so the menus' outside-click rule would close
 * the sheet on the very mousedown that starts the tap — and the link would
 * be gone before its click arrived. Both menus stand that rule down on a
 * phone.
 *
 * Deliberate-break protocol: in MoreMenu.tsx pass `close` instead of
 * `closeOutside` to `useClickOutside` and the "follows the entry" case fails.
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

beforeEach(() => setViewport(true));
afterEach(() => setViewport(false));

const SECTIONS: NavSection[] = [
  {
    id: "tools",
    label: "Werkzeuge",
    items: [{ kind: "leaf", id: "stats", label: "Statistik", path: "/stats", icon: "gauge" }],
  },
];

describe("MoreMenu on a phone", () => {
  it("opens the shared bottom sheet and follows the entry picked in it", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<MoreMenu sections={SECTIONS} />} />
          <Route path="/stats" element={<p>Stats page</p>} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /nav\.more/ }));
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    expect(within(sheet).getByText("Werkzeuge")).toBeInTheDocument();
    const entry = within(sheet).getByRole("menuitem", { name: "Statistik" });
    fireEvent.mouseDown(entry);
    fireEvent.click(entry);
    expect(screen.getByText("Stats page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("UserMenu on a phone", () => {
  it("opens the shared bottom sheet and logs out from it", () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <UserMenu user={{ username: "akuenzel", firstName: "Alex" }} onLogout={onLogout} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-layout", "sheet");
    const logout = within(sheet).getByRole("menuitem", { name: /logout/ });
    fireEvent.mouseDown(logout);
    fireEvent.click(logout);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
