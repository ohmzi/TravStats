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

describe("every action row ends at the right edge", () => {
  /**
   * The owner's standing instruction, 2026-10-15, after the first round of this
   * fix was still "unsatisfied": *"still unsatisfied, look at all these buttons
   * some are left and some right … lets move all the interactive buttons on the
   * right side of screen"*.
   *
   * So this is the second half of the rule the recipe fix missed. The first
   * round made the CONTROLS identical (46px, 12px radius, 16/700) and left
   * their POSITIONS disagreeing: the journey's Cancel/Save sat right while the
   * tour editor's Add point/Save points sat left, and the road trip's Done sat
   * left under a status line. Same buttons, still two layouts.
   */
  const ACTION_ROWS = [
    "components/ui/FormFooter.tsx",
    "pages/TripEditPage.tsx",
    "components/Trips/TourPointEditor.tsx",
    "components/Trips/TripModal.tsx",
    "pages/RoadtripDetailPage.tsx",
    "components/Roadtrips/RoadtripDatesSection.tsx",
    "components/Trips/TourTrackList.tsx",
    "components/Trips/TourLegList.tsx",
  ] as const;

  it.each(ACTION_ROWS)("%s aligns its controls to the end", (path) => {
    const src = read(path);
    // One of the sanctioned ways to reach the right edge: the shared footer
    // (which owns `justify-end`), a section header that is GIVEN an actions
    // slot (it owns the `ml-auto` on that group — the legs list's "Route the
    // whole tour" lives there; a title-only header carries no controls and
    // proves nothing), or an explicit right alignment where neither fits (a
    // row of inputs with a Save beside them).
    const endsRight =
      src.includes("FormFooter") ||
      /<SectionHeader\b[^>]*\sactions=/.test(src) ||
      /justify-end/.test(src) ||
      /ml-auto/.test(src);
    expect(endsRight).toBe(true);
  });

  it("FormFooter itself pins the controls right", () => {
    const src = read("components/ui/FormFooter.tsx");
    expect(src).toContain("justify-end");
    // The hint may wrap to its own line; the controls still hold the edge.
    expect(src).toContain("ml-auto");
  });
});

describe("an edit page carries Re-sync and Delete in its header", () => {
  /**
   * Owner, 2026-10-15: "the resync from immich button should be next to the
   * title but all the way right of screen rather than below it. same goes for
   * delete too." The previous round put both in sections under the form's
   * Save row, left-aligned (`DangerSection`).
   */
  it("TripEditPage hands both to PageHeader's action slot", () => {
    const src = read("pages/TripEditPage.tsx");
    expect(src).toMatch(
      /<PageHeader[\s\S]*actions=\{[\s\S]*<ResyncFromImmich[\s\S]*variant="danger"/
    );
    expect(src).not.toContain("DangerSection");
  });

  it("FlightPanel edits a trip on its page, not in TripModal", () => {
    expect(read("components/FlightPanel.tsx")).not.toMatch(/import\s+TripModal\s+from/);
  });

  it("the road-trip editor hands both to PageHeader's action slot", () => {
    const page = read("pages/TripRouteEditorPage.tsx");
    expect(page).toMatch(/<PageHeader[\s\S]*actions=\{[^}]*<RoadtripEditActions/);
    const actions = read("components/Roadtrips/RoadtripEditActions.tsx");
    expect(actions).toContain('variant="danger"');
    expect(actions).not.toContain("DangerSection");
  });
});

describe("Edit is the amber link on every detail head", () => {
  /**
   * Owner, 2026-10-15 (third round): "all the edit buttons should be yellow …
   * edit, save buttons should be yellow, delete red and others black". The
   * previous round made Edit the black outline on the rule "amber belongs to
   * the one control that commits"; the owner reversed it. Edit stays a LINK —
   * a destination, so a middle click opens it in a new tab — in the amber skin.
   */
  const HEADS = ["pages/FlightTripDetailPage.tsx", "components/Entity/EntityHeader.tsx"] as const;

  it.each(HEADS)("%s draws Edit as ActionLink variant=primary", (path) => {
    expect(read(path)).toMatch(
      /<ActionLink[^>]*variant="primary"[^>]*>\s*\{t\("common:buttons.edit"\)\}/
    );
  });
});

describe("a flight trip is edited on its own page", () => {
  it("the flight-trip page opens no popup", () => {
    expect(read("pages/FlightTripDetailPage.tsx")).not.toMatch(/import\s+TripModal\s+from/);
  });

  it("the flight-trip head links to the flight trip's edit page, not the journey's", () => {
    // Owner, 2026-10-15: "what i wanted was that flight edit popup to be
    // converted into edit page" — the previous round sent it to
    // `/trips/:id/edit`, which says "Edit Journey" and returns to the journey.
    const src = read("pages/FlightTripDetailPage.tsx");
    expect(src).toContain("to={`/flights/journeys/${trip.id}/edit`}");
    expect(src).not.toContain("to={`/trips/${trip.id}/edit`}");
  });
});

describe("the journey's tabs draw the shared controls, at the right", () => {
  /**
   * Owner, 2026-10-15: "go through flight trip, road trip and journey, all of
   * the regular screen … the interactable buttons should be on the right side
   * of screen … should be same design and size". These were hand-rolled 12px
   * outlines and underlined words; the gallery's Upload was a second amber.
   */
  const TAB_CONTROLS = [
    "components/Trips/TimelineActions.tsx",
    "components/Trips/TripGallery.tsx",
    "components/Trips/ImmichAlbumSection.tsx",
    "components/Trips/SummaryCard.tsx",
    "components/Trips/TimelineJournalCard.tsx",
    "components/Trips/TimelineNoteCard.tsx",
  ] as const;

  it.each(TAB_CONTROLS)("%s draws no hand-rolled or underlined action", (path) => {
    const src = read(path);
    expect(src).not.toContain("bg-(--accent)");
    expect(src).not.toMatch(/borderColor: "var\(--accent\)"/);
    expect(src).not.toMatch(/border: "1px solid var\(--accent\)"/);
    expect(src).not.toMatch(/<button[^>]*className="[^"]*underline/);
    expect(src).not.toMatch(/className="px-3 py-1\.5 rounded/);
  });

  /**
   * The regexes above know the old hand-rolled forms of four of these files
   * only; `TimelineNoteCard`'s `className="rounded-lg px-3 py-1.5 text-xs"` and
   * `TimelineActions`' `BUTTON` constant matched none of them, so the case
   * passed before the change. These four draw nothing but `Button`,
   * `RowActionButton` and `ActionLink` — a raw `<button` here is a control that
   * has stopped being one of them. (TripGallery and ImmichAlbumSection are out:
   * the photo tile's overlay delete and the day-grouping switch are not
   * toolbar actions.)
   */
  it.each([
    "components/Trips/TimelineActions.tsx",
    "components/Trips/TimelineNoteCard.tsx",
    "components/Trips/TimelineJournalCard.tsx",
    "components/Trips/SummaryCard.tsx",
  ])("%s draws no raw <button>", (path) => {
    expect(read(path)).not.toMatch(/<button\b/);
  });

  it.each(["components/Trips/TimelineActions.tsx", "components/Trips/TripGallery.tsx"])(
    "%s ends its action row right",
    (path) => {
      expect(read(path)).toMatch(/justify-end|ml-auto/);
    }
  );
});
