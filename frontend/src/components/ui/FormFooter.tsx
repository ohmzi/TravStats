import type { CSSProperties, JSX, ReactNode } from "react";

import { phoneBottomOffset } from "../map/phoneChrome";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";

/**
 * The one footer a form ends with, and the ONE place its buttons live.
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
 * **The controls are at the END — the right edge — always.** That is the
 * owner's standing instruction (2026-10-15: "lets move all the interactive
 * buttons on the right side of screen"), and it is what a reader already knows
 * from every dialog in the app: the content fills the page and the actions that
 * commit it sit together at the bottom right. A row that reads forward — "Add
 * point", then "Save points" — keeps that ORDER and still ends at the right
 * edge; the order is what the reading-direction argument was ever about, not
 * which side of the page it happens to land on.
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
  hint,
  inset = false,
}: {
  children: ReactNode;
  /** A refusal or status line, shown before the controls on one wrapping row. */
  hint?: ReactNode;
  /**
   * Set inside a dialog whose shell already pads its content, so the footer
   * draws the same divider without adding a second gutter or a second sticky
   * rule. The ALIGNMENT never changes — a dialog's Cancel/Save is the row this
   * component was extracted from.
   */
  inset?: boolean;
}): JSX.Element {
  // The live answer, not a snapshot: a tablet rotated, or a devtools viewport
  // change during manual QA, has to move the row between flow and sticky.
  const phone = useIsPhoneViewport();

  const shell: CSSProperties = inset
    ? { paddingTop: 16, paddingBottom: 16, borderTop: "1px solid var(--ts-border)" }
    : {};

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
      className={["flex flex-wrap items-center justify-end", phone ? "sticky bottom-0 z-30" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{ gap: "var(--ts-space-sm)", ...shell, ...style }}
    >
      {/* `ml-auto` keeps the controls at the right edge even when the hint
          wraps onto a line of its own on a narrow viewport.

          The hint sits INSIDE this group, immediately before the controls, not
          out at the row's left edge. It used to be a separate flex item, which
          on a wide screen pushed a refusal like "the end date is before the
          start" hundreds of pixels away from the disabled Save it explains —
          the reader saw a greyed-out button and a sentence that looked
          unrelated (owner, 2026-10-12: "the update button is disabled and no
          mention of whats the reason"). Kept beside the button it talks about
          it stays a caption for the control. */}
      <div className="ml-auto flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        {hint}
        {children}
      </div>
    </div>
  );
}
