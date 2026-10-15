import type { JSX, ReactNode } from "react";

/**
 * A section's title line: the label left, that section's own actions at the
 * right edge of the same line.
 *
 * The second of the three placement levels (page · section · row) the owner
 * asked for on 2026-10-15 — "they are randomly placed sometimes next to each
 * other, they should have a beautiful structure". Before it, "Route the whole
 * tour" sat in a row of its own above the legs, the recording sources in a row
 * of their own above the tracks, and "Add point" in the points' Save row: three
 * sections, three places for the same kind of control. The label is the
 * `t-label-mono` every detail section already uses (`DetailSection`), so an
 * edit screen reads like the page it edits.
 *
 * `ml-auto` on the action group, not only `justify-between`: when a long title
 * wraps the actions onto their own line they still end at the right edge.
 */
export default function SectionHeader({
  title,
  actions,
  id,
}: {
  title: string;
  actions?: ReactNode;
  /** For an `aria-labelledby` on the section it heads. */
  id?: string;
}): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center justify-between"
      style={{ gap: "var(--ts-space-md)", marginBottom: "var(--ts-space-md)" }}
    >
      <h2 id={id} className="t-label-mono">
        {title}
      </h2>
      {actions ? (
        <div
          className="ml-auto flex flex-wrap items-center justify-end"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
