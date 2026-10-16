import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Toast from "../Toast";
import { useToastStore } from "../../store/toastStore";

/**
 * What a toast looks like and where it stands (owner, 2026-10-16, from a
 * phone: the toast hung off the left edge of the screen, check mark cut off,
 * in a green border the design system has no name for).
 *
 * - A confirmation is the SECONDARY amber: the tinted recipe — 45 % amber
 *   border over an opaque surface — never the solid fill a primary button
 *   owns. A failure stays red.
 * - The stack is `.ts-toast-stack`, whose CSS docks it to the bottom edge
 *   (full width less the gutters on a phone). jsdom has no layout, so what is
 *   pinned is that the stack carries the class the placement lives in.
 *
 * Deliberate-break protocol: set `success` back to a `--success`/green tone in
 * Toast.tsx's TONE table and the first case fails.
 */

afterEach(() => {
  act(() => useToastStore.getState().clearToasts());
});

function show(type: "success" | "info" | "warning" | "error", message: string): HTMLElement {
  render(
    <MemoryRouter>
      <Toast />
    </MemoryRouter>
  );
  act(() => {
    useToastStore.getState().addToast(type, message, 0);
  });
  return screen.getByText(message).closest(".ts-toast") as HTMLElement;
}

describe("a toast's tone", () => {
  it("draws a confirmation in the secondary amber, tinted rather than filled", () => {
    const toast = show("success", "Journey updated");
    expect(toast.getAttribute("style")).toContain("--ts-accent");
    expect(toast.getAttribute("style")).not.toContain("--success");
    // A tint over the surface — the fill is mostly `surface2`, never the accent alone.
    expect(toast.style.background).toContain("--ts-surface2");
    expect(toast).toHaveAttribute("role", "status");
  });

  it("keeps a failure red, and announces it as an alert", () => {
    const toast = show("error", "Save failed");
    expect(toast.getAttribute("style")).toContain("--ts-bad");
    expect(toast.getAttribute("style")).not.toContain("--ts-accent");
    expect(toast).toHaveAttribute("role", "alert");
  });

  it("stands in the stack whose CSS docks it to the bottom edge", () => {
    const toast = show("info", "Dates changed");
    expect(toast.parentElement?.className).toBe("ts-toast-stack");
  });

  it("uses a line icon, not an emoji glyph", () => {
    const toast = show("success", "Saved");
    expect(toast.querySelector("svg")).not.toBeNull();
    expect(toast.textContent).not.toContain("✓");
  });
});
