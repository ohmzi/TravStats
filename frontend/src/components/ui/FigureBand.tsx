import type { JSX, ReactNode } from "react";

/**
 * One figures band, in the roadtrip page's furniture (owner, 2026-10-08: "try
 * to match flight page to road trip page"): mono label, a 22px mono figure, an
 * optional line under it saying what the figure is made of, hairline-separated
 * cells on `--ts-surface`, and an optional caption row underneath.
 *
 * The roadtrip band and the flight journey's band are the SAME band with
 * different cells, so they are one component rather than two that happen to
 * look alike. That is not tidiness for its own sake: the flight band's copy
 * had already gone stale against the roadtrip band it claimed to mirror
 * ("sits `xl:grid-cols-8` over its eight figures", false since the band shed
 * two cells on 2026-10-08). A shared band cannot drift from itself.
 *
 * The grid is BREAKPOINTS, not a count. `columns` is the column count at base
 * / `sm` / `xl`, and the LAST cell spans whatever its last row leaves empty, so
 * a cell count that is not a multiple of the column count leaves no empty
 * track showing through. The journey band is the case that needs it: seven
 * cells four across leave one track free at `sm`, which the album cell fills,
 * and at `xl` seven cells fill the row again, so the album is RESET to a single
 * track there — a span taken at a narrower breakpoint must not hold past the
 * row it was closing. The literal classes live in `GRID` and `SPAN` because a
 * template-built `sm:grid-cols-${n}` is purged by Tailwind and the band would
 * silently fall back to a single column.
 *
 * A cell the band is HANDED is always drawn: an unknown value is the caller's
 * dash-with-a-reason, never the band hiding the cell. And a cell whose value is
 * an ENTRY POINT (a link, a button) says what it points at even when there is
 * nothing there — an absent entry point and a hidden one read the same.
 */
export interface FigureBandCell {
  key: string;
  label: string;
  /** A figure may be a LINK or a button — the journey it belongs to, its album. */
  value: ReactNode;
  /** The line under the figure that says what it is made of. */
  sub?: string;
  /** Shown on hover, where a value needs its reason or its derivation spelled out. */
  title?: string;
  /** Overrides the default figure colour; a token reference. */
  hue?: string;
}

/**
 * The band's responsive grids, keyed by the breakpoint triple. Only the shapes
 * a caller asks for are listed; they are literals so Tailwind sees them.
 */
const GRID: Record<string, string> = {
  // The roadtrip band: six cells, two / three / six, so every row is full.
  "2/3/6": "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
  // The journey band: seven cells, two / four / seven. Four across `sm` is a
  // decision, not a default: forcing the roadtrip's three would make seven
  // cells THREE rows, which reads less like the reference's two than four does.
  // The trailing seventh cell spans the remainder (see `spanClasses`).
  "2/4/7": "grid-cols-2 sm:grid-cols-4 xl:grid-cols-7",
};

/**
 * The span classes per breakpoint, by span width. Literal strings, for the same
 * purge reason as `GRID`: `col-span-2` must appear verbatim for Tailwind to
 * generate it, and `"col-span-" + 2` does not count. Width 1 is the RESET a
 * wider breakpoint needs when an earlier one spanned the last cell and this one
 * should not: an unprefixed `col-span-2` keeps applying at every width until a
 * later breakpoint overrides it, so "no class" is not "span one". The base row
 * has no reset because one track is the grid's own default.
 */
const SPAN: readonly (readonly string[])[] = [
  ["", "", "col-span-2"],
  ["", "sm:col-span-1", "sm:col-span-2", "sm:col-span-3", "sm:col-span-4"],
  [
    "",
    "xl:col-span-1",
    "xl:col-span-2",
    "xl:col-span-3",
    "xl:col-span-4",
    "xl:col-span-5",
    "xl:col-span-6",
    "xl:col-span-7",
  ],
];

/**
 * The class fragments that make the LAST cell fill its row at each breakpoint.
 *
 * `n % cols` is the number of tracks left empty in the last row, so the cell
 * spans `cols - remainder + 1` — one for itself plus the emptiness. A class is
 * emitted only where that span DIFFERS from the one still in force from the
 * narrower breakpoint, so a reset (`xl:col-span-1`) is written exactly where a
 * span taken below would otherwise leak into a full row: without it the journey
 * band's album cell would still span two of the seven `xl` tracks and wrap onto
 * a second row. A full last row at EVERY breakpoint contributes nothing, which
 * is why the roadtrip band's six cells come out byte-identical to before this
 * component owned them, while its undated FIVE (Days is left out, not drawn as
 * a zero) close their own hole the same way.
 */
function spanClasses(n: number, columns: readonly [number, number, number]): string {
  const classes: string[] = [];
  let inForce = 1;
  columns.forEach((cols, index) => {
    const remainder = n % cols;
    // The width the last cell must take to fill this breakpoint's last row: one
    // for the cell plus however many tracks are left empty beside it.
    const span = remainder === 0 ? 1 : cols - remainder + 1;
    if (span !== inForce) {
      const cls = SPAN[index][span] ?? "";
      if (cls) classes.push(cls);
      inForce = span;
    }
  });
  return classes.join(" ");
}

export default function FigureBand({
  cells,
  columns,
  caption,
}: {
  cells: readonly FigureBandCell[];
  /**
   * Columns at base / `sm` / `xl`. Omitted for a band that follows its own cell
   * count instead — the single-flight page's, whose cells are optional and so
   * can number anywhere from two to six.
   */
  columns?: readonly [number, number, number];
  /** The caption row under the band. Absent draws no row at all. */
  caption?: ReactNode;
}): JSX.Element | null {
  if (cells.length === 0) return null;

  const gridClass = columns ? GRID[columns.join("/")] : undefined;
  const lastSpan = columns && gridClass ? spanClasses(cells.length, columns) : "";
  // The count-derived fallback: a band of five does not leave a hole beside it.
  const fixedColumns = Math.min(6, Math.max(2, cells.length));

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <dl
        className={gridClass ? `grid overflow-hidden ${gridClass}` : "grid overflow-hidden"}
        style={{
          ...(gridClass ? {} : { gridTemplateColumns: `repeat(${fixedColumns}, minmax(0, 1fr))` }),
          gap: 1,
          background: "var(--ts-border)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
        }}
      >
        {cells.map((cell, index) => (
          <div
            key={cell.key}
            className={`flex min-w-0 flex-col${
              index === cells.length - 1 && lastSpan ? ` ${lastSpan}` : ""
            }`}
            style={{ background: "var(--ts-surface)", padding: "var(--ts-space-lg)", gap: 4 }}
            title={cell.title}
          >
            <dt className="t-label-mono">{cell.label}</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--ts-font-mono)",
                fontSize: 22,
                fontWeight: 600,
                color: cell.hue ?? "var(--ts-text-bright)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {cell.value}
            </dd>
            {cell.sub && (
              <dd className="t-caption" style={{ margin: 0 }}>
                {cell.sub}
              </dd>
            )}
          </div>
        ))}
      </dl>
      {caption !== undefined && (
        <div
          className="flex flex-wrap items-center t-caption"
          style={{ gap: "var(--ts-space-lg)" }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
