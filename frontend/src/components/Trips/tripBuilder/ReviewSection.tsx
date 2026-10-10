import type { JSX, ReactNode } from "react";

import { Card } from "../../ui/Card";

interface ReviewSectionProps {
  title: string;
  /** Right-aligned on the title's line: a count, a short note. */
  aside?: ReactNode;
  children: ReactNode;
}

/** A titled card: the frame of the flights, album, journeys, excluded and warnings blocks. */
export default function ReviewSection({ title, aside, children }: ReviewSectionProps): JSX.Element {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--ts-space-lg)" }}>
      <div
        className="flex flex-wrap items-baseline justify-between"
        style={{ gap: "var(--ts-space-md)" }}
      >
        <h2 className="t-card-title">{title}</h2>
        {aside ? <span className="t-caption">{aside}</span> : null}
      </div>
      {children}
    </Card>
  );
}
