import type { JSX, ReactNode } from "react";

import type { Flight } from "../../types";

/**
 * A flight's numbers as a band, in the shape the roadtrip page uses (owner,
 * 2026-10-08): the same grid, the same mono figures with a label beneath, so
 * the two detail pages read as the same kind of page rather than as two
 * designs that happen to sit beside each other in the same app.
 *
 * What differs is the content and that is the point — a flight has no nights
 * and a roadtrip has no seat — so the band takes cells rather than trying to
 * derive them.
 *
 * A figure the band is HANDED is always drawn. A value that is UNKNOWN for a
 * figure is a dash with its reason on hover (owner, 2026-10-08), never a zero:
 * "we could not work out the distance" is not "the distance was nothing". A
 * cell that is an ENTRY POINT — the journey it belongs to, that journey's album
 * — draws "N/A" when it has nothing to point at, because an absent entry point
 * and a hidden one read the same otherwise. (The single-flight page still hands
 * this band only the cells it can fill, which is a caller's choice; the band
 * itself hides nothing it is given.)
 *
 * `responsive` is for the wider journey band of seven: it swaps the
 * count-derived inline columns for the roadtrip furniture's breakpoint grid
 * (`grid-cols-2 sm:grid-cols-4 xl:<n>`), so the journey band keeps the same
 * two / four / one-row rhythm the roadtrip band uses. (The roadtrip band sits
 * `xl:grid-cols-8` over its eight figures; the journey's is `xl:grid-cols-7`
 * over seven, so at width each is one row.) A count-derived grid cannot do this
 * for seven: `min(6, max(2, 7))` is six, leaving a lone seventh cell. Left off,
 * the layout is exactly what the single-flight page has always shown.
 *
 * The cell type is split in two so one grid serves both pages: the
 * single-flight page keeps `FlightFigure` (value a plain `string`, which its
 * own `f is FlightFigure` predicate depends on), and the journey band hands it
 * `FlightFigureCell`s whose value may be a link or a button.
 */
export interface FlightFigure {
  key: string;
  label: string;
  value: string;
  /** The line under the figure that says what it is made of. */
  sub?: string;
}

/**
 * A richer cell the same grid draws when the value is not a plain number — the
 * journey band's LINKS and buttons: the trip it belongs to, that trip's album,
 * the flights count the owner taps. Optional `title`/`hue` carry a value's
 * reason and its colour. A plain `FlightFigure[]` is assignable to this, so the
 * single-flight page keeps passing what it always did.
 */
export interface FlightFigureCell extends Omit<FlightFigure, "value"> {
  value: ReactNode;
  /** Shown on hover, where a value needs its reason or its derivation spelled out. */
  title?: string;
  /** Overrides the default figure colour; a token reference. */
  hue?: string;
}

/**
 * The xl breakpoint column count, as a LITERAL class so Tailwind can see it —
 * a template-built `xl:grid-cols-${n}` is purged and the band silently falls
 * back to one column. Only the counts a caller might ask for are listed.
 */
const RESPONSIVE_XL: Record<number, string> = {
  6: "xl:grid-cols-6",
  7: "xl:grid-cols-7",
  8: "xl:grid-cols-8",
};

export default function FlightFigures({
  figures,
  responsive,
}: {
  /** Richer cells are accepted too, so the journey band is served by the same grid. */
  figures: FlightFigureCell[];
  /** When set, use the roadtrip band's responsive grid at this many xl columns. */
  responsive?: number;
}): JSX.Element | null {
  if (figures.length === 0) return null;
  // Columns follow the count so a band of five does not leave a hole beside it.
  const columns = Math.min(6, Math.max(2, figures.length));
  return (
    <dl
      className={
        responsive
          ? `grid grid-cols-2 overflow-hidden sm:grid-cols-4 ${RESPONSIVE_XL[responsive] ?? ""}`
          : "grid overflow-hidden"
      }
      style={{
        ...(responsive ? {} : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }),
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
          title={f.title}
        >
          <dt className="t-label-mono">{f.label}</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: "var(--ts-font-mono)",
              fontSize: 22,
              fontWeight: 600,
              color: f.hue ?? "var(--ts-text-bright)",
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
