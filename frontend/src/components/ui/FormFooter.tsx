import type { CSSProperties, JSX, ReactNode } from "react";

import { phoneBottomOffset } from "../map/phoneChrome";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";

/**
 * The one footer an edit form ends with.
 *
 * A row of controls that belongs to the FORM rather than to the page: Cancel
 * and Save, and sometimes a line of refusal beside them. Two screens hand-rolled
 * this before it existed, and they agreed on nothing — 36px controls against the
 * primitive's 46, `rounded-lg` (8px) against `--ts-radius-button` (12px), the
 * label in `text-white` on amber where the design says `--ts-accent-text`, and
 * `justify-end` on one against `justify-start` on the other. The owner's report
 * of 2026-10-15 names the symptom: "the save button in edit mode aren't in same
 * location or design".
 *
 * `align="end"` is the default because a form that commits with Save puts it
 * last; a row whose primary is the *next* thing ("Add point", then "Save points")
 * reads left to right and passes `align="start"`.
 *
 * On a phone the row is pinned to the bottom edge, and that part is not
 * decoration either. A journey's edit form runs ~2100px tall, so a Save left in
 * the flow sat ~850px below the fold — unreachable from the date fields at the
 * top, which is the only control the page exists for (owner report,
 * 2026-10-12). The surface background and the top border are what let the form
 * scroll UNDER the row, and the pad carries the safe-area inset so it clears a
 * home bar. A desktop keeps the row in the flow, at the end of the form.
 */
export default function FormFooter({
  children,
  align = "end",
  hint,
}: {
  children: ReactNode;
  /** Which edge the controls sit on. `end` for Cancel/Save, `start` for a row that reads forward. */
  align?: "start" | "end";
  /** A refusal or status line, shown before the controls on one wrapping row. */
  hint?: ReactNode;
}): JSX.Element {
  // The live answer, not a snapshot: a tablet rotated, or a devtools viewport
  // change during manual QA, has to move the row between flow and sticky.
  const phone = useIsPhoneViewport();

  const style: CSSProperties | undefined = phone
    ? {
        background: "var(--ts-bg)",
        borderTop: "1px solid var(--ts-border)",
        paddingTop: 12,
        paddingBottom: phoneBottomOffset(12),
      }
    : undefined;

  return (
    <div
      className={[
        phone ? "sticky bottom-0 z-30" : "",
        "flex flex-wrap items-center",
        align === "end" ? "justify-end" : "justify-start",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ gap: "var(--ts-space-sm)", ...style }}
    >
      {hint}
      {children}
    </div>
  );
}
