import fs from "fs";
import path from "path";

/**
 * `shared/tour/builderStations.ts` is the one wording of the note a scan
 * pre-fills on a station, and the limits the review page's chain edits read.
 * The review page tells a typed note from an untouched one by comparing it with
 * what this module writes, so the two copies must be the SAME code: a changed
 * word on one side would make every pre-filled note look hand-written.
 *
 * Checked byte for byte the way `builderNightPlan` is. The leading comment
 * names the OTHER file, so it is the one part allowed to differ.
 */
const LEADING_COMMENT = /^\/\*\*[\s\S]*?\*\/\n/;

function codeOf(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(LEADING_COMMENT, "");
}

describe("builderStations mirror", () => {
  it("is the same code in backend and frontend, leading comment aside", () => {
    const backend = codeOf(path.resolve(__dirname, "../builderStations.ts"));
    const frontend = codeOf(
      path.resolve(__dirname, "../../../../../frontend/src/shared/tour/builderStations.ts")
    );
    expect(frontend).toBe(backend);
  });
});
