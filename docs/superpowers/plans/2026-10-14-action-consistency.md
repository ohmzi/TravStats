# One action, one shape — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every action control in the web app the same control — `ui/Button`, `ui/ActionLink` or `ui/IconButton` — and put a ratchet in place so the migration cannot silently stop again.

**Architecture:** Two halves, in this order. First the *instrument*: `scripts/check-action-consistency.mjs` already exists and measures four rules, but has no baseline, no npm script and no CI wiring, so it enforces nothing. It lands first because everything after it would otherwise be free to regress. Then the *shared structures*, each of which lifts many call sites at once: `ConfirmModal` + `DELETE_BUTTON_CLASS` (35 call sites, 47 files), `components/table/*` (every logbook list page's chrome), and the page header (13 pages hand-roll what `PageHeader` already draws). The long tail is not swept — it comes down opportunistically under the ratchet.

**Tech Stack:** TypeScript, React 18, Vite, Vitest + Testing Library, Tailwind v4 (`@utility` in `frontend/src/theme/tokens.css`), Node ESM for the ratchet script, GitHub Actions + Forgejo Actions.

**Spec:** `docs/superpowers/specs/2026-10-14-action-consistency-design.md`

## Global Constraints

- **The design system is `frontend/src/components/ui/` + `frontend/src/theme/tokens.css`.** The legacy palette is `frontend/src/index.css`. A page never styles a card, button, pill or dialog frame itself (`design/DESIGN_SYSTEM.md` §6).
- **Two sizes only.** `default` = 52 px for a CTA that stands alone (`--ts-size-button-primary`); `toolbar` = 46 px for anything in a row (`--ts-size-button-secondary`). `TOOLBAR_CONTROL_STYLE` (`components/ui/Button.tsx:23`) is the one recipe and it is **spread, never retyped**.
- **Three variants only:** `primary`, `secondary`, `danger`. `danger` is a tinted outline, never a red fill.
- **Every behaviour change ships with a test that fails without it.** Where a test cannot see the thing (a height, a radius, a resolved colour), the test asserts the recipe — e.g. `expect(button.style.height).toBe("var(--ts-size-button-secondary)")` — the way `components/ui/__tests__/primitives.test.tsx` already does, and the change gets a browser look as well.
- **DE and EN move together.** A new key in one locale without its mirror fails `frontend/src/i18n/__tests__/localeKeyParity.test.ts`.
- **The ratchet only shrinks.** `node scripts/check-action-consistency.mjs --update` refuses to raise any entry. Every task that removes legacy from a baselined file must run `--update` and commit the tightened baseline in the same commit.
- **No source file over 800 lines** (`npm run check:size`). Prefer splitting over growing a file past its frozen size.
- **Comments justify, they do not describe.** Name the defect that appeared when the code was the other way.
- **Never run `taskkill` / kill processes.** If a port is busy, stop and report.
- **Commit before the session ends.** Conventional-commit subjects; branch is `dev/action-consistency`; **never** commit to `main`.
- **Build checks that must stay green:** `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`; `cd backend && npx tsc --noEmit && npm run lint`; `npx prettier --check .` from the root; `npm run check:size`.

## Review Focus

Five failure modes the spec implies but no test in it exercises. Each is pinned by a test in the task that owns the code, named below.

1. **A delete loses its danger cue.** `destructive` is an opt-in prop; a call site that omits it silently renders `primary` (amber) on a delete. 32 sites must set it. → Task 3.
2. **A confirm fires twice.** `isLoading` is what disables both footer buttons mid-flight; a converted call site that drops it re-enables the confirm button while the request is in the air. → Task 3.
3. **A page header conversion drops a control.** Several of the 13 hand-rolled headers carry a `ColumnPicker` and one or two `Link`s beside the h1. A conversion that renders only the title deletes a control the user needs, with nothing failing. → Task 6.
4. **A row action loses its hit area.** `RowActionButton` is the only control in a table row; `DESIGN_SYSTEM.md` §4.5 keeps a 44 px hit area on coarse pointers even where the visual height drops to 36. A token swap that discards the coarse-pointer rule makes the action untappable on a tablet — which is the target device (owner, 2026-09-28). → Task 5.
5. **A legitimately different h1 gets forced into `PageHeader`.** The auth cards, the passport's print card and the `SetupPage` card are centred surfaces with a different job; and `PassportPage:194` is an `h1` inside the **printed** document. Converting those breaks layout or print. → Task 6.

This list is a *checklist*, and it is also a boundary: work outside Tasks 1–9 (the bulk of the legacy palette — 468 files) is deliberately **not** in this plan. The ratchet is what makes leaving it safe. Do not sweep it opportunistically mid-task; a task that touches a file incidentally may fix the lines it already touches, and no more.

---

### Task 1: The ratchet lands

The instrument from spec step 1. The script exists and measures correctly; it enforces nothing. This task gives it a baseline, a name to run under, a place in CI, and a test for its own logic — and corrects its header, which currently claims to implement DESIGN_SYSTEM.md §10's three checks while implementing four different ones and omitting the hex scan (that is Task 2).

**Files:**
- Modify: `scripts/check-action-consistency.mjs`
- Create: `scripts/action-consistency-baseline.json` (generated, then committed)
- Create: `scripts/check-action-consistency.test.mjs`
- Modify: `package.json` (root — add `check:actions`, extend `check`)
- Modify: `.github/workflows/ci.yml` (the `static` job, after the file-size step at line 106)
- Modify: `.forgejo/workflows/ci.yml` (the static job, after the file-size step at line 49)
- Modify: `CLAUDE.md` (the Enforced table, and the "Every change must be committed" area is not touched)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run check:actions` (exit 0 green, 1 red); `node scripts/action-consistency-baseline.json` as the frozen map; from the refactor, these named exports of `scripts/check-action-consistency.mjs`:
  - `RULES` — array of `{ id, title, remedy, pattern, excluded(path) }`
  - `measureAll(files: string[]): Record<ruleId, Record<repoRelativePath, number>>`
  - `verifyRule(rule, measured: Record<string, number>, baseline: Record<string, number>): { grew: Finding[], stale: Finding[], shrank: Finding[] }` where `Finding = { path, count, allowed }`
  - `wouldRaise(rule, measured, baseline): Finding[]`
  - `sortByCountDescending(entries): Record<string, number>`

- [ ] **Step 1: Refactor the script so its logic is importable**

`scripts/check-action-consistency.mjs` currently ends with a bare `process.exit(main())` at module scope, so importing it runs the CLI and kills the test process. Guard the entry point and export the pure functions. Add `import { pathToFileURL } from "node:url";` to the existing import from `node:url`, then replace the final line:

```js
// Run only when invoked as a program. Importing this module (the test does)
// must not scan the tree or call process.exit — a bare `process.exit(main())`
// at module scope ends the importing process, which is how a "unit test" of
// this file would silently report success while testing nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { RULES, measureAll, verifyRule, sortByCountDescending };
```

Then add a `wouldRaise` export and use it from `main()`. Replace the inline block inside `if (process.argv.includes("--update"))` with a call:

```js
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
```

and in `main()`:

```js
    for (const rule of RULES) {
      const raises = wouldRaise(rule, measured[rule.id] ?? {}, baseline[rule.id] ?? {});
      wouldRaiseAll.push(...raises);
    }

    if (wouldRaiseAll.length > 0) {
```

(rename the local `wouldRaise` array to `wouldRaiseAll` so it does not shadow the function), and add `wouldRaise` to the `export` statement.

Also correct the header. Replace the paragraph beginning `*   DESIGN_SYSTEM.md §10 named four checks to land with that migration.` with:

```
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
```

- [ ] **Step 2: Write the failing test for the ratchet's logic**

Create `scripts/check-action-consistency.test.mjs`:

```js
/**
 * The ratchet's own logic, tested as a unit.
 *
 * Every guarantee this file makes is a comparison between two maps, and each
 * comparison has exactly one wrong direction that would be silent:
 *
 *   - a grown count reported as fine — the ratchet stops ratcheting, which is
 *     the failure the whole design exists to prevent;
 *   - a clean file left in the baseline — the list stops shrinking, and the
 *     stale entry fails a later, unrelated change;
 *   - `--update` raising an entry — the convenience path becomes the way to
 *     launder a regression.
 *
 * None of those is visible from a green run, so each is pinned here.
 */
import { describe, it, expect } from "vitest";
import {
  RULES,
  verifyRule,
  wouldRaise,
  sortByCountDescending,
} from "./check-action-consistency.mjs";

const legacyRule = RULES.find((rule) => rule.id === "legacy-palette");
const buttonRule = RULES.find((rule) => rule.id === "legacy-button-utility");

describe("verifyRule", () => {
  it("fails a file that grew past its baseline", () => {
    const { grew } = verifyRule(legacyRule, { "a.tsx": 5 }, { "a.tsx": 3 });
    expect(grew).toEqual([{ path: "a.tsx", count: 5, allowed: 3 }]);
  });

  it("fails a file that is not in the baseline at all", () => {
    const { grew } = verifyRule(legacyRule, { "new.tsx": 1 }, {});
    expect(grew).toEqual([{ path: "new.tsx", count: 1, allowed: 0 }]);
  });

  it("fails a baselined file whose count reached zero, so the list can only shrink", () => {
    const { stale } = verifyRule(legacyRule, {}, { "clean.tsx": 4 });
    expect(stale).toEqual([{ path: "clean.tsx", count: 0, allowed: 4 }]);
  });

  it("fails a baselined file that no longer exists", () => {
    const { stale } = verifyRule(legacyRule, {}, { "deleted.tsx": 2 });
    expect(stale).toEqual([{ path: "deleted.tsx", count: 0, allowed: 2 }]);
  });

  it("passes an unchanged baseline, and reports an improvement without failing it", () => {
    const { grew, stale, shrank } = verifyRule(legacyRule, { "a.tsx": 3 }, { "a.tsx": 3 });
    expect(grew).toEqual([]);
    expect(stale).toEqual([]);
    expect(shrank).toEqual([]);

    const improved = verifyRule(legacyRule, { "a.tsx": 2 }, { "a.tsx": 3 });
    expect(improved.grew).toEqual([]);
    expect(improved.shrank).toEqual([{ path: "a.tsx", count: 2, allowed: 3 }]);
  });
});

describe("wouldRaise", () => {
  it("refuses to raise an entry, which is what makes --update safe", () => {
    expect(wouldRaise(legacyRule, { "a.tsx": 6 }, { "a.tsx": 3 })).toEqual([
      { path: "a.tsx", count: 6, allowed: 3 },
    ]);
  });

  it("allows a new entry and a shrunken one", () => {
    expect(wouldRaise(legacyRule, { "new.tsx": 9, "a.tsx": 1 }, { "a.tsx": 3 })).toEqual([]);
  });
});

describe("the rules themselves", () => {
  it("counts one occurrence per reference, not per line", () => {
    const counted = "color: var(--text-muted); background: var(--bg-muted);";
    expect((counted.match(legacyRule.pattern) ?? []).length).toBe(2);
  });

  it("does not read a --ts-* token as the legacy token it ends with", () => {
    // `--ts-text-primary` ends in `text-primary`. If the rule matched there it
    // would report every MIGRATED file as offender, which inverts the ratchet.
    expect(("color: var(--ts-text-primary)").match(legacyRule.pattern)).toBeNull();
  });

  it("keeps the legacy palette out of the design system itself", () => {
    expect(legacyRule.excluded("frontend/src/theme/tokens.css")).toBe(true);
    expect(legacyRule.excluded("frontend/src/index.css")).toBe(true);
    expect(legacyRule.excluded("frontend/src/pages/FerryPage.tsx")).toBe(false);
  });

  it("recognises the pre-redesign button utilities, and not a lookalike class", () => {
    expect(("className=\"btn-primary\"").match(buttonRule.pattern)).toEqual(["btn-primary"]);
    // `\b` after `primary` sits between `y` and `i` — both word characters, so
    // there is no boundary and no match. That is the right behaviour: the rule
    // catches utilities, and a substring match would also flag prose.
    expect(("className=\"btn-primaryish\"").match(buttonRule.pattern)).toBeNull();
  });
});

describe("sortByCountDescending", () => {
  it("puts the file most worth migrating first, and breaks ties by path", () => {
    const sorted = sortByCountDescending({ "b.tsx": 1, "a.tsx": 5, "c.tsx": 1 });
    expect(Object.keys(sorted)).toEqual(["a.tsx", "b.tsx", "c.tsx"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes against the refactor**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run ../scripts/check-action-consistency.test.mjs`

Vitest is configured with a `frontend` root; if it refuses a file outside the root, run instead:

Run: `cd /home/ohmz/StudioProjects/TravStats-fork && npx --prefix frontend vitest --run --root scripts scripts/check-action-consistency.test.mjs`

Expected: PASS, 12 tests. If the import fails with "does not provide an export named", Step 1's `export` statement was not applied.

- [ ] **Step 4: Generate the baseline and verify the ratchet turns green**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
node scripts/check-action-consistency.mjs --update
node scripts/check-action-consistency.mjs
```

Expected: `--update` prints `Baseline written: <N> file entries across 4 rules.`; the verify run prints `OK: <N> file(s) scanned in frontend/src, …`.

Record the counts in the commit message. Baseline on 2026-10-14 measured **3838 legacy-palette occurrences in 468 files, 222 button-utility occurrences in 112 files, 12 hand-rolled overlays in 12 files, 262 raw-palette occurrences in 53 files** — the numbers must be in that neighbourhood; a large divergence means the scan root moved.

- [ ] **Step 5: Prove the ratchet actually fails**

Do not skip this — a ratchet that cannot fail is worse than none, because it reads as coverage.

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
cp scripts/action-consistency-baseline.json /tmp/ac-baseline-backup.json
node -e '
const p="scripts/action-consistency-baseline.json";
const fs=require("fs");const d=JSON.parse(fs.readFileSync(p,"utf8"));
const k=Object.keys(d.rules["legacy-palette"]).filter(f=>d.rules["legacy-palette"][f]>1)[0];
d.rules["legacy-palette"][k]-=1;fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("lowered",k);'
node scripts/check-action-consistency.mjs; echo "exit=$?"
cp /tmp/ac-baseline-backup.json scripts/action-consistency-baseline.json
node scripts/check-action-consistency.mjs; echo "exit=$?"
```

Expected: the first run exits 1 with a `STALE ENTRY` block naming that file; the second exits 0. Deleting a baseline entry entirely must also fail — try it once if you want the other direction.

- [ ] **Step 6: Wire it into npm and both CIs**

In the root `package.json`, after the `check:size` line:

```json
    "check:size": "node scripts/check-file-size.mjs",
    "check:actions": "node scripts/check-action-consistency.mjs",
```

and extend the aggregate (no database needed, unlike `check:drift`):

```json
    "check": "npm run check:size && npm run check:actions && npm run check:drift",
```

In `.github/workflows/ci.yml`, in the `static` job immediately after the `File-size ratchet` step (line 106):

```yaml
      # The same shape as the file-size ratchet above: a frozen per-file list
      # that may only shrink. It is in `static` rather than a job of its own
      # because it reads the source tree and nothing else.
      - name: Action-consistency ratchet
        run: npm run check:actions
```

In `.forgejo/workflows/ci.yml`, in the static job immediately after the `File-size ratchet` step (line 49), the same step:

```yaml
      - name: Action-consistency ratchet
        run: npm run check:actions
```

- [ ] **Step 7: Record it in CLAUDE.md**

In the **Enforced** table, add a row after the file-size row:

```markdown
| No new legacy-palette token, `.btn-*` utility, hand-rolled `fixed inset-0` overlay or raw Tailwind palette colour in `frontend/src` | `scripts/check-action-consistency.mjs` (`npm run check:actions`) — a per-file count frozen in `scripts/action-consistency-baseline.json`; entries shrink or leave the list, never grow |
```

Adjust the sentence below the table that counts the ratchets — it currently says "Six of these are **ratchets**". It becomes seven, and the hex rule (Task 9) makes nine. Write the number that is true when you commit; the sentence names the offenders' shape, so it must list `action-consistency` among them.

- [ ] **Step 8: Run the full frontend gate and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
npx --prefix frontend prettier --check --ignore-unknown scripts/check-action-consistency.mjs scripts/check-action-consistency.test.mjs scripts/action-consistency-baseline.json package.json .github/workflows/ci.yml .forgejo/workflows/ci.yml
npm run check:size && npm run check:actions
```

If Prettier objects, run `npx --prefix frontend prettier --write --ignore-unknown <the same paths>` and re-check. Then:

```bash
git add scripts/check-action-consistency.mjs scripts/check-action-consistency.test.mjs scripts/action-consistency-baseline.json package.json .github/workflows/ci.yml .forgejo/workflows/ci.yml CLAUDE.md docs/superpowers/specs/2026-10-14-action-consistency-design.md
git commit -m "chore(design): land the action-consistency ratchet with a frozen baseline

The script that measures the four kinds of drift existed and enforced
nothing: no baseline, no npm script, no CI step. It is wired now, and
its own comparisons are tested, because each of them has one silent
wrong direction — a grown count reported as fine, a clean file left on
the list, an --update that raises an entry.

Baseline on 2026-10-14: 3838 legacy-palette occurrences in 468 files,
222 button-utility occurrences in 112 files, 12 hand-rolled overlays,
262 raw-palette occurrences in 53 files. Entries may shrink or leave
the list. --update refuses to raise one."
```

Note the spec is added to this commit — it is untracked and belongs with the work it describes.

---

### Task 2: The hex-literal scan (§10's third check)

The spec and `design/DESIGN_SYSTEM.md` §10 both name a source scan refusing hex literals outside `theme/` and the map layers. It is absent, because a bare hex regex matches every issue reference in the codebase's comments — measured: `forgejo#250`, `#257`, `#36`, `#294` all match `#[0-9a-fA-F]{3,8}`. This task adds the rule **with a guard**, and the guard is the deliverable.

**Files:**
- Modify: `scripts/check-action-consistency.mjs`
- Modify: `scripts/check-action-consistency.test.mjs`
- Modify: `scripts/action-consistency-baseline.json` (regenerate)
- Modify: `CLAUDE.md` (the ratchet count)

**Interfaces:**
- Consumes: `RULES`, `verifyRule`, `wouldRaise` from Task 1.
- Produces: a fifth rule with `id: "code-hex-literal"` and the `excluded` predicate `isThemeOrMapLayer`, exported for the test:
  - `isThemeOrMapLayer(path: string): boolean`
  - `HEX_COLOUR_PATTERN: RegExp`

- [ ] **Step 1: Write the failing test that pins the guard**

Append to `scripts/check-action-consistency.test.mjs`:

```js
describe("the hex-literal rule", () => {
  const hexRule = RULES.find((rule) => rule.id === "code-hex-literal");
  const hits = (source) => source.match(hexRule.pattern) ?? [];

  it("exists", () => {
    expect(hexRule).toBeDefined();
  });

  it("does not read an issue reference as a colour", () => {
    // The reason this rule was missing for a month. `#[0-9a-fA-F]{3,8}`
    // matches `forgejo#250` and `#257` — every tracker reference in a comment
    // whose digits are hex-valid, which is all of them. A ratchet that froze
    // those would fail the next issue reference somebody wrote in a file it
    // had already baselined, and the honest response to a red build is to
    // write fewer comments.
    expect(hits("// the costs (forgejo#140) moved to the Logistics tab")).toEqual([]);
    expect(hits("// #257: a selected flight must not survive into the next render")).toEqual([]);
    expect(hits("* (forgejo#244): the page reads only the")).toEqual([]);
    expect(hits("see #36 and #294")).toEqual([]);
  });

  it("reads a real colour literal, quoted or not", () => {
    expect(hits('style={{ background: "var(--accent)", color: "#0d1117" }}')).toEqual(["#0d1117"]);
    expect(hits("<div style={{ color: 'var(--fx, #6ab7d8)' }}" )).toEqual(["#6ab7d8"]);
    expect(hits("background: #fff;") ).toEqual(["#fff"]);
  });

  it("reads the short form only when it carries a letter", () => {
    // `#fff` is a colour; `#333` and `#257` are both three decimal digits and
    // no regex can tell them apart, so neither is matched. The letter is the
    // only discriminator that costs zero false positives.
    expect(hits("border-color: #fff")).toEqual(["#fff"]);
    expect(hits("border-color: #333")).toEqual([]);
    expect(hits("border-color: #257")).toEqual([]);
  });

  it("leaves the theme and the map kit alone — they are the colour definitions", () => {
    expect(hexRule.excluded("frontend/src/theme/tokens.css")).toBe(true);
    expect(hexRule.excluded("frontend/src/theme/tokens.ts")).toBe(true);
    expect(hexRule.excluded("frontend/src/components/Globe/globeStyles.ts")).toBe(true);
    expect(hexRule.excluded("frontend/src/components/map/controlPanelKit.tsx")).toBe(true);
    expect(hexRule.excluded("frontend/src/pages/FerryPage.tsx")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork && npx --prefix frontend vitest --run --root scripts scripts/check-action-consistency.test.mjs`

Expected: FAIL — `hexRule` is `undefined`, so every assertion in the block throws. That is the "rule does not exist" failure.

- [ ] **Step 3: Add the rule**

In `scripts/check-action-consistency.mjs`, add above `RULES`:

```js
/**
 * A colour literal, and NOT an issue reference.
 *
 * The obvious pattern — `#[0-9a-fA-F]{3,8}` — counts `forgejo#250` and `#257`,
 * because every decimal digit is also a hex digit. This codebase's comments are
 * full of tracker references, so the naive version freezes hundreds of them and
 * then fails on the next one somebody writes. Three guards, each earning its
 * place:
 *
 *   1. `(?<![\w-])` — not preceded by a word character or a hyphen, which is
 *      what kills `forgejo#250` (the `o` precedes the `#`).
 *   2. The 6- and 8-digit forms are unambiguous: no issue number is written
 *      with six digits before a non-word character.
 *   3. The 3- and 4-digit forms must contain at least one a-f letter. `#fff`
 *      and `#f5f5` are colours; `#257`, `#36` and `#294` are issues, and every
 *      issue number in this repo is all-decimal. The letter is the only
 *      discriminator there is: `#333` and `#257` are the same string shape.
 *
 * What it therefore misses: an all-decimal short form such as `#333` or `#000`.
 * That is the deliberate trade — a miss costs one occurrence, a false positive
 * costs a red build on a comment.
 */
const HEX_COLOUR_PATTERN = new RegExp(
  "(?<![\\w-])#(?:" +
    "[0-9a-fA-F]{6,8}" +
    "|(?=[0-9a-fA-F]{3,4}(?![\\w-]))(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,4}" +
    ")(?![\\w-])",
  "g"
);

/** The design system defines the colours; the map kit sits over imagery, not over app surfaces. */
function isThemeOrMapLayer(path) {
  return (
    path.startsWith(DESIGN_SYSTEM_HOME) ||
    path === "frontend/src/index.css" ||
    path.startsWith("frontend/src/components/Globe/") ||
    path.startsWith("frontend/src/components/map/") ||
    path.startsWith("frontend/src/components/layers/")
  );
}
```

Note: the regex uses a lookbehind, which Node supports from v8.3 and every Node this repo builds on. If the target Node rejects it, the same guard is expressible with a capture group and `matchAll` — do that rather than dropping the guard.

Add the rule to `RULES`:

```js
  {
    id: "code-hex-literal",
    title: "HEX COLOUR LITERAL — a colour written past the token layer",
    remedy:
      "Take the value from `theme/tokens.css`; if the token you need is missing, it " +
      "belongs in design/tokens.json first. The map control kit and the globe are the " +
      "one exception, and are excluded by path.",
    pattern: HEX_COLOUR_PATTERN,
    excluded: isThemeOrMapLayer,
  },
```

and extend the export statement to include `HEX_COLOUR_PATTERN` and `isThemeOrMapLayer`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork && npx --prefix frontend vitest --run --root scripts scripts/check-action-consistency.test.mjs`

Expected: PASS. If the quoted-colour case fails, print what the pattern actually matched before changing the pattern — the likely cause is an `excluded` path, not the guard.

- [ ] **Step 5: Measure the real tree and sanity-check the result**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
node scripts/check-action-consistency.mjs --report 2>&1 | sed -n '/code-hex-literal/,$p' | head -30
```

Expected: on the order of a few hundred occurrences in a few hundred files, and **none of the top files may be there because of an issue reference**. Spot-check the top five by grepping the file for its matches:

```bash
grep -nE '(?<![\w-])#([0-9a-fA-F]{6,8}|(?=[0-9a-fA-F]{3,4}(?![\w-]))(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,4})(?![\w-])' -P frontend/src/<the top file> | head
```

If a file is listed because of `forgejo#NNN`-shaped text, the guard is wrong — fix the guard, do not baseline the noise.

- [ ] **Step 6: Re-freeze the baseline and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
node scripts/check-action-consistency.mjs --update
node scripts/check-action-consistency.mjs
npx --prefix frontend prettier --write --ignore-unknown scripts/check-action-consistency.mjs scripts/check-action-consistency.test.mjs scripts/action-consistency-baseline.json
git add scripts/check-action-consistency.mjs scripts/check-action-consistency.test.mjs scripts/action-consistency-baseline.json CLAUDE.md
git commit -m "chore(design): the hex-literal scan, with a guard for issue references

§10 asked for a scan refusing hex literals outside theme/ and the map
layers. Written naively it counts forgejo#250 and #257 — every tracker
reference whose digits are hex-valid, which is all of them — so it would
freeze hundreds of comment hits and then fail the next issue number
somebody wrote in a baselined file.

Three guards: not preceded by a word character, the 6/8-digit forms are
unambiguous, and the 3/4-digit forms must carry an a-f letter. That
misses an all-decimal short colour (#000) on purpose: a miss costs one
occurrence, a false positive costs a red build on a comment."
```

---

### Task 3: `ConfirmModal` takes a `destructive` flag; `DELETE_BUTTON_CLASS` retires

The single highest-leverage change in the plan: 35 JSX call sites, 47 files importing `DELETE_BUTTON_CLASS`, and every delete confirmation in the app. Today the destructive-ness of a confirm travels as a **CSS class string** — `confirmButtonClass={DELETE_BUTTON_CLASS}` — which is why `useConfirmDialog.tsx:81` passes `pending.destructive ? DELETE_BUTTON_CLASS : undefined` and why 4 files use the constant as a raw class on a bare `<button>`. It becomes a boolean, and the red fill dies.

**Files:**
- Modify: `frontend/src/components/Training/ConfirmModal.tsx`
- Modify: `frontend/src/components/Training/__tests__/ConfirmModal.test.tsx`
- Modify: `frontend/src/lib/deleteConfirm.ts:87-88` (delete the constant)
- Modify: `frontend/src/components/Modal.tsx:8, 260-280` (the discard footer)
- Modify: `frontend/src/hooks/useConfirmDialog.tsx:5, 72-84`
- Modify — 32 `confirmButtonClass={DELETE_BUTTON_CLASS}` → `destructive`: `pages/ToursPage.tsx:319,338`, `pages/CruiseDetailPage.tsx:416`, `pages/FerryDetailPage.tsx:238`, `pages/RentalsPage.tsx:386`, `pages/RailPage.tsx:410`, `pages/PlaceListDetailPage.tsx:633`, `pages/CruisesPage.tsx:551`, `pages/FlightDetailPage.tsx:542`, `pages/RentalDetailPage.tsx:420`, `pages/RailDetailPage.tsx:399`, `pages/LodgingListPage.tsx:729`, `pages/FerryPage.tsx:351`, `pages/BusPage.tsx:348`, `pages/BusDetailPage.tsx:350`, `pages/LodgingDetailPage.tsx:683`, `pages/PlaceDetailPage.tsx:548,583`, `pages/PlacesListPage.tsx:699`, `components/FlightPanel.tsx:438`, `components/flightsTable/FlightsTablePanel.tsx:743`, `components/Dashboard/tabs/FlightsTab.tsx:319`, `components/documents/DocumentsSection.tsx:421`, `components/Admin/UserManagement.tsx:256`, `components/Trips/TourTrackList.tsx:209`, `components/Trips/TripDeleteConfirm.tsx:53`, `components/lodging/StayDeleteConfirm.tsx:62`, `components/Cruise/CruiseTracksPanel.tsx:223`, `components/Roadtrips/RoadtripEditSections.tsx:79,94`, `components/Roadtrips/ExpenseDialog.tsx:407`, `components/Roadtrips/StationDraftBanner.tsx:59`
- Modify — the 4 raw-class users: `components/Cruise/CruiseStopActions.tsx:140`, `components/places/PlaceMergeDialog.tsx:180`, `components/Roadtrips/DraftFirstDialog.tsx:39`
- Modify: `scripts/action-consistency-baseline.json`
- Delete the import line from all 47 files that import `DELETE_BUTTON_CLASS`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `ConfirmModal` prop surface used by every later task and by Task 8:
  ```ts
  interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    /** The confirm button removes or destroys something — it wears `danger`. */
    destructive?: boolean;
    isLoading?: boolean;
  }
  ```
  `confirmButtonClass` is **removed**, not deprecated. A caller still passing it gets a TypeScript error, which is what makes the 35-site sweep complete rather than best-effort.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/Training/__tests__/ConfirmModal.test.tsx`:

```tsx
  it("wears the danger variant exactly when it is destructive", () => {
    // The prop this replaces was a CSS class string, so "is this delete" was
    // encoded as `bg-[var(--danger)] hover:opacity-90` at 32 call sites and as
    // a raw utility list at 4 more. A boolean is the same question asked once.
    const { unmount } = render(<ConfirmModal {...base} destructive />);
    expect(screen.getByRole("button", { name: "Endgültig löschen" })).toHaveAttribute(
      "data-variant",
      "danger"
    );
    unmount();

    render(<ConfirmModal {...base} />);
    expect(screen.getByRole("button", { name: "Endgültig löschen" })).toHaveAttribute(
      "data-variant",
      "primary"
    );
  });

  it("draws both footer buttons at the row height, not the lone-CTA height", () => {
    // They sit side by side. One 52 and one 46 is the drift the toolbar size
    // exists to end (owner, 2026-10-11: "all these should be same size").
    render(<ConfirmModal {...base} destructive />);
    for (const name of ["Endgültig löschen", "Abbrechen"]) {
      expect(screen.getByRole("button", { name }).style.height).toBe(
        "var(--ts-size-button-secondary)"
      );
    }
  });

  it("paints no hex or legacy token in its own markup", () => {
    // The ratchet's rule, asserted where it is cheap: the dialog every delete
    // in the app goes through is the one file that must be clean.
    const { container } = render(<ConfirmModal {...base} destructive />);
    expect(container.innerHTML).not.toMatch(/(?<![\w-])#[0-9a-fA-F]{6,8}/);
    expect(container.innerHTML).not.toContain("--text-muted");
    expect(container.innerHTML).not.toContain("btn-primary");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/components/Training/__tests__/ConfirmModal.test.tsx`

Expected: FAIL — `data-variant` is absent (the legacy buttons carry no such attribute), and the legacy token assertion fails on `--text-muted`.

- [ ] **Step 3: Rewrite `ConfirmModal`**

Replace the whole body of `frontend/src/components/Training/ConfirmModal.tsx` below the imports with:

```tsx
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  isLoading = false,
}: ConfirmModalProps): JSX.Element | null {
  const { t } = useTranslation(["training", "common"]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      busy={isLoading}
      title={title}
      maxWidth={512}
      testId="confirm-modal"
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <Button size="toolbar" onClick={onClose} disabled={isLoading}>
            {cancelText || t("common:buttons.cancel")}
          </Button>
          <Button
            size="toolbar"
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading
              ? t("training:modal.processing")
              : confirmText || t("common:buttons.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm whitespace-pre-line" style={{ color: "var(--ts-muted)" }}>
        {message}
      </p>
    </Modal>
  );
}
```

with imports `import Button from "../ui/Button";` and the interface updated. Delete `confirmButtonClass` from the interface. Extend the file's existing block comment with one paragraph naming the defect the boolean removes:

```
 * The destructive cue travelled as a CSS class (`confirmButtonClass`) until
 * 2026-10-14, which meant "this removes data" was spelled
 * `bg-[var(--danger)] hover:opacity-90` at 32 call sites and as a hand-written
 * utility list at 4 more — and nowhere was it typed. A caller that forgot the
 * class got an amber button on a delete and no error. It is `destructive`
 * now, the same question asked once, and the class constant is gone.
```

- [ ] **Step 4: Run the ConfirmModal test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/components/Training/__tests__/ConfirmModal.test.tsx`

Expected: PASS, all 12 tests (9 existing + 3 new).

- [ ] **Step 5: Sweep the 35 call sites**

For each of the 32 files listed above, replace `confirmButtonClass={DELETE_BUTTON_CLASS}` with `destructive` and delete the now-unused import. In `hooks/useConfirmDialog.tsx`, replace line 81 with `destructive={pending.destructive}` and delete its import at line 5. Watch for `FlightDetailPage.tsx:39`, `PlaceDetailPage.tsx:28`, `TripDeleteConfirm.tsx:7` and `StayDeleteConfirm.tsx:7`, which import `DELETE_BUTTON_CLASS` **alongside** a message helper — those files keep the import line but drop the one name.

Then let the compiler find what you missed:

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx tsc --noEmit
```

Expected: an error at every site still passing `confirmButtonClass`. Zero errors means the sweep is complete.

- [ ] **Step 6: Convert the four raw-class users**

Each of these renders a bare `<button>` wearing `DELETE_BUTTON_CLASS`. They are not `ConfirmModal` footers, so they take `ui/Button` directly:

- `components/Cruise/CruiseStopActions.tsx:140` → `<Button size="toolbar" variant="danger" onClick={…}>` keeping its existing label and handler; drop the `rounded-md px-2 py-1 text-xs … pointer-coarse:min-h-(--ts-size-touch-min)` class chain and the `COARSE`-style constant if it becomes unused.
- `components/places/PlaceMergeDialog.tsx:180` → `<Button size="toolbar" variant="danger" disabled={…}>` (merging deletes the duplicate — it is destructive).
- `components/Roadtrips/DraftFirstDialog.tsx:39` → `<Button size="toolbar" variant="danger">` (discarding a draft destroys the user's work).
- `frontend/src/components/Modal.tsx:260-280` — the discard footer. Both buttons become `ui/Button`, the confirm one destructive:

```tsx
          <Button size="toolbar" onClick={requestClose}>
            {t("common:discard.keepEditing")}
          </Button>
          <Button size="toolbar" variant="danger" onClick={onDiscard}>
            {discardLabel ?? t("common:discard.confirm")}
          </Button>
```

Use the `footer` render-prop's own close handler if that is what the surrounding code names it; read the block before editing.

- [ ] **Step 7: Delete the constant and prove nothing imports it**

Remove the last two lines of `frontend/src/lib/deleteConfirm.ts`:

```ts
/** Red confirm button — the same one on every delete dialog. */
export const DELETE_BUTTON_CLASS = "bg-[var(--danger)] hover:opacity-90";
```

```bash
cd /home/ohmz/StudioProjects/TravStats-fork && grep -rn "DELETE_BUTTON_CLASS" --include=*.ts --include=*.tsx frontend/src ; echo "exit=$?"
```

Expected: no output, `exit=1`. Any hit is a missed call site.

- [ ] **Step 8: Run the whole frontend suite and tighten the baseline**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd /home/ohmz/StudioProjects/TravStats-fork && node scripts/check-action-consistency.mjs --update && node scripts/check-action-consistency.mjs
npx --prefix frontend prettier --check --ignore-unknown frontend/src scripts
```

Expected: green. `--update` will shrink `legacy-button-utility` (the `.btn-primary` at `ConfirmModal`) and may shrink `legacy-palette` in the touched files. If `--update` **refuses**, a file grew — find it rather than loosening. Test files that render `ConfirmModal` may need `confirmButtonClass` replaced; the compiler and Vitest will name them.

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src scripts/action-consistency-baseline.json
git commit -m "refactor(design): a confirm dialog asks destructive, not for a CSS class

Every delete confirmation in the app goes through ConfirmModal, and the
one thing that differed between them — whether the button removes
something — travelled as a class string. 32 call sites passed
DELETE_BUTTON_CLASS, 4 passed a hand-written utility list, one passed it
conditionally, and a caller that forgot got an amber button on a delete
with nothing to catch it.

It is `destructive?: boolean` now, drawn as ui/Button variant=danger at
the toolbar height. The red fill retires, and the constant with it: the
compiler found the 35th site that a grep would have missed."
```

---

### Task 4: The last two hand-painted confirm buttons

Two call sites pass a literal Tailwind palette instead of the constant — the residue Task 3 does not reach because they never named `DELETE_BUTTON_CLASS`. They are also the only two confirm dialogs whose colour carries a meaning the three variants do not have.

**Files:**
- Modify: `frontend/src/components/Admin/UserManagement.tsx:239`
- Modify: `frontend/src/components/Admin/SmtpManager.tsx:318`
- Modify: `scripts/action-consistency-baseline.json`

**Interfaces:**
- Consumes: `ConfirmModal`'s `destructive` prop from Task 3.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Admin/__tests__/adminConfirmVariants.test.tsx`:

```tsx
/**
 * The two admin confirms that painted themselves.
 *
 * Both passed a raw Tailwind palette string to `confirmButtonClass` — the 2FA
 * reset in orange, the SMTP delete in red. Orange exists nowhere in the design
 * system (DESIGN_SYSTEM.md §2 has accent, good, warn, bad and nothing else), so
 * it was a fifth semantic colour invented by one dialog; and the red bypassed
 * the token layer to reach Tailwind's own red, which is a different red from
 * `--ts-bad`.
 *
 * Read as source rather than rendered, because the point is the absence of a
 * palette class in the call site — a render assertion could pass while a
 * leftover `text-white` sat beside it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string) =>
  readFileSync(join(__dirname, "..", "..", "..", relative), "utf8");

describe("the admin confirm dialogs", () => {
  it("paints neither of them from the Tailwind palette", () => {
    for (const file of ["components/Admin/UserManagement.tsx", "components/Admin/SmtpManager.tsx"]) {
      const source = read(file);
      for (const family of ["orange", "red", "slate", "gray", "zinc"]) {
        expect(
          source,
          `${file} still names a raw Tailwind ${family} colour`
        ).not.toMatch(new RegExp(`\\b(?:text|bg|border|ring|from|to|via)-${family}-\\d{2,3}\\b`));
      }
      expect(source, `${file} still passes confirmButtonClass`).not.toContain("confirmButtonClass");
    }
  });
});
```

Confirm the relative path arithmetic by reading the `__dirname` depth once — the test sits at `frontend/src/components/Admin/__tests__/`, so three `..` reaches `frontend/src/`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/components/Admin/__tests__/adminConfirmVariants.test.tsx`

Expected: FAIL on `UserManagement.tsx` naming `bg-orange-600`.

- [ ] **Step 3: Convert both**

`UserManagement.tsx:239` — the 2FA reset. Replace `confirmButtonClass="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500 text-white"` with `destructive`:

```tsx
        destructive
```

Two-factor reset removes a security factor from somebody's account and is reachable only by an admin acting on another person's account. It is destructive in the sense the variant means — it removes a protection the user set up — and orange is not available to say "careful" more precisely. Record that reasoning in the file's existing block comment or a short one above the dialog.

`SmtpManager.tsx:318` — the SMTP delete. Replace `confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white"` with `destructive`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/components/Admin/__tests__/adminConfirmVariants.test.tsx`

Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd /home/ohmz/StudioProjects/TravStats-fork && node scripts/check-action-consistency.mjs --update && node scripts/check-action-consistency.mjs
npx --prefix frontend prettier --write --ignore-unknown frontend/src/components/Admin
git add -A frontend/src/components/Admin scripts/action-consistency-baseline.json
git commit -m "fix(admin): the two admin confirms stop painting themselves

The 2FA reset asked for orange and the SMTP delete for Tailwind's red.
Orange is not a colour this system has, so one dialog had invented a
fifth semantic hue; the red was a different red from --ts-bad. Both are
destructive in the variant's sense, and both say so now.

The swap also takes the last raw palette classes out of those two files,
which the ratchet's raw-tailwind-palette rule can now record."
```

---

### Task 5: `components/table/*` onto the token layer

The logbook list pages' entire chrome — empty state, filter bar, column picker, pagination, row action — carries 45 legacy token references and one `.btn-primary` across 7 files. Repairing them repairs every list page at once. The trap is the row action's hit area (Review Focus 4).

**Files:**
- Modify: `frontend/src/components/table/RowActionButton.tsx` (7 legacy refs)
- Modify: `frontend/src/components/table/ListFilterBar.tsx` (15)
- Modify: `frontend/src/components/table/ColumnPicker.tsx` (9)
- Modify: `frontend/src/components/table/TablePagination.tsx` (6)
- Modify: `frontend/src/components/table/ListEmptyState.tsx` (5 + `.btn-primary` at :66)
- Modify: `frontend/src/components/table/SortableHeader.tsx` (`--accent` ×2)
- Modify: `frontend/src/components/table/ListLoadFailed.tsx` (`--color-border` ×1)
- Create: `frontend/src/components/table/__tests__/tableChromeTokens.test.tsx`
- Modify: `scripts/action-consistency-baseline.json`

**Interfaces:**
- Consumes: `ui/Button`, `TOOLBAR_CONTROL_STYLE` (Task 1 established the ratchet that measures this).
- Produces: the same component APIs — `RowActionButton`, `ListEmptyState`, `ListFilterBar`, `ColumnPicker`, `TablePagination` keep their props exactly. This is a skin change; a prop change is out of scope and would ripple through 20 importing files.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/table/__tests__/tableChromeTokens.test.tsx`:

```tsx
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

const read = (name: string) =>
  readFileSync(join(__dirname, "..", name), "utf8");

describe("the logbook list chrome", () => {
  it.each(CHROME_FILES)("%s reads tokens only", (file) => {
    const source = read(file);
    for (const token of LEGACY) {
      expect(source, `${file} still reads ${token}`).not.toMatch(
        new RegExp(`--${token}\\b`)
      );
    }
    expect(source, `${file} still wears a .btn-* utility`).not.toMatch(
      /\bbtn-(?:primary|secondary|danger)\b/
    );
    expect(source, `${file} writes a hex colour`).not.toMatch(
      /(?<![\w-])#[0-9a-fA-F]{6,8}/
    );
  });
});

describe("RowActionButton", () => {
  it("keeps a 44px hit area under a coarse pointer", () => {
    const source = read("RowActionButton.tsx");
    expect(source).toContain("--ts-size-touch-min");
    expect(source).toMatch(/pointer-coarse:|useCoarsePointer/);
  });
});
```

The `LEGACY` list is written with a `--` prefix so `--accent` does not also match `--ts-accent-something`; verify by running — if `--ts-accent` trips the `--accent` check, the check must be anchored to a non-`ts-` context and the honest fix is `(?<!-ts-)--accent` style, not dropping the check.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/components/table/__tests__/tableChromeTokens.test.tsx`

Expected: FAIL on every file, naming the legacy tokens.

- [ ] **Step 3: Convert the seven files**

Map, per `DESIGN_SYSTEM.md` §2 and the remedy line the ratchet prints:

| Legacy | Token |
|---|---|
| `--text-primary` | `--ts-text` |
| `--text-secondary`, `--text-muted` | `--ts-muted` |
| `--bg-base` | `--ts-bg` |
| `--bg-surface`, `--bg-elevated` | `--ts-surface` / `--ts-surface2` |
| `--bg-muted` | `--ts-surface2` |
| `--color-border` | `--ts-border` |
| `--accent` | `--ts-accent` |
| `--danger` | `--ts-bad` |
| `--success` | `--ts-good` |
| `--warning` | `--ts-warn` |

Read `frontend/src/theme/tokens.css` for the exact names before starting — the table is the shape, and the file is the authority.

`ListEmptyState.tsx:66` renders `<button className="btn-primary …">`; it becomes `ui/Button` (the empty state's one required CTA). `ListFilterBar.tsx` is the largest at 15 references — read it whole first; do not batch-edit and hope.

Preserve every existing class that is not a colour (`pointer-coarse:min-h-…`, layout, focus). Where a raw `style={{ color: "var(--ts-muted)" }}` already exists beside a legacy class on the same element, collapse to one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/components/table/__tests__/tableChromeTokens.test.tsx`

Expected: PASS, 8 tests.

- [ ] **Step 5: Run the list pages' own suites**

These components carry no props change, but every list page renders them:

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend
npx vitest --run src/pages/__tests__ src/components/table/__tests__
npx tsc --noEmit && npm run lint
```

Expected: green. `CruisesPage.serverPaging.test.tsx`, `RailPage.test.tsx`, `FerryPage.test.tsx`, `BusPage.test.tsx`, `RentalsPage.test.tsx` and `FlightsTablePage.serverPaging.test.tsx` mock these components — a prop or export change breaks them, and a pure skin change does not.

- [ ] **Step 6: Tighten the baseline and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
node scripts/check-action-consistency.mjs --update && node scripts/check-action-consistency.mjs
npx --prefix frontend prettier --write --ignore-unknown frontend/src/components/table
git add -A frontend/src/components/table scripts/action-consistency-baseline.json
git commit -m "refactor(design): the logbook list chrome reads tokens

RowActionButton, ListFilterBar, ColumnPicker, TablePagination,
ListEmptyState, SortableHeader and ListLoadFailed carried 45 references
to the palette index.css defines, plus one .btn-primary. They are the
entire chrome of every logbook list page, so repairing seven files
repairs all of them.

The row action keeps its 44px hit area under a coarse pointer — it is
the only control in a row, and the device this app is drawn for is a
tablet."
```

---

### Task 6: The page header stops being hand-rolled

13 pages draw their own `<h1 className="t-screen-title">` plus an action row, which is exactly what `PageHeader` already renders. This is Review Focus 3 and 5: several of those rows carry a `ColumnPicker` and one or two `Link`s, and several pages that look like candidates are legitimately different.

**Files:**
- Modify (10 pages that convert): `pages/BusPage.tsx:221`, `pages/CruisesPage.tsx:377`, `pages/FerryPage.tsx:230`, `pages/RailPage.tsx:261`, `pages/RentalsPage.tsx:239`, `pages/LodgingListPage.tsx:456`, `pages/PlacesListPage.tsx:418`, `pages/RoadtripsPage.tsx:141`, `pages/PlaceListsPage.tsx:110`, `pages/CuratedChecklistPage.tsx:343`
- Modify (3 more with an action row): `pages/ToursPage.tsx:143`, `pages/FlightsTablePage.tsx:35`, `components/flightsTable/FlightsTablePanel.tsx:498`
- Create: `frontend/src/__tests__/pageHeaders.test.ts`
- Modify: `scripts/action-consistency-baseline.json`

**Explicitly NOT converted, and each for a stated reason** — a later reader must not "finish the job" by converting these:

| File | Why it stays |
|---|---|
| `pages/LoginPage.tsx:267`, `RegisterPage.tsx:113`, `ResetPasswordPage.tsx:92`, `SetupPage.tsx:142` | Centred auth cards. `PageHeader` is a left-aligned title with a right-hand action slot; an auth card has neither a page scope nor actions. |
| `pages/PassportPage.tsx:194` | The `h1` inside the **printed** passport document (`id="passport-heading"`). Print layout; not app chrome. |
| `pages/AircraftPage.tsx:49,56` | Two headings in one page, one per branch, with a stat grid below rather than beside — no action row. |
| `pages/LodgingChainDetailPage.tsx:158`, `TripEditPage.tsx:160`, `TripRouteEditorPage.tsx:520` | Detail/edit surfaces with a back link above the title. They are `DetailHeader`'s shape or its neighbours, not `PageHeader`'s; converting them is a different change with a different decision. |
| `pages/PlaceListDetailPage.tsx:406` | Its action is **inside** the `h1` (an inline rename button). `PageHeader` has no slot for that. |
| `pages/PlacesNearbyPage.tsx:180`, `pages/NotFoundPage.tsx:20` | Title with no action row. Nothing to unify — `PageHeader` would add a slot nobody fills. |
| `components/StaleBundleNotice.tsx:40` | A full-page error banner, not a page. |

**Interfaces:**
- Consumes: `PageHeader` from `components/ui` — `{ title: string; meta?: ReactNode; actions?: ReactNode }`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/pageHeaders.test.ts`:

```ts
/**
 * One page heading.
 *
 * The app had seventeen different h1 class chains; PageHeader is all of them.
 * Thirteen pages still drew their own — a title plus a hand-built action row —
 * which is the drift this pins: the same header, drawn twice, deciding its own
 * gaps and its own control order.
 *
 * It asserts the ABSENCE of the hand-rolled shape rather than the presence of
 * PageHeader, because the failure mode is a page that quietly keeps its own
 * markup while importing the component for something else — and because the
 * exceptions below are real and must stay possible.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONVERTED = [
  "pages/BusPage.tsx",
  "pages/CruisesPage.tsx",
  "pages/FerryPage.tsx",
  "pages/RailPage.tsx",
  "pages/RentalsPage.tsx",
  "pages/LodgingListPage.tsx",
  "pages/PlacesListPage.tsx",
  "pages/RoadtripsPage.tsx",
  "pages/PlaceListsPage.tsx",
  "pages/CuratedChecklistPage.tsx",
  "pages/ToursPage.tsx",
  "pages/FlightsTablePage.tsx",
];

const read = (relative: string) => readFileSync(join(__dirname, "..", relative), "utf8");

describe("the logbook list pages", () => {
  it.each(CONVERTED)("%s draws its heading with PageHeader", (file) => {
    expect(read(file), `${file} does not import PageHeader`).toContain("PageHeader");
  });

  it.each(CONVERTED)("%s no longer hand-rolls an h1", (file) => {
    expect(read(file), `${file} still writes its own t-screen-title h1`).not.toMatch(
      /<h1[^>]*className="[^"]*t-screen-title/
    );
  });

  it("keeps the pages whose heading is legitimately not a PageHeader", () => {
    // Each of these is in the plan's exception table with a reason. If one of
    // them starts importing PageHeader, somebody converted it without reading
    // why it was left — the auth cards are centred with no action slot, and
    // PassportPage's heading is inside the PRINTED document.
    for (const file of [
      "pages/LoginPage.tsx",
      "pages/RegisterPage.tsx",
      "pages/ResetPasswordPage.tsx",
      "pages/SetupPage.tsx",
    ]) {
      expect(read(file), `${file} is an auth card, not a page header`).not.toMatch(
        /<PageHeader/
      );
    }
    expect(read("pages/PassportPage.tsx")).toContain("passport-heading");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/__tests__/pageHeaders.test.ts`

Expected: FAIL on 12 files for "does not import PageHeader" and on 12 for the hand-rolled h1.

- [ ] **Step 3: Convert one page, completely, and look at it**

Start with `pages/FerryPage.tsx`. Its header block (around lines 228-250) is a title, a `ColumnPicker` and a `<button className="btn-primary …">`. It becomes:

```tsx
      <PageHeader
        title={t("ferry:title")}
        actions={
          <>
            <ColumnPicker … />
            <Button onClick={openCreate}>{t("ferry:add")}</Button>
          </>
        }
      />
```

using the existing prop values verbatim — this step is a move, not a rewrite. Then run the dev server and **look at the page**: the check that matters here is that the `ColumnPicker` is still reachable and the add button still opens the dialog. A green unit test cannot see a dropped control (Review Focus 3).

Verify with the browser before converting the other eleven — one page proves the pattern and the action-slot gap behaviour, twelve prove nothing extra.

- [ ] **Step 4: Convert the remaining eleven**

Same shape each time. Two carry more than a title and one button:

- `pages/PlacesListPage.tsx:418` — its action row holds a `ColumnPicker` **plus two `Link`s** ("nearby", "lists") styled by hand. Those `Link`s become `ui/ActionLink`, which shares the secondary button's recipe. Both destinations must survive; losing one is a control the user cannot reach any other way.
- `pages/LodgingListPage.tsx:456` — the `ColumnPicker` renders only when `view === "houses"`. Keep the condition inside the `actions` slot rather than converting the header differently per view.
- `components/flightsTable/FlightsTablePanel.tsx:498` and `pages/FlightsTablePage.tsx:35` — both draw the same "Flights" heading (the panel is used inside the page in one view). Convert both, and check whether the page should stop drawing a heading the panel already draws; if the panel renders only inside the page, one of the two headings is a double heading today and the answer is to keep the panel's. Decide by reading the route, and say which you chose in a comment.

Delete now-unused imports (`ColumnPicker` stays; a `COARSE`-style constant or an inline `style` may go).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/__tests__/pageHeaders.test.ts`

Expected: PASS, 26 tests.

- [ ] **Step 6: Gate — compile, lint, and the list pages' suites**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend
npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: green. If a list page's suite fails on a query that used to find the h1 by class, fix the query to use the role — `getByRole("heading", …)` — which the conversion makes correct.

- [ ] **Step 7: Tighten the baseline and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
node scripts/check-action-consistency.mjs --update && node scripts/check-action-consistency.mjs
npx --prefix frontend prettier --write --ignore-unknown frontend/src
git add -A frontend/src scripts/action-consistency-baseline.json
git commit -m "refactor(design): thirteen pages stop drawing their own header

PageHeader is a title, an optional meta line and an action slot. Thirteen
pages wrote the same three things by hand, which meant each decided its
own gaps, its own control order and its own idea of what an action row
looks like.

Eleven pages that could look like candidates stay as they are, each for a
reason recorded in the plan's exception table — the auth cards are
centred with no actions, PassportPage's heading is inside the PRINTED
document, and PlaceListDetailPage puts its action inside the h1."
```

---

### Task 7: `FerryDetailPage` gains the danger cue its siblings have

Four of the five transport detail pages put `Button variant="danger"` in the header for Delete; `FerryDetailPage:134` uses a plain secondary `Button`, so the one action that removes the ferry looks exactly like Edit beside it. The spec's "Open, deliberately" section rules that the page-level danger trigger stays and the doc's line is amended — so this is the page that moves, not the four.

**Files:**
- Modify: `frontend/src/pages/FerryDetailPage.tsx:131-135`
- Create: `frontend/src/pages/__tests__/detailDangerCue.test.tsx`
- Modify: `docs/…` — none here; the DESIGN_SYSTEM.md amendment is Task 9.

**Interfaces:**
- Consumes: `ui/Button variant="danger"` (already exists at `components/ui/Button.tsx:80`).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/__tests__/detailDangerCue.test.tsx`:

```tsx
/**
 * The delete trigger in a detail header says so.
 *
 * Five transport detail pages carry Edit and Delete in the header. Four wore
 * `variant="danger"` on the second; the ferry wore the plain secondary skin,
 * so on that one page the action that removes the record was drawn identically
 * to the action that edits it. That is not a style difference — it is the only
 * cue distinguishing a reversible from an irreversible action in the header.
 *
 * Read as source, because the assertion is about which variant the header
 * passes and rendering five detail pages needs five sets of fixtures whose
 * absence would make the test pass for the wrong reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGES = [
  "FerryDetailPage.tsx",
  "RentalDetailPage.tsx",
  "BusDetailPage.tsx",
  "RailDetailPage.tsx",
  "CruiseDetailPage.tsx",
];

const read = (name: string) => readFileSync(join(__dirname, "..", name), "utf8");

/**
 * The `DetailHeader` element's own source, brace-aware.
 *
 * It is SELF-CLOSING on all five pages — `<DetailHeader … />`, no
 * `</DetailHeader>` anywhere — so slicing to the closing tag returns an empty
 * string and the assertion fails on all five, including the four that are
 * already correct. That is a test that reports the opposite of the truth, so
 * the scan tracks brace depth from `<DetailHeader` to the first `/>` that sits
 * outside any `{…}` — without the depth count, the `/>` inside `icon={<Icon …
 * />}` ends the block one prop early.
 */
function detailHeaderBlock(source: string): string {
  const start = source.indexOf("<DetailHeader");
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < source.length - 1; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    else if (source[i] === "/" && source[i + 1] === ">" && depth === 0) {
      return source.slice(start, i + 2);
    }
  }
  return "";
}

describe("the transport detail headers", () => {
  it.each(PAGES)("%s marks its delete trigger as danger", (file) => {
    const header = detailHeaderBlock(read(file));
    expect(header, `${file} draws no DetailHeader`).not.toBe("");
    expect(header, `${file}'s header has no danger button`).toContain('variant="danger"');
  });

  it("marks exactly one action per header, not every button", () => {
    // A header where both buttons are danger has no cue at all. This pins the
    // count so "make the test pass" cannot mean "paint them all red".
    for (const file of PAGES) {
      const header = detailHeaderBlock(read(file));
      expect((header.match(/variant="danger"/g) ?? []).length, file).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/pages/__tests__/detailDangerCue.test.tsx`

Expected: FAIL on `FerryDetailPage.tsx` only — the other four already pass, which is the evidence that the ferry is the outlier.

- [ ] **Step 3: Add the cue**

In `frontend/src/pages/FerryDetailPage.tsx`, line 134:

```tsx
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {t("ferry:remove")}
            </Button>
```

Its confirmation already goes through `ConfirmModal` with `destructive` (Task 3), so the dialog and the trigger now agree.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/pages/__tests__/detailDangerCue.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 5: Look at the page in a browser**

Run `npm run dev` from the root, open a ferry's detail page, and confirm the Delete button is the tinted outline and that Edit beside it is still the plain secondary. `variant="danger"` is `--ts-bad` at 12 % fill and 45 % border; if it reads as a solid red fill, the wrong variant was used.

- [ ] **Step 6: Gate and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd /home/ohmz/StudioProjects/TravStats-fork
npx --prefix frontend prettier --write --ignore-unknown frontend/src/pages
git add -A frontend/src/pages
git commit -m "fix(ferry): the delete trigger in the header says it deletes

Four of the five transport detail headers carry variant=danger on the
second action; the ferry carried the plain secondary skin, so on that one
page the action that removes the record was drawn identically to the
action that edits it. The plan's ruling follows the majority — the cue
stays on the four and arrives on the fifth — rather than removing it."
```

---

### Task 8: Destructive actions that never ask

The spec names one live defect: `MembershipManager.tsx:399` deletes a loyalty card with no confirmation. A sweep for the same shape found four more. All five are the same defect class from CLAUDE.md — *a provider failure becomes silent success* has a sibling here: an irreversible action with no question.

**Files:**
- Modify: `frontend/src/components/lodging/MembershipManager.tsx:399` (the named defect)
- Modify: `frontend/src/components/Settings/PasskeySection.tsx:157`
- Modify: `frontend/src/components/Settings/ShareLinksSection.tsx:131`
- Modify: `frontend/src/components/common/PhotoStrip.tsx:152`
- Modify: `frontend/src/components/Admin/LoginBackgroundsCard.tsx:119`
- Create: `frontend/src/__tests__/destructiveAsks.test.ts`

**Interfaces:**
- Consumes: `useConfirmDialog()` (`hooks/useConfirmDialog.tsx`) — returns `{ confirm, confirmDelete, confirmDialog }`; `confirmDelete(message: string): Promise<boolean>`; render `confirmDialog` once in the component. And `ConfirmModal`'s `destructive` prop from Task 3.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/destructiveAsks.test.ts`:

```ts
/**
 * An irreversible action asks first.
 *
 * Five places removed something the user cannot get back without a question:
 * a loyalty card (the spec's named defect — the card, and with it every stay
 * linked to it), a passkey, a share link, a photograph, and an instance's
 * login background. Each called its delete straight from the click handler.
 *
 * The test drives the SOURCE, not five components: rendering each one needs
 * its own fixture, and four of the five are the kind of component whose happy
 * path is easy to mock and whose failure path never gets written — which is
 * how these five shipped. What is asserted is the thing that was missing: the
 * handler awaits an answer before it deletes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CASES: Array<{ file: string; confirmCall: string }> = [
  { file: "components/lodging/MembershipManager.tsx", confirmCall: "confirmDelete" },
  { file: "components/Settings/PasskeySection.tsx", confirmCall: "confirmDelete" },
  { file: "components/Settings/ShareLinksSection.tsx", confirmCall: "confirmDelete" },
  { file: "components/common/PhotoStrip.tsx", confirmCall: "confirmDelete" },
  { file: "components/Admin/LoginBackgroundsCard.tsx", confirmCall: "confirmDelete" },
];

const read = (relative: string) => readFileSync(join(__dirname, "..", relative), "utf8");

describe("destructive actions", () => {
  it.each(CASES)("$file asks before it removes", ({ file, confirmCall }) => {
    const source = read(file);
    expect(source, `${file} does not use the confirm hook`).toContain("useConfirmDialog");
    expect(source, `${file} never awaits an answer`).toContain(`await ${confirmCall}(`);
    // The shape that shipped: the handler calls the API with no question in
    // front of it. `if (!(await confirmDelete(...))) return;` is the guard.
    expect(source, `${file} does not bail out on a declined confirm`).toMatch(
      new RegExp(`if\\s*\\(\\s*!\\(await\\s+${confirmCall}\\(`)
    );
    // And the dialog has to be rendered, or the promise never settles.
    expect(source, `${file} never renders confirmDialog`).toContain("{confirmDialog}");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/__tests__/destructiveAsks.test.ts`

Expected: FAIL on all five.

- [ ] **Step 3: Convert them, one at a time, starting with the named defect**

`components/lodging/MembershipManager.tsx` — the spec's example. Add the hook, wrap the delete:

```tsx
  const { confirmDelete, confirmDialog } = useConfirmDialog();

  const remove = async (id: string): Promise<void> => {
    if (!(await confirmDelete(t("lodging:membership.deleteConfirm")))) return;
    // …the existing delete call, unchanged…
  };
```

and render `{confirmDialog}` once inside the component's returned tree — at the top level of its fragment, not inside the `<ul>`, or a re-render of the list remounts it and the pending promise is dropped.

The message must name the object and the reach, in the shape `lib/deleteConfirm.ts` describes (what · how much goes with it · what stays). A loyalty card takes its memberships with it and the stays that link to it survive — check `backend/src/__tests__/integrity/cascades.integrity.test.ts` for what actually cascades before writing the sentence, and add the key to **both** `de` and `en` under `lodging` (the parity test fails otherwise).

Then the four the sweep found, each the same shape:

- `components/Settings/PasskeySection.tsx` — removing a passkey can lock a user out of an account with no password. Name that.
- `components/Settings/ShareLinksSection.tsx` — revoking a link is irreversible and anyone holding it loses access. Name that.
- `components/common/PhotoStrip.tsx` — deleting a photo is irreversible. (This one is called from a lightbox; check whether an undo exists before adding a modal, and if the removal is already undoable, note that in a comment and pin it with an assertion instead of adding a dialog.)
- `components/Admin/LoginBackgroundsCard.tsx` — an admin action on instance state.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/__tests__/destructiveAsks.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Gate — including the locale parity test**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend
npx tsc --noEmit && npm run lint
npx vitest --run src/i18n/__tests__/localeKeyParity.test.ts
npx vitest --run src/components/lodging src/components/Settings src/components/Admin src/components/common
npx vitest --run
```

Expected: green. The parity test is the one that fails if a German key was added without its English mirror.

- [ ] **Step 6: Look at one of them in a browser**

Open the loyalty-card settings, click Delete, and confirm the dialog appears, states what goes with it, and that Cancel leaves the card alone. A modal that appears but whose promise never settles leaves the button permanently dead — jsdom cannot see that, which is why this step exists.

- [ ] **Step 7: Commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork
npx --prefix frontend prettier --write --ignore-unknown frontend/src
git add -A frontend/src
git commit -m "fix(design): five irreversible actions ask before they act

A loyalty card was deleted the moment its delete was clicked, and the
confirmation every other domain puts in front of that was simply absent —
found by the 2026-10-14 inventory, which then looked for the same shape
and found four more: a passkey, a share link, a photograph, and the
instance's login background.

All five go through useConfirmDialog now, so the question is the same
dialog every other delete uses and the answer is awaited rather than
assumed."
```

---

### Task 9: The docs stop claiming checks that do not exist

`design/DESIGN_SYSTEM.md` §6 says `danger` may appear "only inside a confirm dialog", which read strictly forbids the page-level danger trigger four detail pages use and the ferry now has. And §10 lists four checks as if all four landed; two were never written and one of those (the hex scan) only arrived in Task 2. Left alone, the next reader trusts a document over the tree — which is exactly how the migration stopped between 2026-09-15 and 2026-10-14.

**Files:**
- Modify: `design/DESIGN_SYSTEM.md` (§6's Button row, §10's list)
- Modify: `CLAUDE.md` (the ratchet count sentence)
- Modify: `docs/superpowers/specs/2026-10-14-action-consistency-design.md` (mark the migration-order steps that landed)

**Interfaces:**
- Consumes: the rule ids from Tasks 1 and 2.
- Produces: nothing.

- [ ] **Step 1: Amend §6's Button row**

Find the row:

```
| `Button` | two variants, primary (amber fill, 52) and secondary (hairline, 46); `danger` only inside a confirm dialog; never mono; label 16/700 |
```

Replace it with:

```
| `Button` | three variants: primary (amber fill, 52), secondary (hairline, 46) and `danger` (a tinted outline, never a fill). `danger` appears in a confirm dialog, or on the page-level trigger that opens one — four of the five transport detail headers carry it there, and a delete drawn identically to an edit is a cue that was never given. Never mono; label 16/700. `size="toolbar"` (46) for anything in a row. |
```

- [ ] **Step 2: Correct §10**

Replace the four-item list under `## 10. Enforcement` with what actually runs, naming each rule by its id and its script:

```
A system that lives only in a document ages like the ones before it. What
runs, and where:

1. `frontend/scripts/generate-theme.mjs` — the generated CSS is a build
   artefact; a test compares it to a fresh generation so nobody hand-edits it.
2. `scripts/check-action-consistency.mjs` (`npm run check:actions`) — one
   ratchet, five rules, each a per-file count frozen in
   `scripts/action-consistency-baseline.json`:
   - `legacy-palette` — a token `index.css` defines and the design system replaced
   - `legacy-button-utility` — the pre-redesign `.btn-*` classes
   - `hand-rolled-overlay` — `fixed inset-0` outside `components/ui/Dialog.tsx`
   - `raw-tailwind-palette` — `text-red-600`, `bg-slate-800`, `dark:` and friends
   - `code-hex-literal` — a hex colour written past the token layer, guarded so
     it does not read `forgejo#250` as a colour
   Entries shrink or leave the list; `--update` refuses to raise one.

This section listed four checks for five weeks before two of them existed and
before the three that carry the drift were written. The version above names
what runs; if that stops being true, this list is the second thing to fix,
after the check.
```

- [ ] **Step 3: Pin it with a test**

Append to `frontend/src/__tests__/pageHeaders.test.ts` (or create `frontend/src/__tests__/designDocClaims.test.ts` if the file has grown past its subject):

```ts
describe("DESIGN_SYSTEM.md §10", () => {
  it("names only checks that exist on disk", () => {
    // The section claimed four checks for five weeks while two did not exist.
    // A doc is not a gate, but a doc that names a file is checkable — and a
    // reader who finds the file missing will stop trusting the section, which
    // is how the migration stopped the first time.
    const doc = readFileSync(join(__dirname, "..", "..", "..", "design", "DESIGN_SYSTEM.md"), "utf8");
    const section = doc.slice(doc.indexOf("## 10. Enforcement"));
    for (const script of ["scripts/check-action-consistency.mjs", "generate-theme.mjs"]) {
      expect(section, `§10 names ${script}`).toContain(script.split("/").pop()!);
      const found = script.includes("/")
        ? existsSync(join(__dirname, "..", "..", "..", script))
        : existsSync(join(__dirname, "..", "..", "..", "frontend", "scripts", script));
      expect(found, `${script} is named in §10 but does not exist`).toBe(true);
    }
  });
});
```

Add `existsSync` to the `node:fs` import. Adjust the relative depth by reading the test's own directory once — `frontend/src/__tests__/` is three levels below the repo root.

- [ ] **Step 4: Run it**

Run: `cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx vitest --run src/__tests__/`

Expected: PASS.

- [ ] **Step 5: Update the spec's migration order**

In `docs/superpowers/specs/2026-10-14-action-consistency-design.md`, under `## Migration order`, mark the steps this plan delivered and leave the rest as open. Do not rewrite the spec's argument — it is the record of what was measured on 2026-10-14. Add one line under the list:

```markdown
**Landed 2026-10-14** (plan: `docs/superpowers/plans/2026-10-14-action-consistency.md`):
steps 1–4, plus step 7 (`FerryDetailPage`) and the immediate-delete defect below.
Steps 5, 6 and 8 — the trip/roadtrip edit surface, the journey edit surface and
the long tail — are NOT done. They come down under the ratchet, opportunistically,
from whoever is already editing one of those files. That is the ratchet's purpose:
without it, the same five weeks repeat.
```

- [ ] **Step 6: Final gate and commit**

```bash
cd /home/ohmz/StudioProjects/TravStats-fork/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd /home/ohmz/StudioProjects/TravStats-fork && npm run check:size && npm run check:actions
npx --prefix frontend prettier --check --ignore-unknown .
git add design/DESIGN_SYSTEM.md CLAUDE.md docs/superpowers/specs/2026-10-14-action-consistency-design.md frontend/src/__tests__
git commit -m "docs(design): the design doc names what actually runs

§6 said danger may appear only inside a confirm dialog, which forbade the
page-level danger trigger four detail pages already used; §10 listed four
checks as if all four had landed, and two had not. Both are corrected to
what is true, and §10's claim is now pinned by a test that reads the
paths it names — a doc that names a file is checkable, and a reader who
finds the file missing stops trusting the section."
```

---

## What this plan does not do

Named so nobody reads its absence as an oversight:

- **Spec steps 5, 6 and 8** — `TourPointEditor` / `TourLegList` / `RoadtripEditSections` / `TourTrackList`, `TripEditPage`'s sticky row / `TimelineActions` / `TripGallery`, and the long tail (`components/Trips/**` beyond the builder, settings, admin, the map control kit, the auth pages). 468 files still reference the legacy palette. The ratchet makes leaving them safe and brings them down opportunistically; sweeping them is a separate plan with its own review burden.
- **The map control kit and the globe panels** (`components/map/controlPanelKit.tsx`, `components/Globe/`) keep their raw-RGB kit on purpose — they sit over imagery, not over app surfaces. The hex rule excludes them by path (Task 2).
- **The modal-vs-page edit question** for the five non-trip domains. Trips and roadtrips edit on a page, every other domain edits in a modal. The owner's ruling covers the flight trip; the other five are open and this plan does not settle them.
- **The two API response shapes** (ADR 0001) — a server decision, settled.
