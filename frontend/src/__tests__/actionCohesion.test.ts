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
 * The third round, same day, after the controls matched and the placement did
 * not:
 *
 * > all the edit buttons should be yellow … the resync from immich button
 * > should be next to the title but all the way right of screen rather than
 * > below it. same goes for delete too. basically go through flight trip, road
 * > trip and journey, all of the regular screen and then edit screen, the
 * > interactable buttons should be on the right side of screen and edit, save
 * > buttons should be yellow, delete red and others black, should be same
 * > design and size
 *
 * This file now pins the third round's rule: Edit and Save amber, Delete red,
 * the rest black, all 46; page actions beside the title, section actions in
 * `SectionHeader`, row actions as `RowActionButton`.
 *
 * This is a source scan, not a render, for the same reason that one is: what
 * it guards is that no editor grows its own chrome again. The rendered result
 * is covered by each screen's own test.
 */

const read = (path: string): string => readFileSync(resolve(__dirname, "..", path), "utf8");

/**
 * Every class string a file writes, whichever way it writes it.
 *
 * The first version of the underlined-word check matched a `className`
 * attribute followed by `"…underline…"`, i.e. one attribute ORDER: the `[^>]*`
 * between `<button` and `className` stops at the `>` of an arrow function, so
 * `<button type="button" onClick={() => void load()} className="underline">`
 * never matched — a guard that could not fail on the very form the tour
 * editors used (found twice: the journey tab files, 2026-10-15). Reading the
 * strings themselves is order-independent, and covers `className={…}`
 * templates, ternary strings and template literals alike.
 */
const classStrings = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/className=/g)) {
    const at = (m.index ?? 0) + "className=".length;
    if (src[at] === '"') {
      out.push(src.slice(at + 1, src.indexOf('"', at + 1)));
      continue;
    }
    if (src[at] !== "{") continue;
    let depth = 0;
    let end = at;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    for (const lit of src.slice(at + 1, end).matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
      out.push(lit[1] ?? lit[2] ?? lit[3] ?? "");
    }
  }
  return out;
};
// A bare `underline` token; `no-underline` and `decoration-*` are not it.
const underlines = (src: string): boolean =>
  classStrings(src).some((c) => /(^|\s)underline(\s|$)/.test(c));

