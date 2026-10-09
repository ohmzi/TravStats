import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The outline link a detail page draws in its header beside the primary button
 * — "Edit route & recordings" on a roadtrip, "Open trip" on a journey. A
 * `Link`, not a `<button>`, for the same reason the back link is one: a
 * destination is a destination, and a middle click has to open it in a new tab.
 *
 * The recipe is the roadtrip detail page's `outlineAction`, lifted here so the
 * journey page's copy cannot drift from it in height, padding, radius or
 * border. Both pages WANT the same outline link (owner, 2026-10-08: "match the
 * flight page to the road trip page"); the difference that stays is what each
 * points at (a roadtrip's recorded route, a journey's own trip), not how it is
 * drawn.
 */
export default function ActionLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Link
      to={to}
      className="flex items-center"
      style={{
        minHeight: "var(--ts-size-touch-min)",
        padding: "0 14px",
        borderRadius: "var(--ts-radius-button)",
        border: "1px solid var(--ts-border-button)",
        color: "var(--ts-text)",
        textDecoration: "none",
        fontSize: 14,
      }}
    >
      {children}
    </Link>
  );
}
