import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The owner's report of 2026-10-15, as a test — the second time they raised it:
 *
 * > someplace edit button is yellow and others its black, the back buttons
 * > aren't matching the save button in edit mode aren't in same location or
 * > design, delete button aren't the same design. I want all of these
 * > interactive buttons to look and feel the same as each other on different
 * > screens, edit flight trip, edit road trip, edit journey. edit flight trip
 * > shouldn't be a popup. all of these changes I asked in past but nothing
 * > happened.
 *
 * Why it happened: the design-system migration (`489f49abb`, "thirteen pages
 * stop drawing their own header") landed on the list and DETAIL pages. The
 * edit, route-editor and resync screens were never migrated, so they kept a
 * second button language — 36px controls, `rounded-lg`, `--accent` and
 * `text-white` against the primitive's 46/`--ts-radius-button`/`--ts-accent`.
 * `detailHeaderFamily.test.ts` could not see it: it names four detail pages
 * and no editor.
 *
 * This is a source scan, not a render, for the same reason that one is: what
 * it guards is that no editor grows its own chrome again. The rendered result
 * is covered by each screen's own test.
 */

const read = (path: string): string => readFileSync(resolve(__dirname, "..", path), "utf8");

/** Every screen the owner named, plus the shared components they draw. */
const EDITOR_SCREENS = [
  "pages/TripEditPage.tsx",
  "components/Trips/TourPointEditor.tsx",
  "components/Trips/TripModal.tsx",
  "pages/TripRouteEditorPage.tsx",
  "pages/TripResyncPage.tsx",
  "pages/RoadtripResyncPage.tsx",
] as const;

describe("one control language on the edit screens", () => {
  it.each(EDITOR_SCREENS)("%s draws no hand-rolled accent control", (path) => {
    const src = read(path);
    // The token the drifted footers and cover buttons wrote by hand. The
    // primitive reaches `--ts-accent` through `variant="primary"`, so a
    // literal `bg-(--accent)` / `var(--accent)` in a control means the recipe
    // was copied again. (`--accent` is still the legacy palette's entry in
    // `index.css`; `check:actions` ratchets its remaining uses per file.)
    expect(src).not.toContain("bg-(--accent)");
    expect(src).not.toContain('style={{ borderColor: "var(--accent)"');
  });

  it.each(EDITOR_SCREENS)("%s draws its commit row at the shared height", (path) => {
    // A primary in a footer row draws the row's 46, never the lone-CTA 52.
    // Measured in a browser on 2026-10-15: `/tours/:id` rendered "Add point" at
    // 46 beside "Save points" at 52 — one row, two heights, which is the same
    // class of defect the owner reported ("no button should be heightwise
    // bigger than other"). `Button` cannot know it is in a row, so the row
    // height is stated: `size="toolbar"`.
    const src = read(path);
    const primaries = src.match(/<Button\b[\s\S]*?>/g) ?? [];
    const inRow = primaries.filter((b) => /variant="primary"/.test(b));
    const tall = inRow.filter((b) => !/size="toolbar"/.test(b));
    expect(tall).toEqual([]);
  });
});

describe("edit navigation is always the outline link", () => {
  const NAVIGATION_SCREENS = [
    "pages/FlightTripDetailPage.tsx",
    "components/Entity/EntityHeader.tsx",
  ] as const;

  it.each(NAVIGATION_SCREENS)("%s offers Edit as an ActionLink, not a button", (path) => {
    const src = read(path);
    // Edit is a DESTINATION, so it is a link: a middle click has to open it in
    // a new tab, which a `<button>` cannot do. The flight-trip head carried an
    // amber primary Edit that opened a popup while the journey and roadtrip
    // heads carried a black outline Edit that navigated — one action, two
    // skins, two behaviours.
    expect(src).toMatch(/<ActionLink[^>]*>\s*\{t\("common:buttons.edit"\)\}/);
  });
});

describe("a journey is edited on a page, not in a popup", () => {
  it("the flight-trip page does not open TripModal", () => {
    // "edit flight trip shouldn't be a popup" (owner, 2026-10-15). The modal's
    // fields already exist as a page: `/trips/:id/edit` → `TripEditPage`, which
    // shares the modal's own `useTripForm` core. So importing the modal here is
    // reaching for a second edit surface, not the only one.
    //
    // The import only — the page's own comment explains why the modal is gone,
    // and spelling the name there is the point of the comment.
    expect(read("pages/FlightTripDetailPage.tsx")).not.toMatch(
      /import\s+TripModal\s+from/
    );
  });

  it("the flight-trip head links to that page", () => {
    expect(read("pages/FlightTripDetailPage.tsx")).toContain('to={`/trips/${trip.id}/edit`}');
  });
});