/** Every screen the owner named, plus the shared components they draw. */
const EDITOR_SCREENS = [
  "pages/TripEditPage.tsx",
  "components/Trips/TourPointEditor.tsx",
  "components/Trips/TripModal.tsx",
  "pages/TripRouteEditorPage.tsx",
  "pages/TripResyncPage.tsx",
  "pages/RoadtripResyncPage.tsx",
  "pages/ToursPage.tsx",
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
    "components/ui/SectionHeader.tsx",
    "pages/ToursPage.tsx",
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

describe("no underlined word performs an action on the editor", () => {
  /**
   * An underlined word is not a button in this system (DESIGN_SYSTEM.md §6,
   * "Row"): the tour editors drew their row actions as underlined words, and
   * the owner could not tell which words were controls.
   *
   * The check reads every class string, not a button's attribute order — see
   * `classStrings` above for the version that could not fail. A load-error
   * Retry is an action too, so it gets no exception; `TripRouteEditorPage`,
   * `RoadtripDetailPage` and `JourneyTripsTab` were the last three carrying
   * one (2026-10-15).
   */
  it.each([
    "components/Trips/TourLegList.tsx",
    "components/Trips/TourTrackList.tsx",
    "components/Trips/TourPointEditor.tsx",
    "components/Roadtrips/RoadtripEditActions.tsx",
    "components/Roadtrips/StationEditor.tsx",
    "pages/TripEditPage.tsx",
    "pages/ToursPage.tsx",
    // The four the spec names for this rule; they were covered only by the
    // narrower patterns, which miss a handler-first `className` and an
    // `<a className={…underline…}>`.
    "components/Trips/TimelineActions.tsx",
    "components/Trips/TripGallery.tsx",
    "components/Trips/ImmichAlbumSection.tsx",
    "components/Trips/SummaryCard.tsx",
    // The three load/save Retries converted on 2026-10-15 — the files that
    // would have caught them are exactly this list.
    "pages/TripRouteEditorPage.tsx",
    "pages/RoadtripDetailPage.tsx",
    "components/Trips/JourneyTripsTab.tsx",
  ])("%s", (path) => {
    expect(underlines(read(path))).toBe(false);
  });

  it("flags an underlined class wherever the handler sits, and only a bare one", () => {
    expect(underlines('<button className="text-sm underline" onClick={() => setX()}>')).toBe(true);
    expect(underlines('<button onClick={() => setDraft([])} className="text-sm underline">')).toBe(
      true
    );
    expect(underlines('<button className="mt-1 underline text-sm" onClick={onRetry}>')).toBe(true);
    expect(underlines("<a className={`text-sm underline ${x}`}>")).toBe(true);
    expect(underlines('<a className={ok ? "underline" : "text-sm"}>')).toBe(true);
    expect(underlines('<button className="no-underline">')).toBe(false);
    expect(underlines('<button className="decoration-dotted disabled:no-underline">')).toBe(false);
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
    // The shared check, not the per-attribute-order regex this used to be:
    // that one could not match a `className` written after its handler, which
    // is why it stayed green over two underlined actions (2026-10-15).
    expect(underlines(src)).toBe(false);
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

describe("a section's own actions are drawn by the section header", () => {
  /**
   * Spec §The rule, level 2 (2026-10-15): the SECTION level's controls live in
   * `ui/SectionHeader` — the one component that owns "label left, this
   * section's actions right". The spec's Testing section asks for a check that
   * fails on "a section action on these screens drawn outside SectionHeader",
   * and there was none: the only `SectionHeader` pattern in this file sat
   * inside the right-alignment alternative, where a plain `justify-end` or an
   * unrelated `ml-auto` satisfied it. So a file could leave the shared header
   * and stay green.
   *
   * Two rows are exempt, and the spec records it: the TAB toolbars
   * (`TimelineActions`, `TripGallery`) sit at the top of a tab the tab strip
   * already names, so a `SectionHeader` there would print that name a second
   * time as a section label. Their placement is not waived — the case above
   * holds them to the right edge, and the underline and raw-`<button>` cases
   * hold their controls.
   *
   * What this can prove is narrow, and worth saying: that these files still
   * HAND a section's actions to `SectionHeader`. A file that moves one row out
   * and leaves another behind still passes; where the rows land is covered by
   * each screen's rendered test.
   */
  const SECTION_ROWS = [
    "components/Trips/TourPointEditor.tsx",
    "components/Trips/TourTrackList.tsx",
    "components/Trips/TourLegList.tsx",
  ] as const;

  it.each(SECTION_ROWS)("%s hands a section's actions to SectionHeader", (path) => {
    expect(read(path)).toMatch(/<SectionHeader[\s\S]*?\sactions=/);
  });

  it("rejects a title-only header — the form that proves nothing", () => {
    // The self-test that makes the pattern above mean something. A bare
    // `<SectionHeader />` carries no controls, and an earlier version of the
    // sibling right-alignment check accepted exactly that shape as proof of
    // placement. `RoadtripDatesSection` is the live case: its header is a
    // title line, and its "Save dates" is a deliberate `ml-auto` in the row
    // below, on the baseline of the fields it saves — so it is NOT in the list
    // above, and a check that accepted it would be teaching the wrong rule.
    expect('<SectionHeader title={t("x")} />').not.toMatch(/<SectionHeader[\s\S]*?\sactions=/);
    expect('<SectionHeader title={t("x")} actions={<Button>Go</Button>} />').toMatch(
      /<SectionHeader[\s\S]*?\sactions=/
    );
  });
});

describe("a failed load or save is answered with the shared control", () => {
  /**
   * A Retry is an action, and the rule has no exception for the ones a failure
   * produces (spec §The rule, 2026-10-15). Three survived the branch as
   * underlined words — the road-trip editor's failed load, the station
   * editor's failed autosave and the journey's Trips tab — found by two lenses
   * in the whole-branch review of 2026-10-15. They are `Button
   * variant="secondary" size="toolbar"` now, the control every other retry on
   * these screens draws.
   *
   * A source scan, like the rest of this file: reaching a page's failure arm
   * needs its whole API mocked, and what is guarded here is that the control is
   * the shared one rather than a word with a handler. The rendered half is
   * covered where the failure arm has a test of its own (`JourneyTripsTab`
   * asserts `data-variant`).
   */
  it.each([
    ["pages/TripRouteEditorPage.tsx", "common:buttons.retry"],
    ["pages/RoadtripDetailPage.tsx", "roadtrips:editor.status.retry"],
    ["components/Trips/JourneyTripsTab.tsx", "common:buttons.retry"],
  ])("%s renders its retry as the shared Button", (path, key) => {
    const buttons = (read(path).match(/<Button\b[\s\S]*?<\/Button>/g) ?? []).filter((b) =>
      b.includes(key)
    );
    expect(buttons).not.toHaveLength(0);
    for (const b of buttons) {
      expect(b.slice(0, b.indexOf(">")), `${key} is not Button variant="secondary"`).toMatch(
        /variant="secondary"/
      );
    }
  });

  it("rejects the hand-rolled retry it replaced", () => {
    // The exact form all three had — and the point of the check: a `<button>`
    // is not a `<Button>`, so the case above fails on it rather than passing
    // because the label happens to be there.
    const handRolled =
      '<button type="button" className="mt-3 underline text-sm" onClick={() => void load()}>' +
      '{t("common:buttons.retry")}</button>';
    const buttons = (handRolled.match(/<Button\b[\s\S]*?<\/Button>/g) ?? []).filter((b) =>
      b.includes("common:buttons.retry")
    );
    expect(buttons).toHaveLength(0);
  });
});
