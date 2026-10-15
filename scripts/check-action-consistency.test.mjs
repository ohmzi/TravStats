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

  it("refuses a brand-new offender — skipping it was how --update laundered regressions", () => {
    expect(wouldRaise(legacyRule, { "new.tsx": 9, "a.tsx": 1 }, { "a.tsx": 3 })).toEqual([
      { path: "new.tsx", count: 9, allowed: 0 },
    ]);
  });

  it("still records every path on a rule's first freeze, so bootstrapping and new rules can land", () => {
    // `code-hex-literal` entered the baseline this way; refusing its first
    // freeze would make adding a rule impossible.
    expect(wouldRaise(legacyRule, { "new.tsx": 9 }, {}, true)).toEqual([]);
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
    expect(hits("<div style={{ color: 'var(--fx, #6ab7d8)' }}")).toEqual(["#6ab7d8"]);
    expect(hits("background: #fff;")).toEqual(["#fff"]);
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
