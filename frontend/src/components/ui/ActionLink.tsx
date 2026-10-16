import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { BUTTON_SKIN, TOOLBAR_CONTROL_STYLE } from "./Button";

/**
 * A link that wears a button's clothes: a destination a page draws in its
 * header, at the row's 46, beside the button next to it — "Edit route &
 * recordings" on a roadtrip, "Open trip" on a journey. A `Link`, not a
 * `<button>`, for the same reason the back link is one: a destination is a
 * destination, and a middle click has to open it in a new tab.
 *
 * It spreads the button's own recipe rather than copying the numbers —
 * `TOOLBAR_CONTROL_STYLE` for the row's size and `BUTTON_SKIN[variant]` for the
 * colour — so it can never drift from the button beside it again, and it is
 * what the trip page's "Re-sync from Immich" renders
 * (`tripBuilder/ResyncFromImmich`), so the three toolbar rows draw one control,
 * one size (owner, 2026-10-11: "all these should be same size").
 *
 * `secondary` is the black outline; `primary` is the amber one, which exists
 * because Edit is amber (owner, 2026-10-15: "all the edit buttons should be
 * yellow"). Edit stays a link — a middle click opens the edit page in a new
 * tab — and takes the amber skin `Button variant="primary"` draws, at the row's
 * 46, never the lone-CTA 52.
 */
export default function ActionLink({
  to,
  children,
  variant = "secondary",
  title,
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  /** What the destination does, for a link whose label cannot say it all. */
  title?: string;
}): JSX.Element {
  return (
    <Link
      to={to}
      title={title}
      className="ts-button inline-flex items-center"
      data-variant={variant}
      style={{
        ...TOOLBAR_CONTROL_STYLE,
        ...BUTTON_SKIN[variant],
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
