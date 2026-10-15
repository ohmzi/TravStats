#!/usr/bin/env node
/**
 * Action-consistency ratchet.
 *
 * THE RULE
 *   The design system (`frontend/src/theme/tokens.css`, `frontend/src/components/ui/`)
 *   replaced the palette in `frontend/src/index.css`, and DESIGN_SYSTEM.md §6 states
 *   the contract in one line: "Every primitive reads tokens only; a page never styles
 *   a card, button, pill or dialog frame itself."
 *
 *   DESIGN_SYSTEM.md §10 named four checks to land with that migration. One was
 *   written (`generate-theme.mjs`). Of the other three, two are here — the
 *   raw-Tailwind-palette scan and the `fixed inset-0` scan. The hex-literal scan
 *   is not, yet: a bare `#[0-9a-fA-F]{3,8}` also matches every issue reference
 *   in a comment (`forgejo#250`, `#257`), so it needs a guard before it can be
 *   a ratchet rather than a source of false failures. Task 2 of the
 *   2026-10-14 plan adds it.
 *
 *   Two further rules are here that §10 did not name, because the 2026-10-14
 *   inventory found them carrying the drift: the legacy palette `index.css`
 *   defines, and the pre-redesign `.btn-*` utilities.
 *
 *   Four rules, each a per-file COUNT frozen in the baseline:
 *     - legacy-palette        a token `index.css` defines and the design system replaced
 *     - legacy-button-utility `.btn-primary` / `.btn-secondary` / `.btn-danger`
 *     - hand-rolled-overlay   `fixed inset-0` outside the one shell that owns it
 *     - raw-tailwind-palette  `text-red-600`, `bg-slate-800`, `dark:` and friends
 *
 *   A baselined file may shrink freely and may never grow. A file that is not
 *   listed gets zero. An entry that reaches zero — or whose file is gone — is a
 *   hard failure, so every list can only ever get shorter. Same shape as
 *   `check-file-size.mjs`, for the same reason: the alternative is one unreviewable
 *   rewrite that collides with every open branch, and the numbers come down
 *   opportunistically instead — whoever is already editing one of these files pays a
 *   few lines of cleanup rather than a dedicated migration nobody schedules.
 *
 * WHY COUNTS AND NOT A FLAG
 *   "Is this file migrated" is a yes/no that flips once and then tells you nothing.
 *   A count lets a half-migrated 900-line component record progress, which is the
 *   only kind of progress this migration actually makes.
 *
 * USAGE
 *   node scripts/check-action-consistency.mjs            verify (exit 0 green, 1 red)
 *   node scripts/check-action-consistency.mjs --report   counts only, no baseline
 *   node scripts/check-action-consistency.mjs --update   rewrite the baseline; refuses
 *                                                        to raise any entry, so even
 *                                                        the convenience path cannot
 *                                                        loosen the ratchet
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BASELINE_PATH = join(SCRIPT_DIR, "action-consistency-baseline.json");

/** The design system lives here; it defines the tokens everything else must read. */
const SCAN_ROOT = "frontend/src";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css"];

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "generated", "__tests__"]);

/**
 * The one shell that owns an overlay, and the two files that are allowed to name
 * the legacy palette because they ARE it. Everything else is drift.
 */
const OVERLAY_HOME = "frontend/src/components/ui/Dialog.tsx";
const LEGACY_PALETTE_HOME = "frontend/src/index.css";
const DESIGN_SYSTEM_HOME = "frontend/src/theme/";

/**
 * The legacy palette: the bare names `index.css` defines, which the design system
 * superseded with the `--ts-` family. `--accent` is listed alone because it is also
 * the prefix of `--accent-dim`, `--accent-glow` and `--accent-soft`, and one hit per
 * reference is what we want to count. `--border` is deliberately NOT here: it is a
 * bridge that resolves to `var(--ts-border)`, so `border-border` is already correct.
 */
const LEGACY_TOKENS = [
  "accent",
  "color-border",
  "text-primary",
  "text-secondary",
  "text-muted",
  "bg-base",
  "bg-surface",
  "bg-elevated",
  "bg-muted",
  "danger",
  "success",
  "warning",
];

const TAILWIND_PALETTE_FAMILIES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

const TAILWIND_PALETTE_PROPERTIES = [
  "text",
  "bg",
  "border",
  "from",
  "to",
  "via",
  "ring",
  "fill",
  "stroke",
  "divide",
  "outline",
  "decoration",
  "placeholder",
  "shadow",
  "accent",
  "caret",
];

