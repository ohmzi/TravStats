# Action cohesion — why "nothing happened", and what closes it

Owner report, 2026-10-15, with six screenshots (tour route editor, recorded tracks
/ re-sync, trip dates, flight-trip card, Edit Journey modal, journey delete):

> someplace edit button is yellow and others its black, the back buttons aren't
> matching the save button in edit mode aren't in same location or design, delete
> button aren't the same design. I want all of these interactive buttons to look
> and feel the same as each other on different screens, edit flight trip, edit
> road trip, edit journey. edit flight trip shouldn't be a popup. all of these
> changes I asked in past but nothing happened.

## 1. The work did land — on the wrong screens

This is not a case of work being lost. The action-consistency branch is merged
and its commits are ancestors of `main` (`d8db2a921`, `c359c5967`, `489f49abb`,
`8e90f1fe4` all report `YES` against `HEAD`). The design system exists and is real:

| Primitive | What it is |
|---|---|
| `ui/Button.tsx` | the one button: variants `primary`/`secondary`/`danger`, sizes `default`(52px)/`toolbar`(46px), plus the exported `TOOLBAR_CONTROL_STYLE` |
| `ui/ActionLink.tsx` | the outline secondary `Link`, spreads `TOOLBAR_CONTROL_STYLE` |
| `ui/DetailHeader.tsx` | the one page head: back link (`.ts-back-link`, 13px, `←` + label, a real `Link` with history-aware back), title, domain tile, status, facts, `actions` slot |

What it was applied to is the gap. `489f49abb` — *"thirteen pages stop drawing
their own header"* — touched list and detail pages only. **The edit, route-editor,
resync and modal screens were never migrated.** Those are precisely the screens in
the screenshots, which is why the report reads "nothing happened": the change
happened somewhere the owner was not looking.

## 2. The three competing patterns

### Pattern A — the shared head (newest)

`DetailHeader` + `ActionLink`. Used by `FlightTripDetailPage`,
`FlightDetailPage`, `CruiseDetailPage`, `LodgingDetailPage`, `PlaceDetailPage`,
`BusDetailPage`, `FerryDetailPage`, `RailDetailPage`, `RentalDetailPage` and the
`EntityPage`/`EntityHeader` pair. Back link = `.ts-back-link`.

### Pattern B — the older entity pair

`EntityPage` + `EntityHeader` (used by `RoadtripDetailPage`, `TripDetailPage`).
`EntityHeader` still renders through `DetailHeader`, and its Edit is the outline
`ActionLink` — so this family is correct. **But the pages around it hand-roll their
own save rows**, which is where the drift lives.

### Pattern C — hand-rolled (the screens in the report)

| Screen | Evidence | What differs |
|---|---|---|
| `TripRouteEditorPage` back link | `TripRouteEditorPage.tsx:513` `className="text-xs text-(--text-muted) hover:underline"` | 12px, legacy token, no `.ts-back-link` — vs 13px in `DetailHeader:129` |
| `TourPointEditor` "Add point" / "Save points" | `TourPointEditor.tsx:214` `rounded-sm border border-(--color-border) px-3 py-1.5 text-sm`, `:222` `rounded-sm bg-(--accent) px-3 py-1.5 text-sm text-white` | 36px tall, 8px radius, `text-white` on amber. The recipe beside it is 46px, 12px radius, `--ts-accent-text` |
| `TripEditPage` Cancel / Save | `TripEditPage.tsx:432` `px-4 py-2 rounded-lg text-sm`, `:444` `px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base)` | same 36px/8px drift, `--accent` not `--ts-accent` |
| `TripModal` footer | `TripModal.tsx:452`, `:461` — byte-identical to the above | the modal and the page share the drift |
| `TripModal` shell | `TripModal.tsx:163` `className="fixed inset-0 z-50 ... bg-black/50"` | the one remaining hand-rolled overlay (`hand-rolled-overlay` = 1 in the baseline) |

`--ts-accent` is `#f0a947` (`tokens.css:25`); the legacy `--accent` is also
`#f0a947` (`index.css:319`). So the *hue* already matches — the visible
differences are **height (36 vs 46)**, **radius (8 vs 12)**, **label ink
(`text-white` vs `--ts-accent-text`)**, and **which token is read**.

## 3. The Edit-action contradiction, resolved

