/**
 * The list chrome draws from tokens, and the row action keeps its hit area.
 *
 * Two separate risks, in one file because they are one change:
 *
 * 1. The seven files below carried 45 references to the legacy palette. A
 *    token swap is mechanical right up to the one value that is not in the
 *    token set, at which point a hex literal appears — so the absence of a
 *    hex or legacy reference is asserted, not just the presence of tokens.
 * 2. RowActionButton is the ONLY control in a table row. DESIGN_SYSTEM.md
 *    §4.5 keeps a 44 px hit area on coarse pointers even where a dense table
 *    drops the visual height to 36 — and the target device is a tablet
 *    (owner, 2026-09-28). A token swap that discards the coarse-pointer rule
 *    makes every row action untappable on the device this app is drawn for,
 *    and no type or unit test would notice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHROME_FILES = [
  "RowActionButton.tsx",
  "ListFilterBar.tsx",
  "ColumnPicker.tsx",
  "TablePagination.tsx",
  "ListEmptyState.tsx",
  "SortableHeader.tsx",
  "ListLoadFailed.tsx",
];

const LEGACY = [
  "--accent",
  "--color-border",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--bg-base",
  "--bg-surface",
  "--bg-elevated",
  "--bg-muted",
  "--danger",
  "--success",
  "--warning",
];

const read = (name: string) => readFileSync(join(__dirname, "..", name), "utf8");

describe("the logbook list chrome", () => {
  it.each(CHROME_FILES)("%s reads tokens only", (file) => {
    const source = read(file);
    for (const token of LEGACY) {
      // The token is legacy when it stands on its own: `var(--accent)` and
      // `bg-(--bg-surface)` both fail this, while the design-system family
      // `--ts-accent` / `--ts-text-muted` passes, because a `-ts-` sits before
      // the name. A bare `\b` after the name cannot tell the two apart — the
      // boundary between `t` and `-` is a word boundary in both — so the guard
      // is a negative lookbehind on the `-ts-` prefix instead. The `LEGACY`
      // entries already carry their leading dashes, so the pattern starts with
      // the lookbehind, not another `--`.
      expect(source, `${file} still reads ${token}`).not.toMatch(
        new RegExp(`(?<!-ts-)${token}\\b`)
      );
    }
    expect(source, `${file} still wears a .btn-* utility`).not.toMatch(
      /\bbtn-(?:primary|secondary|danger)\b/
    );
    expect(source, `${file} writes a hex colour`).not.toMatch(/(?<![\w-])#[0-9a-fA-F]{6,8}/);
  });
});

describe("RowActionButton", () => {
  it("keeps a 44px hit area under a coarse pointer", () => {
    const source = read("RowActionButton.tsx");
    expect(source).toContain("--ts-size-touch-min");
    expect(source).toMatch(/pointer-coarse:|useCoarsePointer/);
  });
});
