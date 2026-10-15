import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { TOOLBAR_CONTROL_STYLE } from "./Button";

/**
 * The outline link a detail page draws in its header beside the primary button
 * — "Edit route & recordings" on a roadtrip, "Open trip" on a journey. A
 * `Link`, not a `<button>`, for the same reason the back link is one: a
 * destination is a destination, and a middle click has to open it in a new tab.
 *
 * It shares the secondary button's recipe — `TOOLBAR_CONTROL_STYLE`, so it can
 * never drift from the button beside it again — and it is what the trip page's
 * "Re-sync from Immich" renders (`tripBuilder/ResyncFromImmich`), so the three
 * toolbar rows draw one control, one size (owner, 2026-10-11: "all these
 * should be same size"). The difference that stays is what each link points
 * at: a roadtrip's recorded route, a journey's own trip, a trip's re-scan.
 *
 * `primary` exists because Edit is amber (owner, 2026-10-15: "all the edit
 * buttons should be yellow"). Edit is still a destination, so it stays a link
 * — a middle click opens the edit page in a new tab — and takes the amber skin
 * `Button variant="primary"` draws, at the row's 46, never the lone-CTA 52.
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
  const skin =
    variant === "primary"
      ? {
          background: "var(--ts-accent)",
          color: "var(--ts-accent-text)",
          border: "1px solid var(--ts-accent)",
        }
      : {
          background: "transparent",
          color: "var(--ts-text)",
          border: "1px solid var(--ts-border-button)",
        };
  return (
    <Link
      to={to}
      title={title}
      className="ts-button inline-flex items-center"
      data-variant={variant}
      style={{
        ...TOOLBAR_CONTROL_STYLE,
        ...skin,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