`EntityHeader.tsx:112` renders Edit as an outline `ActionLink` to the level's edit
page. `FlightTripDetailPage.tsx:258` renders Edit as an **amber primary `Button`
that opens a modal** (`:388`). One action, two skins, two destinations.

The design intent is already written down. `EntityHeader.tsx:22-24`:

> The modal's fields become a page at this path (design §4); the route is
> registered by the edit page's own task. — `editPath: /trips/${id}/edit`

And the route exists: `App.tsx` registers `/trips/:id/edit` → `TripEditPage`
(`TripEditPage.tsx` is a full page that reuses the modal's own form core,
`useTripForm`, in the modal's own four groups). So the modal on the flight-trip
page is a **left-over duplicate of a page that already shipped**. Removing it is
deletion, not new construction.

The rule that follows, and should be stated once: **Edit is navigation, so it is
the outline link; amber is for a commit (Save, Done).** A yellow Edit beside a
black Edit, and a yellow Edit that opens a popup, are both that rule being broken.

`FlightTripDetailPage.tsx:252-257` carries the owner's 2026-10-13 note that the
amber primary "stays". That note was about the icon-vs-label, not about Edit being
a commit; it is superseded by this report and the pre-existing design intent.

## 4. Why the ratchets did not catch it

They are frozen at the point the migration stopped, and they can only shrink:

- `scripts/action-consistency-baseline.json` — `legacy-palette`: `TripModal` 25,
  `TripEditPage` 20, `ToursPage` 18, `TourTrackList` 15, `TourLegList` 11,
  `TourPointEditor` 10, `TripRouteEditorPage` 4, `RoadtripEditSections` 2,
  `TourRecordingSummary` 2. `hand-rolled-overlay`: `TripModal` 1. Repo-wide:
  **3,774 occurrences across 460 files**, 814 raw self-styled `<button>`s, 89
  files importing `ui/Button`.
- `frontend/src/__tests__/detailHeaderFamily.test.ts` — asserts only
  `FlightDetailPage`, `CruiseDetailPage`, `LodgingDetailPage`, `PlaceDetailPage`
  render `DetailHeader` and build no head of their own. **No editor screen is
  covered**, so nothing fails when one hand-rolls its chrome.

## 5. Scope

In scope (the owner's named screens, plus the one shared component each uses):

1. `TripRouteEditorPage` — back link → `.ts-back-link`; the points/legs/tracks rows.
2. `TourPointEditor` — Add point / Save points → `ui/Button` (`secondary` / `primary`, `size="toolbar"`).
3. `TripEditPage` — Cancel / Save → `ui/Button`; back link; delete already `variant="danger"`.
4. `TripModal` — footer → `ui/Button`; shell → `ui/Dialog` if it keeps a modal role at all.
5. `FlightTripDetailPage` — Edit becomes an outline `ActionLink` to `/trips/:id/edit`; **the `TripModal` popup is removed**, so "edit flight trip" is a page.
6. `RoadtripDetailPage` / `TripDetailPage` — the hand-rolled Done/save rows join the shared recipe.
7. The resync screens (`TripResyncPage`, `RoadtripResyncPage`) — back link + actions.

Deliberately **out of scope**: the other 450-odd baselined files. Migrating them in
one pass is the "one unreviewable rewrite that collides with every open branch"
the ratchet's own header warns against.

## 6. Guards (so this cannot silently regress a third time)

1. Extend `detailHeaderFamily.test.ts` — or add an `editorChrome.test.ts` — asserting
   the editor/resync pages use the shared recipe: no hand-rolled `bg-(--accent)`
   button, no `fixed inset-0`, and the back link carries `ts-back-link`.
2. A test that **no primary-variant Edit exists**: navigation controls are
   `ActionLink`, so a `variant="primary"` whose label is Edit fails.
3. A test that the flight-trip page has **no modal editor** (no `TripModal` import),
   pinning "edit flight trip is a page".
4. Re-run `npm run check:actions` and shrink the touched entries via `--update`.

## 7. Definition of done

- The three named flows (edit flight trip, edit road trip, edit journey) draw the
  same back link, the same footer with Cancel/Save in the same place, and the same
  Delete treatment.
- "Edit flight trip" is a full page, not a popup.
- One Edit skin across every screen.
- New guards fail if any of the above regresses.
- Verified in a browser, not only by tests — the 2.5.0-beta.1 invisible-logo
  precedent in `CLAUDE.md` is the reason.
