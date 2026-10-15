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
    expect("color: var(--ts-text-primary)".match(legacyRule.pattern)).toBeNull();
  });

  it("keeps the legacy palette out of the design system itself", () => {
    expect(legacyRule.excluded("frontend/src/theme/tokens.css")).toBe(true);
    expect(legacyRule.excluded("frontend/src/index.css")).toBe(true);
    expect(legacyRule.excluded("frontend/src/pages/FerryPage.tsx")).toBe(false);
  });

  it("recognises the pre-redesign button utilities, and not a lookalike class", () => {
    expect('className="btn-primary"'.match(buttonRule.pattern)).toEqual(["btn-primary"]);
    // `\b` after `primary` sits between `y` and `i` — both word characters, so
    // there is no boundary and no match. That is the right behaviour: the rule
    // catches utilities, and a substring match would also flag prose.
    expect('className="btn-primaryish"'.match(buttonRule.pattern)).toBeNull();
  });
});

describe("sortByCountDescending", () => {
  it("puts the file most worth migrating first, and breaks ties by path", () => {
    const sorted = sortByCountDescending({ "b.tsx": 1, "a.tsx": 5, "c.tsx": 1 });
    expect(Object.keys(sorted)).toEqual(["a.tsx", "b.tsx", "c.tsx"]);
  });
});