const RULES = [
  {
    id: "legacy-palette",
    title: "LEGACY PALETTE — a token the design system replaced",
    remedy:
      "Read the token from `theme/tokens.css` instead: --ts-accent, --ts-border, " +
      "--ts-text, --ts-muted, --ts-surface, --ts-bg, --ts-bad, --ts-warn, --ts-good.",
    pattern: new RegExp(`--(?:${LEGACY_TOKENS.join("|")})\\b`, "g"),
    excluded: (path) => path.startsWith(DESIGN_SYSTEM_HOME) || path === LEGACY_PALETTE_HOME,
  },
  {
    id: "legacy-button-utility",
    title: "LEGACY BUTTON UTILITY — the pre-redesign `.btn-*` classes",
    remedy:
      'Render `ui/Button` (variant + `size="toolbar"` for a row), or `ui/ActionLink` ' +
      "for a destination. `TOOLBAR_CONTROL_STYLE` is spread, never retyped.",
    pattern: /\bbtn-(?:primary|secondary|danger)\b/g,
    excluded: (path) => path === LEGACY_PALETTE_HOME,
  },
  {
    id: "hand-rolled-overlay",
    title: "HAND-ROLLED OVERLAY — `fixed inset-0` outside the shell that owns it",
    remedy:
      "Use `ui/Dialog` (a question and one action) or `ui/Modal` (a frame with a " +
      "scrolling body). Both take their Escape, focus trap and docking from " +
      "`useDialogChrome`; a copy of them is a copy that drifts.",
    pattern: /\bfixed\s+inset-0\b/g,
    excluded: (path) => path === OVERLAY_HOME,
  },
  {
    id: "raw-tailwind-palette",
    title: "RAW TAILWIND PALETTE — a colour that bypasses every token",
    remedy:
      "No palette colour belongs in a component, and the app is dark-only so `dark:` " +
      "is meaningless. Take the value from `theme/tokens.css`; if the token you need " +
      "is missing, it belongs in design/tokens.json first.",
    pattern: new RegExp(
      `\\b(?:${TAILWIND_PALETTE_PROPERTIES.join("|")})-(?:${TAILWIND_PALETTE_FAMILIES.join(
        "|"
      )})-\\d{2,3}\\b|\\bdark:`,
      "g"
    ),
    excluded: (path) => path.startsWith(DESIGN_SYSTEM_HOME),
  },
];

/** Repo-relative, forward slashes — the baseline is read on Windows and Linux alike. */
function toRepoRelative(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join("/");
}

function collectSourceFiles(absoluteDir, collected) {
  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    // A scan root may legitimately be absent in a partial checkout.
    return collected;
  }

  for (const entry of entries) {
    const absolutePath = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      collectSourceFiles(absolutePath, collected);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    collected.push(toRepoRelative(absolutePath));
  }
  return collected;
}

function countMatches(absolutePath, rule) {
  const content = readFileSync(absolutePath, "utf8");
  return (content.match(rule.pattern) ?? []).length;
}

/** The measured offender map for one rule: `{ "frontend/src/x.tsx": 4 }`, offenders only. */
function measureRule(rule, files) {
  const measured = {};
  for (const repoRelativePath of files) {
    if (rule.excluded(repoRelativePath)) continue;
    const count = countMatches(join(REPO_ROOT, repoRelativePath), rule);
    if (count > 0) measured[repoRelativePath] = count;
  }
  return measured;
}

function measureAll(files) {
  return Object.fromEntries(RULES.map((rule) => [rule.id, measureRule(rule, files)]));
}

function readBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE_PATH, "utf8");
  } catch {
    return {};
  }
  return JSON.parse(raw).rules ?? {};
}

/** Sorted by count descending, so the file most worth migrating is the one you read first. */
function sortByCountDescending(entries) {
  return Object.fromEntries(
    Object.entries(entries).sort(([pathA, countA], [pathB, countB]) =>
      countA === countB ? pathA.localeCompare(pathB) : countB - countA
    )
  );
}

