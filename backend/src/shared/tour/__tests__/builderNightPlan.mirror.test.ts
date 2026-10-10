import fs from "fs";
import path from "path";

/**
 * `shared/tour/builderNightPlan.ts` is the one rule for what a set of night
 * answers writes as roadtrip stations. The review page derives what it shows
 * from it and the commit handler re-derives and re-validates with it, so the
 * two copies must be the SAME code.
 *
 * Unlike the roadtrip mirror next to it, which is held only by two truth
 * tables, this one is checked byte for byte (the way `logContract` is). The
 * leading comment names the OTHER file, so it is the one part allowed to
 * differ; everything after it must be identical.
 */
const LEADING_COMMENT = /^\/\*\*[\s\S]*?\*\/\n/;

function codeOf(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(LEADING_COMMENT, "");
}

describe("builderNightPlan mirror", () => {
  it("is the same code in backend and frontend, leading comment aside", () => {
    const backend = codeOf(path.resolve(__dirname, "../builderNightPlan.ts"));
    const frontend = codeOf(
      path.resolve(__dirname, "../../../../../frontend/src/shared/tour/builderNightPlan.ts")
    );
    expect(frontend).toBe(backend);
  });
});
