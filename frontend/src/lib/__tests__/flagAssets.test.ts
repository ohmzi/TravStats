import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ISO_3166_1_ALPHA2 } from "../../shared/geo/countryCode";

/**
 * The no-registry guarantee, from the other side.
 *
 * The band derives its flag URL from the code by convention (`/flags/<cc>.svg`)
 * and keeps no list of flags — so this test is what makes that safe: it fails
 * if the folder and the app's country domain ever disagree, in EITHER
 * direction. A code added to `ISO_3166_1_ALPHA2` without running
 * `scripts/vendor-flags.mjs` leaves a code whose flag the band would drop; an
 * SVG left behind after a code's removal is dead weight the band can never
 * paint. Both fail here.
 */
const FLAGS_DIR = resolve(__dirname, "../../../public/flags");

describe("the vendored flag set is exactly the app's country domain", () => {
  const files = readdirSync(FLAGS_DIR).filter((f) => f.endsWith(".svg"));

  it("ships one lower-cased file per code in ISO_3166_1_ALPHA2", () => {
    expect(files).toEqual(ISO_3166_1_ALPHA2.map((cc) => `${cc.toLowerCase()}.svg`).sort());
  });

  it("carries no orphan file the domain cannot reach", () => {
    const wanted = new Set(ISO_3166_1_ALPHA2.map((cc) => `${cc.toLowerCase()}.svg`));
    expect(files.filter((f) => !wanted.has(f))).toEqual([]);
  });

  it("keeps the provenance-and-licence header on every file", () => {
    const bad = files.filter((f) => {
      const head = readFileSync(resolve(FLAGS_DIR, f), "utf8").slice(0, 900);
      return !head.includes("flag-icons") || !head.includes("MIT");
    });
    expect(bad).toEqual([]);
  });
});
