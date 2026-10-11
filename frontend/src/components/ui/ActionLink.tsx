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
      className="ts-button inline-flex items-center"
      data-variant="secondary"
      style={{
        ...TOOLBAR_CONTROL_STYLE,
        border: "1px solid var(--ts-border-button)",
        color: "var(--ts-text)",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
