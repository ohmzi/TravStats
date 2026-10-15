import type { JSX, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

/**
 * The one way back.
 *
 * A real `Link`, not a `<button>`: back is a destination, so a middle click and
 * "open in new tab" have to keep working. Three of the four detail pages used a
 * button before `DetailHeader` existed and silently took that away.
 *
 * This was `DetailHeader`'s own inline JSX until 2026-10-15. The edit and
 * resync screens — which have no `DetailHeader`, because they are forms rather
 * than entry heads — kept hand-rolling their own, and drifted by exactly the
 * numbers that were hard-coded here: 13px against their 12px, `ts-back-link`
 * against a bare `text-xs`, and no history handling at all. The owner's report
 * of 2026-10-15 is the second time that drift was raised ("the back buttons
 * aren't matching"). So the recipe lives here, both families spread it, and
 * neither can copy the numbers wrong again.
 */
export default function BackLink({
  to,
  children,
}: {
  /** Where back goes when there is no history to return to. */
  to: string;
  children: ReactNode;
}): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Link
      to={to}
      onClick={(event) => {
        // Back goes where the reader CAME FROM, not to this section's front
        // door (owner, 2026-10-08): from a roadtrip into its album and out
        // again landed on the journey, because the link's target was fixed
        // and the history that knew better was ignored.
        //
        // `location.key === "default"` is React Router's first entry — a page
        // opened directly has nothing to go back TO, so the fixed target is
        // right and stays.
        //
        // Only a plain left click is intercepted: middle click, cmd-click and
        // "open in new tab" still get `to`, which is what an address typed
        // into a fresh tab should be.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          location.key === "default"
        ) {
          return;
        }
        event.preventDefault();
        navigate(-1);
      }}
      className="ts-back-link"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginBottom: "var(--ts-space-md)",
        fontSize: 13,
        color: "var(--ts-muted)",
        textDecoration: "none",
      }}
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  );
}