function writeBaseline(measured) {
  const document = {
    $comment:
      "Generated by scripts/check-action-consistency.mjs. Per-file occurrences of each " +
      "rule, frozen at their count on 2026-10-14. Entries may shrink or disappear, never " +
      "grow. Do not add entries by hand.",
    rules: Object.fromEntries(
      RULES.map((rule) => [rule.id, sortByCountDescending(measured[rule.id] ?? {})])
    ),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function verifyRule(rule, measured, baseline) {
  const grew = [];
  const stale = [];
  const shrank = [];

  for (const [path, count] of Object.entries(measured)) {
    const allowed = baseline[path];
    if (allowed === undefined) grew.push({ path, count, allowed: 0 });
    else if (count > allowed) grew.push({ path, count, allowed });
    else if (count < allowed) shrank.push({ path, count, allowed });
  }

  // An entry whose file is clean, or gone, has done its job and must leave the list.
  for (const [path, allowed] of Object.entries(baseline)) {
    if ((measured[path] ?? 0) === 0) stale.push({ path, count: measured[path] ?? 0, allowed });
  }

  return { grew, stale, shrank };
}

/**
 * The entries an `--update` would RAISE. The ratchet's whole guarantee is that
 * this list is refused rather than recorded, so `--update` cannot be used to
 * launder a regression — without this check the convenience path is a way to
 * lower the ratchet one "I'll fix it later" at a time.
 */
function wouldRaise(rule, measured, baseline) {
  const raises = [];
  for (const [path, count] of Object.entries(measured)) {
    const allowed = baseline[path];
    if (allowed !== undefined && count > allowed) raises.push({ path, count, allowed });
  }
  return raises;
}

function reportFindings(title, remedy, findings) {
  if (findings.length === 0) return;
  console.error(`\n${title} (${findings.length})`);
  console.error(`  ${remedy}`);
  for (const { path, count, allowed } of findings) {
    console.error(`    ${path}\n      actual: ${count}   allowed: ${allowed}`);
  }
}

function report() {
  const files = collectSourceFiles(join(REPO_ROOT, SCAN_ROOT), []);
  const measured = measureAll(files);
  for (const rule of RULES) {
    const entries = Object.entries(measured[rule.id] ?? {});
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    console.log(`\n${rule.id}: ${total} occurrence(s) in ${entries.length} file(s)`);
    for (const [path, count] of entries.slice(0, 15)) console.log(`    ${count}\t${path}`);
    if (entries.length > 15) console.log(`    … and ${entries.length - 15} more file(s)`);
  }
  return 0;
}

function main() {
  const files = collectSourceFiles(join(REPO_ROOT, SCAN_ROOT), []);

  if (process.argv.includes("--report")) return report();

  const measured = measureAll(files);
  const baseline = readBaseline();

  if (process.argv.includes("--update")) {
    const wouldRaiseAll = [];
    for (const rule of RULES) {
      const raises = wouldRaise(rule, measured[rule.id] ?? {}, baseline[rule.id] ?? {});
      wouldRaiseAll.push(...raises);
    }

    if (wouldRaiseAll.length > 0) {
      reportFindings(
        "REFUSING TO UPDATE — these files grew past their baseline",
        "The baseline may only shrink. Migrate the file back down instead of re-recording it.",
        wouldRaiseAll
      );
      console.error("\nBaseline left untouched.\n");
      return 1;
    }

    writeBaseline(measured);
    const totalFiles = RULES.reduce(
      (sum, rule) => sum + Object.keys(measured[rule.id] ?? {}).length,
      0
    );
    console.log(`Baseline written: ${totalFiles} file entries across ${RULES.length} rules.`);
    return 0;
  }

  let failureCount = 0;
  for (const rule of RULES) {
    const { grew, stale, shrank } = verifyRule(
      rule,
      measured[rule.id] ?? {},
      baseline[rule.id] ?? {}
    );

    reportFindings(`${rule.title} — NEW OR GROWN`, rule.remedy, grew);
    reportFindings(
      `${rule.title} — STALE ENTRY, this file is clean and must leave the list`,
      'Run "npm run check:actions -- --update" and commit the baseline. The list only shrinks.',
      stale
    );

    if (shrank.length > 0) {
      console.log(
        `Note: ${rule.id} — ${shrank.length} file(s) improved. ` +
          'Run "npm run check:actions -- --update" to tighten the baseline.'
      );
    }
    failureCount += grew.length + stale.length;
  }

  if (failureCount > 0) {
    console.error(`\nFAIL: ${failureCount} action-consistency violation(s).\n`);
    return 1;
  }

  const totalFiles = RULES.reduce(
    (sum, rule) => sum + Object.keys(baseline[rule.id] ?? {}).length,
    0
  );
  console.log(
    `OK: ${files.length} file(s) scanned in ${SCAN_ROOT}, ` +
      `${totalFiles} baselined entr(ies) frozen across ${RULES.length} rules.`
  );
  return 0;
}

// Run only when invoked as a program. Importing this module (the test does)
// must not scan the tree or call process.exit — a bare `process.exit(main())`
// at module scope ends the importing process, which is how a "unit test" of
// this file would silently report success while testing nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { RULES, measureAll, verifyRule, wouldRaise, sortByCountDescending };
