import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A key the trip builder asks for and a locale file lacks is not an error
 * anywhere: react-i18next renders the key itself, so "tripBuilder:review.back"
 * would reach a reader. The component tests cannot see it (they stub `t` to
 * return the key), and the parity test only compares the two files with each
 * other. This reads the keys out of the source and looks each one up, in both
 * languages. A plural key counts as present when its `_other` form is.
 */

const SRC = path.resolve(__dirname, "..", "..");
const RESOURCES = path.join(SRC, "i18n", "resources");

/** Where the trip builder's copy is asked for. Files that do not exist yet are skipped. */
const FOLDERS = ["components/Trips/tripBuilder", "lib/tripBuilder"];
const FILES = [
  "pages/TripBuilderPage.tsx",
  "pages/TripResyncPage.tsx",
  // The trip-side Re-sync page (owner request 2026-10-12), the journey page's twin.
  "pages/RoadtripResyncPage.tsx",
  // The two edit pages ask the tripBuilder namespace for their Re-sync and
  // Delete sections (spec 2026-10-12 §4).
  "pages/TripEditPage.tsx",
  "pages/TripRouteEditorPage.tsx",
  // The trip edit page's header actions, where its tripBuilder keys are asked.
  "components/Roadtrips/RoadtripEditActions.tsx",
  "hooks/useBuilderSession.ts",
];

function sourceFiles(): string[] {
  const found = FILES.map((file) => path.join(SRC, file)).filter((file) => fs.existsSync(file));
  for (const folder of FOLDERS) {
    const dir = path.join(SRC, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/\.tsx?$/.test(name)) found.push(path.join(dir, name));
    }
  }
  return found;
}

function keysAsked(): Set<string> {
  const keys = new Set<string>();
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf-8");
    for (const match of text.matchAll(/["'`]tripBuilder:([A-Za-z0-9_.]+)["'`]/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function has(tree: unknown, key: string): boolean {
  const parts = key.split(".");
  let node = tree as Record<string, unknown> | undefined;
  for (const part of parts.slice(0, -1)) {
    const next = node?.[part];
    if (typeof next !== "object" || next === null) return false;
    node = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  return node !== undefined && (last in node || `${last}_other` in node);
}

const locale = (lang: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(RESOURCES, lang, "tripBuilder.json"), "utf-8"));

describe("the trip builder's copy", () => {
  const asked = keysAsked();

  it("finds the keys to judge — otherwise the scan has drifted and passes silently", () => {
    expect(sourceFiles().length).toBeGreaterThan(15);
    expect(asked.size).toBeGreaterThan(150);
  });

  it.each(["en", "de"])("has every key the source asks for, in %s", (lang) => {
    const tree = locale(lang);
    const missing = [...asked].filter((key) => !has(tree, key)).sort();
    expect(missing, `missing from ${lang}/tripBuilder.json`).toEqual([]);
  });

  // Both messages describe the same switched-off state, so they must send the
  // reader to the same place. The switch lives in Settings › Modules; there is
  // no Beta section in Settings (the beta switch is an administrator's).
  it.each(["en", "de"])(
    "points both roadtrips-off messages at one Settings section, in %s",
    (lang) => {
      const tree = locale(lang) as {
        popup: { roadtripsOff: string };
        warnings: { roadtripsHidden: string };
      };
      const where = (text: string): string | undefined =>
        /(?:Settings|Einstellungen) › [^\s.]+/.exec(text)?.[0];
      const popup = where(tree.popup.roadtripsOff);
      expect(popup, "popup.roadtripsOff names a section").toBeDefined();
      expect(where(tree.warnings.roadtripsHidden)).toBe(popup);
    }
  );
});
