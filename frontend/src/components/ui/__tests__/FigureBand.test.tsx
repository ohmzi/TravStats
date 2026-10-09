import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import FigureBand from "../FigureBand";

/** `n` throwaway cells — the band's own content never matters to its grid. */
function cells(n: number): { key: string; label: string; value: string }[] {
  return Array.from({ length: n }, (_, i) => ({ key: `c${i}`, label: `L${i}`, value: String(i) }));
}

/** Every cell of the band, in order. */
function bandCells(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("dl > div")];
}

/**
 * The span the last cell's class list RESOLVES to at base / `sm` / `xl`, in the
 * order the cascade applies it: an unprefixed `col-span-N` holds at every width
 * until a `sm:` or `xl:` class overrides it. This — not the raw class list — is
 * what the browser computes, and asserting the raw list is what once let the
 * `xl` row bug through: a base `col-span-2` is invisible to a check for an
 * `xl:col-span` prefix while still spanning two tracks at `xl`.
 */
function effectiveSpans(className: string): [number, number, number] {
  const classes = className.split(/\s+/);
  const spanOf = (prefix: string): number | null => {
    const hit = classes.find((c) => c.startsWith(prefix));
    return hit ? Number(hit.slice(prefix.length)) : null;
  };
  const base = spanOf("col-span-") ?? 1;
  const sm = spanOf("sm:col-span-") ?? base;
  const xl = spanOf("xl:col-span-") ?? sm;
  return [base, sm, xl];
}

describe("FigureBand", () => {
  it("leaves a full last row alone — the roadtrip band's six, unchanged", () => {
    const { container } = render(<FigureBand cells={cells(6)} columns={[2, 3, 6]} />);
    // Two / three / six all divide six, so no cell spans and the roadtrip
    // band's markup is exactly what it was before this component owned it.
    expect(effectiveSpans(bandCells(container)[5].className)).toEqual([1, 1, 1]);
    expect(bandCells(container)[5].className).not.toMatch(/col-span/);
  });

  it("spans the last cell where a row would be short, and RESETS it where the row fills — the journey band's seven", () => {
    const { container } = render(<FigureBand cells={cells(7)} columns={[2, 4, 7]} />);
    const band = bandCells(container);
    const last = band[band.length - 1];
    // Seven against two / four is a track short at base and `sm`, so the album
    // spans two; against seven the row is FULL, so the span must be reset to
    // one — `xl:col-span-1` is the whole point, and without it the album wraps
    // onto a second row at `xl`.
    expect(effectiveSpans(last.className)).toEqual([2, 2, 1]);
    expect(last.className).toContain("xl:col-span-1");
  });

  it("closes the roadtrip band's undated five-cell hole the same way", () => {
    const { container } = render(<FigureBand cells={cells(5)} columns={[2, 3, 6]} />);
    const band = bandCells(container);
    const last = band[band.length - 1];
    // Five against two / three / six is short of a full row at every width, so
    // one `col-span-2` holds all the way up and no reset is written.
    expect(effectiveSpans(last.className)).toEqual([2, 2, 2]);
  });

  it("draws the caption row only when it is handed one", () => {
    const { rerender } = render(<FigureBand cells={cells(3)} />);
    expect(screen.queryByText("Great-circle estimate")).toBeNull();

    rerender(<FigureBand cells={cells(3)} caption={<span>Great-circle estimate</span>} />);
    expect(screen.getByText("Great-circle estimate")).toBeInTheDocument();
  });

  it("renders nothing at all for an empty band", () => {
    const { container } = render(<FigureBand cells={[]} columns={[2, 3, 6]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
