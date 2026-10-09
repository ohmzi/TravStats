#!/usr/bin/env node
/**
 * Vendor the journeys-card band's flags into the frontend.
 *
 * THE RULE THIS SCRIPT EXISTS TO KEEP
 *   "A code goes in, a flag comes out, with nothing for a human to update when
 *   a new country appears on a future trip" (owner, 2026-10-09). The band
 *   (`frontend/src/lib/tripFlags.ts`) derives its asset URL from `ISO_3166_1_ALPHA2`
 *   by convention — `/flags/<cc>.svg` — and keeps no list of flags. This script
 *   is the other half: it makes the FILES match that list, so the two can never
 *   drift. Add a country to the shared country list and re-run this; never edit
 *   a flag registry by hand.
 *
 * WHERE THE BYTES COME FROM
 *   `backend/node_modules/flag-icons/flags/4x3/<cc>.svg` — the set the repo
 *   already vendors for its backend. Nothing is downloaded, at author time or
 *   at build time: every byte is copied from that in-repo dependency. The
 *   frontend's own flag component loads `flagcdn.com` at RUNTIME, which the
 *   owner's rule forbids for the card band, so the band paints only files this
 *   repository ships.
 *
 * IDEMPOTENT BY CONSTRUCTION
 *   Each copied file gets a provenance header (source, licence, and the colours
 *   READ OUT OF THE SVG itself — not invented). Any leading `<!-- … -->` block
 *   already there is stripped first, so re-running on a `flag-icons` bump
 *   rewrites the header instead of stacking a second one.
 *
 * USAGE
 *   node scripts/vendor-flags.mjs            copy / refresh every flag
 *   node scripts/vendor-flags.mjs --check    report, write nothing, exit 1 if
 *                                            a code in the domain has no file
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const COUNTRY_LIST = join(REPO_ROOT, "frontend", "src", "shared", "geo", "countryCode.ts");
const FLAG_ICONS = join(REPO_ROOT, "backend", "node_modules", "flag-icons");
const SOURCE_DIR = join(FLAG_ICONS, "flags", "4x3");
const DEST_DIR = join(REPO_ROOT, "frontend", "public", "flags");

const CHECK_ONLY = process.argv.includes("--check");

/**
 * The app's own country domain, read from the source of truth rather than
 * re-typed here: one list, and this script can never disagree with the resolver
 * it feeds. The `["']` guard tolerates either quote style.
 */
function readIsoDomain() {
  const src = readFileSync(COUNTRY_LIST, "utf8");
  const match = src.match(/ISO_3166_1_ALPHA2\s*=\s*[\r\n\s]*(?:"([^"]+)"|'([^']+)')/);
  if (!match) throw new Error(`could not find ISO_3166_1_ALPHA2 in ${COUNTRY_LIST}`);
  return (match[1] ?? match[2]).trim().split(/\s+/);
}

function flagIconsVersion() {
  const pkg = JSON.parse(readFileSync(join(FLAG_ICONS, "package.json"), "utf8"));
  return pkg.version;
}

/** The country's English name, from the runtime — no name table to maintain. */
const regionName = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * The colours the flag actually uses, read out of its own `fill`/`stop-color`
 * values in file order. This is a description of the FILE, never a hand-typed
 * claim about the flag, and it is capped so the header stays one line.
 */
function coloursOf(svg) {
  const seen = [];
  for (const m of svg.matchAll(/(?:stop-)?(?:fill|color)="([^"]+)"/g)) {
    const value = m[1].trim();
    if (!value || value === "none" || value === "currentColor") continue;
    if (!seen.includes(value)) seen.push(value);
    if (seen.length === 4) break;
  }
  return seen;
}

/** The provenance-and-licence block every vendored flag carries. */
function headerFor(cc, version, svg) {
  const name = regionName.of(cc) ?? cc;
  const colours = coloursOf(svg);
  const colourLine =
    colours.length > 0 ? ` Colours used: ${colours.join(", ")}.` : "";
  return `<!--
  ${name} — one of the journeys-card band's flags (owner, 2026-10-09).

  Design source: flag-icons ${version}, \`flags/4x3/${cc.toLowerCase()}.svg\`, the set the repo
  already vendors for the backend (backend/node_modules/flag-icons).
  Copied here, verbatim, from that in-repo dependency — NOT downloaded
  from the internet, and never fetched at build or runtime. Regenerate
  every flag from that dependency with \`node scripts/vendor-flags.mjs\`.

  Why a local copy at all: the frontend's own flag component (\`FlagImg\`)
  loads \`https://flagcdn.com\` at RUNTIME, which the owner's rule forbids
  for the card band. The band paints only assets this repository ships.

  Licence: MIT — Copyright (c) 2013 Panayiotis Lipiridis. See
  backend/node_modules/flag-icons/LICENSE.${colourLine}
-->`;
}

/** Drop a leading provenance comment so a re-run replaces it, not stacks it. */
function stripLeadingComment(svg) {
  return svg.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
}

function main() {
  const domain = readIsoDomain();
  const version = flagIconsVersion();

  if (!existsSync(SOURCE_DIR)) {
    throw new Error(
      `no vendored flag-icons at ${SOURCE_DIR}; run \`npm install\` in backend/ first`
    );
  }
  if (!CHECK_ONLY) mkdirSync(DEST_DIR, { recursive: true });

  let written = 0;
  const missing = [];
  for (const cc of domain) {
    const file = `${cc.toLowerCase()}.svg`;
    const source = join(SOURCE_DIR, file);
    if (!existsSync(source)) {
      missing.push(cc);
      continue;
    }
    if (CHECK_ONLY) continue;
    const svg = stripLeadingComment(readFileSync(source, "utf8")).trimStart();
    writeFileSync(join(DEST_DIR, file), `${headerFor(cc, version, svg)}\n${svg}`);
    written += 1;
  }

  // Orphans are the other half of "one file per code": an SVG under public/flags
  // that no code in the domain maps to is dead weight the band can never paint.
  const wanted = new Set(domain.map((cc) => `${cc.toLowerCase()}.svg`));
  const orphans = existsSync(DEST_DIR)
    ? readdirSync(DEST_DIR).filter((f) => f.endsWith(".svg") && !wanted.has(f))
    : [];

  if (missing.length > 0) {
    console.error(`flag-icons ${version} has no 4x3 SVG for: ${missing.join(", ")}`);
  }
  if (orphans.length > 0) {
    console.error(`orphan flags (no code in the domain maps to them): ${orphans.join(", ")}`);
  }

  if (CHECK_ONLY) {
    const total = domain.length;
    console.log(`checked ${total} codes: ${total - missing.length} present, ${missing.length} missing`);
    process.exit(missing.length === 0 && orphans.length === 0 ? 0 : 1);
  }

  console.log(
    `vendored ${written} flags from flag-icons ${version} into frontend/public/flags/`
  );
  process.exit(missing.length === 0 && orphans.length === 0 ? 0 : 1);
}

main();
