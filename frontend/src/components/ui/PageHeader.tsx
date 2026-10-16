import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One line under the title — scope, count, provenance. Never a paragraph. */
  meta?: ReactNode;
  /** Right-hand slot: the page's own actions. At most two. */
  actions?: ReactNode;
}

/**
 * The one page heading.
 *
 * The app carries seventeen different h1 class chains today; every one of them
 * is this. The title is `.t-screen-title` and nothing else decides its size,
 * weight or colour — that is the whole point of the class.
 */
export default function PageHeader({ title, meta, actions }: PageHeaderProps): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-start justify-between"
      style={{ gap: "var(--ts-space-lg)", marginBottom: "var(--ts-space-xl)" }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        <h1 className="t-screen-title">{title}</h1>
        {meta ? <div className="t-caption">{meta}</div> : null}
      </div>
      {actions ? (
        // Wraps: two labelled buttons are wider than a 390px phone.
        //
        // `ml-auto` + `justify-end`, and not only the row's `justify-between`:
        // once a long title wraps the actions onto a line of their own, the row
        // has a single item left on that line and `space-between` puts it at
        // the LEFT edge. "Skandinavien Sommer 2026" at 26/800 is enough to do
        // it at iPad portrait, and the reader then finds "Mit Immich abgleichen
        // / Trip löschen" under the title instead of ending at the right edge
        // the owner asked for (2026-10-15). `SectionHeader` carries the same
        // pair for the same reason.
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
