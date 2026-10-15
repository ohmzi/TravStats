# One action, one shape — the action-consistency design

Date: 2026-10-14. Owner request: editing the same kind of thing must look the
same everywhere, "rather than each looking unique and different apart".

## Why this exists

The 2026-09-15 redesign introduced a design system with a small primitive
library and one rule, stated at `DESIGN_SYSTEM.md:230`:

> Every primitive reads tokens only; a page never styles a card, button, pill or
> dialog frame itself.

The migration reached roughly half the app and stopped. `DESIGN_SYSTEM.md` §10
named four checks to land with it; only `generate-theme.mjs` was ever written.
The other three — a hex-literal scan, a raw-Tailwind-palette scan, and a scan
keeping `fixed inset-0` out of everything but `Dialog.tsx` — do not exist. So
there was nothing to finish the job and nothing to stop it drifting back.

The doc predicted this in its own words: *"A system that lives only in a
document ages like the ones before it."* It aged in five weeks.

## What it measures

Measured on 2026-10-14 across `frontend/src`:

| | Legacy palette (`index.css`) | Design system (`theme/tokens.css`) |
|---|---|---|
| Files referencing it | 452 | 328 |
| Token occurrences | 3,468 | 1,750 |
| Action call sites | `.btn-*` utilities: 220, in 110 files | `ui/Button`: 184, in 80 files; `ActionLink` + `IconButton`: 12 |

Files hand-rolling a `fixed inset-0` overlay, beside `Dialog.tsx`: **12**.

A six-group inventory of every page's action controls found **~38 distinct
button recipes**: 12 in the transport domains, 14 in lodging/places, 12 in
auth/dashboard/map, plus the trips cluster. They differ in radius (4, 6, 8, 10,
12 px), label size (12, 13, 14, 16 px), height (~20 → 52 px), and palette.

The same word wears a different control depending on which half of the
migration its page fell into:

| Consequence | Where | Today |
|---|---|---|
| Delete a journey | `TripEditPage.tsx:458` | `ui/Button variant="danger"` |
| Delete a trip | `RoadtripEditSections.tsx:73` | a bare `<button className="underline">` |
| Delete a ferry | `FerryDetailPage.tsx:134` | `ui/Button` **secondary** — no danger cue at all |
| Delete a loyalty card | `MembershipManager.tsx:399` | a small red text link, **no confirmation** |
| Confirm any of them | `ConfirmModal.tsx:67` | legacy red fill on a legacy footer |

## Root cause

Not ten button bugs. Three shared structures carry the drift, and each is one
file:

1. **`components/Training/ConfirmModal.tsx`** — 33 call sites, every delete
   confirmation in the app, 84 lines, entirely legacy. One file lifts ~33
   dialogs onto the design system.
2. **`components/table/*`** — `ListEmptyState`, `ListFilterBar`, `ColumnPicker`,
   `TablePagination`, `RowActionButton` (14 users). These are the logbook list
   pages' entire chrome; repairing them repairs every list page at once.
3. **Two page headers** — `PageHeader` (11 users) and `DetailHeader` (11 users),
   split list-page vs detail-page, while several list pages hand-roll a third
   (`<h1 className="t-screen-title">` plus their own action row).

## The convention

Skin: every action control renders `ui/Button`, `ui/ActionLink` or
`ui/IconButton`. Nothing else. Two sizes — `default` (52 px) for a CTA that
stands alone, `toolbar` (46 px) for anything in a row. `TOOLBAR_CONTROL_STYLE`
is the one recipe, and it is spread, never retyped.

Placement, by what the action belongs to:

| The action belongs to | It sits | Notes |
|---|---|---|
| the page | the header's `actions` slot | at most two; a destructive trigger goes last |
| a section | that section's heading row | one action, right-aligned beside its `<h2>` |
| a section's data | that section's trailing row | the save/commit pair, right-aligned at the end of its content |
| a section taller than a viewport | the sticky bottom footer | phone only; desktop keeps it in the flow |
| a dialog | the footer | exactly one action, plus the shell's own dismiss |
| a list or table row | `RowActionButton` | icons only, never labels |

Destructive actions, in one shape:

- **Trigger** — `Button variant="danger"` (tinted outline) at page level, or a
  danger `RowActionButton` in a row. Never a bare underlined word.
- **Confirm** — `Button variant="danger"` in the dialog footer, where the object,
  the reach and the consequence are stated.
- **Never immediate.** An action that destroys without asking is a defect, not a
  style (`MembershipManager.tsx:399` is the one live example).

`DELETE_BUTTON_CLASS` (`lib/deleteConfirm.ts:88`) retires; the red fill is not a
second danger treatment, it is the legacy one.

### Open, deliberately

`DESIGN_SYSTEM.md:235` reads *"`danger` only inside a confirm dialog"*. Read
strictly that forbids the page-level danger trigger this design keeps. Four of
the five transport detail pages already use it in their header, so this design
follows the majority and gives `FerryDetailPage` the cue it lacks, rather than
removing the cue from the other four. The doc's line should be amended to say
"a confirm dialog, or the page-level trigger that opens one".

## The model to copy

There is no need to invent a target page — one exists.

`RentalDetailPage` / `BusDetailPage` / `RailDetailPage` / `CruiseDetailPage`
carry an entirely design-system action surface: `DetailHeader.actions` with
`Button` secondary for Edit and `danger` for Delete, a `Button` retry on load
failure, and `ConfirmModal` for the confirmation. Their remaining legacy is
confined to the form modal they open.

`components/Trips/tripBuilder/*` is the second model: nearly all `--ts-*`, and
`FerryFormModal.tsx:211/219` is the only modal footer in the transport group
already built from `ui/Button`.

## Migration order

Each step is independently shippable and leaves the app consistent.

1. **The ratchet first** (`scripts/check-action-consistency.mjs`). Freeze today's
   offender lists per rule. Until this exists, every step below can silently
   regress, which is exactly what happened between 2026-09-15 and today.
2. **`ConfirmModal`** — one file, 33 call sites, every delete dialog in the app.
3. **`components/table/*`** — one fix, every logbook list page.
4. **The page header** — retire the third hand-rolled shape; every page uses
   `PageHeader` or `DetailHeader`.
5. **The trip / roadtrip edit surface** — `TourPointEditor`, `TourLegList`,
   `RoadtripEditSections`, `TourTrackList`.
6. **The journey edit surface** — `TripEditPage`'s sticky Cancel/Save row,
   `TimelineActions`, `TripGallery`.
7. **`FerryDetailPage`** — gains the danger cue its four siblings have.
8. **The long tail** — `components/Trips/**` beyond the builder, settings, admin,
   the map control kit, the auth pages.

Steps 5–8 are the bulk by line count and the least risky by behaviour: they
change skins and placement, not logic.

## What this does not do

- It does not touch the two API response shapes (ADR 0001) — that is a server
  decision, settled.
- It does not redraw the map control kit (`components/map/controlPanelKit.tsx`)
  or the globe panels. Those read a raw-RGB kit on purpose — they sit over
  imagery, not over app surfaces — and are legitimately their own layer. They
  keep their own consistency, and the ratchet's rule for them is separate.
- It does not resolve the modal-vs-page edit question for the other domains.
  Every non-trip domain edits in a modal; trips and roadtrips edit on a page.
  The owner's ruling covers the flight trip; the other five are open.

## Testing

Every behaviour change ships with a test that fails without it. Where a test
cannot see the thing — a size, a radius, a height — the change gets a browser
look, and the test asserts the recipe (`style.height` is
`var(--ts-size-button-secondary)`), the way
`components/ui/__tests__/primitives.test.tsx` already does.
