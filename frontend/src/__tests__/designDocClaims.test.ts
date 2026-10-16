/**
 * DESIGN_SYSTEM.md §10 names what actually runs.
 *
 * The section claimed four checks for five weeks while two of them did not
 * exist, and the three that carry the drift were written only on 2026-10-14.
 * A document is not a gate — but a document that names a file IS checkable, and
 * a reader who goes looking for a file that is not there stops trusting the
 * section. That is how the migration stopped the first time.
 *
 * So this asserts the two things a claim in that section consists of: the
 * script exists where the doc says it does, and the rule ids the doc lists are
 * the ones the script implements. Renaming a rule without the doc, or deleting
 * a script the doc still recommends, fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const doc = readFileSync(join(ROOT, "design", "DESIGN_SYSTEM.md"), "utf8");

// Slice from the heading rather than searching the whole document: §10 is the
// section whose claims are being pinned, and §2's palette tables name colours
// that would match a whole-document search for the wrong reason.
const section = doc.slice(doc.indexOf("## 10. Enforcement"));

describe("DESIGN_SYSTEM.md §10", () => {
  it("names only checks whose scripts exist on disk", () => {
    expect(section).toContain("generate-theme.mjs");
    expect(existsSync(join(ROOT, "frontend", "scripts", "generate-theme.mjs"))).toBe(true);

    expect(section).toContain("check-action-consistency.mjs");
    expect(existsSync(join(ROOT, "scripts", "check-action-consistency.mjs"))).toBe(true);
  });

  it("names the rule ids the ratchet actually implements", () => {
    const script = readFileSync(join(ROOT, "scripts", "check-action-consistency.mjs"), "utf8");

    for (const id of [
      "legacy-palette",
      "legacy-button-utility",
      "hand-rolled-overlay",
      "raw-tailwind-palette",
      "code-hex-literal",
    ]) {
      expect(section, `§10 does not name ${id}`).toContain(id);
      expect(script, `the script does not implement ${id}`).toContain(`id: "${id}"`);
    }
  });
});

describe("DESIGN_SYSTEM.md §6 states the action colour and placement rule the code enforces", () => {
  // Sliced from §6 to §7, not searched across the whole document. "Delete …
  // red" is a sentence the doc writes in more than one place, so a
  // whole-document match stayed green even if the Button row itself had
  // stopped saying it — a claim check that could not fail on the claim it
  // names (whole-branch review, 2026-10-15).
  const section = doc.slice(doc.indexOf("## 6. Components"), doc.indexOf("## 7. Icons"));

  it("names amber for Edit and Save, red for Delete, black for the rest", () => {
    expect(section).toMatch(/Edit[^\n]*Save[^\n]*amber/i);
    expect(section).toMatch(/Delete[^\n]*red/i);
    expect(section).toMatch(/everything else[^\n]*(black|outline)/i);
  });

  it("names the three placement levels", () => {
    expect(section).toContain("SectionHeader");
    expect(section).toContain("RowActionButton");
    expect(section).toMatch(/page[^\n]*title[^\n]*right/i);
  });

  it("does not size a button by its variant in §4.5", () => {
    // 52 is for a lone CTA, 46 for any control in a row: the size follows the
    // place, so "secondary button 46" next to "primary button 52" put a primary
    // Save beside a secondary Cancel at two heights.
    expect(doc).not.toMatch(/primary button 52/i);
    expect(doc).not.toMatch(/secondary button 46/i);
  });

  it("no longer says danger appears only in a dialog or a detail header", () => {
    expect(doc).not.toContain("four of the five transport detail headers carry it there");
  });
});
