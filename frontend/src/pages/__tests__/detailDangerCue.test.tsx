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
