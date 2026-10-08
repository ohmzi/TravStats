import type { JSX } from "react";

import type { Flight } from "../../types";

/**
 * A flight's numbers as a band, in the shape the roadtrip page uses (owner,
 * 2026-10-08): the same grid, the same mono figures with a label beneath, so
 * the two detail pages read as the same kind of page rather than as two
 * designs that happen to sit beside each other in the same app.
 *
 * What differs is the content and that is the point — a flight has no nights
 * and a roadtrip has no seat — so the band takes cells rather than trying to
 * derive them. A cell whose value is unknown is left out entirely, exactly as
 * the roadtrip band does: a dash in a row of numbers reads as a zero.
 */
export interface FlightFigure {
  key: string;
  label: string;
  value: string;
  /** The line under the figure that says what it is made of. */
  sub?: string;
}

export default function FlightFigures({ figures }: { figures: FlightFigure[] }): JSX.Element | null {
  if (figures.length === 0) return null;
  // Columns follow the count so a band of five does not leave a hole beside it.
  const columns = Math.min(6, Math.max(2, figures.length));
  return (
    <dl
      className="grid overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 1,
        background: "var(--ts-border)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      {figures.map((f) => (
        <div
          key={f.key}
          className="flex min-w-0 flex-col"
          style={{ background: "var(--ts-surface)", padding: "var(--ts-space-lg)", gap: 4 }}
        >
          <dt className="t-label-mono">{f.label}</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: "var(--ts-font-mono)",
              fontSize: 22,
              fontWeight: 600,
              color: "var(--ts-text-bright)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {f.value}
          </dd>
          {f.sub && (
            <dd className="t-caption" style={{ margin: 0 }}>
              {f.sub}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** The airline and number, "AC8946 · Air Canada" — the band's own heading. */
export function flightTitle(flight: Pick<Flight, "airline" | "flightNumber">): string {
  return [flight.flightNumber, flight.airline].filter(Boolean).join(" · ");
}
