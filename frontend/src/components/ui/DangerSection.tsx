import type { JSX } from "react";

import Button from "./Button";

/**
 * The one way a delete that takes a whole thing is offered.
 *
 * It exists because the owner found the same action drawn two ways in one
 * codebase (2026-10-15, with both screenshots): on the journey's edit page
 * "Delete" was a red-outlined button, and on a trip's edit page "Delete trip"
 * was a bare underlined word. Their words: *"delete button one place looks
 * plain and boring and unrecognizedable and other place is red and obvious"*.
 *
 * The treatment itself was already settled — `Button variant="danger"` is a
 * tinted outline, never a red fill, because the dialog beside it states the
 * object, the reach and the consequence; a destructive action is confirmed,
 * not offered. What was missing was a NAME for that decision, so that the next
 * page could reach for something instead of hand-rolling a link.
 *
 * The rule this encodes, stated once so the two families cannot drift again:
 *
 * - **A delete that removes the PAGE'S OWN SUBJECT** — the journey, the trip,
 *   the place, the flight — is this: a `danger` button in a titled section
 *   under the form, with one sentence naming what goes and what survives.
 * - **A delete inside a ROW of many** — the third leg of a route, one note on
 *   a timeline, one tag — stays a low-weight inline action, because a page of
 *   red buttons would drown the content it sits beside. `RowActionButton` is
 *   that one.
 *
 * The distinction is weight, not emphasis: the user should never have to
 * wonder whether an underlined word deletes something.
 */
export default function DangerSection({
  heading,
  hint,
  label,
  onClick,
}: {
  /** "Delete", "Löschen" — the section's own heading. */
  heading: string;
  /**
   * One sentence: what goes with it, and what survives. Never omitted — the
   * dialog asks the same question again for the moment of commitment, and
   * this is where the reader gets to decide without opening anything.
   */
  hint: string;
  /** The button's label, which normally repeats the heading. */
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{heading}</h2>
      {/* The design system's muted ink for a NEW file — a legacy palette token
          here would be a new offender and fail `check:actions`. */}
      <p className="text-sm mb-3" style={{ color: "var(--ts-muted)" }}>
        {hint}
      </p>
      <Button variant="danger" size="toolbar" onClick={onClick}>
        {label}
      </Button>
    </section>
  );
}
