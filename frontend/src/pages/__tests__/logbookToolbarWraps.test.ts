import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * forgejo#88 acceptance, 2026-10-10: at 360px the flights page scrolled
 * sideways as a whole (scrollWidth 428) — its header's action group
 * ("Mehrere bearbeiten", "Spalten", "+ Flug hinzufügen", 404px together)
 * was the one logbook toolbar without `flex-wrap`. jsdom cannot measure a
 * row, so this read the header of every logbook page: the group that
 * follows the page title must be allowed to wrap.
 *
 * The group is `PageHeader`'s now (2026-10-14), so the row itself is drawn
 * once and the per-page reading moved to its source. What is left per page is
 * the other way this warden could go quiet: a logbook that stops handing its
 * controls to `actions` drops a picker or a button without breaking anything
 * visible in a test, which is the failure the shared header exists to
 * prevent.
 */
const PAGES = [
  "CruisesPage",
  "LodgingListPage",
  "PlacesListPage",
  "RailPage",
  "BusPage",
  "RentalsPage",
];

describe("logbook header actions wrap on a phone", () => {
  it("draws the action row once, and lets it wrap", () => {
    const header = readFileSync(resolve(__dirname, "../../components/ui/PageHeader.tsx"), "utf-8");
    expect(header, "PageHeader's action row must be allowed to wrap").toContain(
      'className="flex flex-wrap items-center"'
    );
  });

  it.each(PAGES)("%s hands its actions to the shared header", (name) => {
    const source = readFileSync(resolve(__dirname, `../${name}.tsx`), "utf-8");
    expect(source, `${name}: the header's actions slot is where its controls go`).toMatch(
      /actions=\{/
    );
  });
});
