# Edit is amber, actions end right — the trip action-layout design

Date: 2026-10-15. Owner request, the third round on these screens:

> all the edit buttons should be yellow … what i wanted was that flight edit
> popup to be converted into edit page … the resync from immich button should be
> next to the title but all the way right of screen rather than below it. same
> goes for delete too. basically go through flight trip, road trip and journey,
> all of the regular screen and then edit screen, the interactable buttons should
> be on the right side of screen and edit, save buttons should be yellow, delete
> red and others black, should be same design and size, and other buttons like
> route the whole tour, upload recording, pull from dawarich etc all these should
> be rechecked and create new best placement for them … they should have a
> beautiful structure like apple made it

"Yellow" is the app's accent (`--ts-accent`, #f0a947), not a new colour.

## What this reverses

Two rules from the previous rounds (`4221757b6`, `71fb1f2d5`) were the owner's
complaint, not its fix:

- **"Amber belongs to exactly one control per screen — the one that commits."**
  It made Edit an outline link. The owner wants Edit amber. The new rule is
  about the *kind* of action, not how many there are on a screen.
- **`DangerSection` at the foot of the edit page.** Delete and Re-sync sat
  below the form's own Save row, left-aligned. They move into the page header,
  right.
- **"Edit flight trip" → the journey edit page.** The previous round deleted
  the popup and sent the flight trip to `/trips/:id/edit`, which says "Edit
  Journey" and returns to the journey. The owner wanted the popup *converted*:
  a flight-trip edit page.

## The rule

### Colour, by what the button does

| Action | Colour | Component |
|---|---|---|
| Edit (navigates to an edit screen) | amber | `ActionLink variant="primary"` |
| Save / Save dates / Save points / Done (commits) | amber | `Button variant="primary" size="toolbar"` |
| Delete a whole thing; Remove cover | red | `Button variant="danger" size="toolbar"` |
| Everything else | black (the outline) | `Button variant="secondary" size="toolbar"`, `ActionLink` default, `MenuButton` |

### Size

Every control in this family is 46 px, 12 px radius, 16/700 — `size="toolbar"`.
The 52 px primary does not appear on these screens, so Edit, Save and Delete
are the same size.

### Placement — three levels, always ending right

1. **Page.** `BackLink` above; title left; the page's actions on the title's
   line at the far right. Order left→right: black, amber, red.
2. **Section.** Section title left (the `t-label-mono` label every detail
   section uses); that section's actions on the same line at the right. One
   shared component: `ui/SectionHeader`.
3. **Row.** Inside a list of many (points, legs, tracks, timeline cards, tours),
   actions are `RowActionButton` icons at the row's right end. The row delete
   icon is red at rest, not only on hover — "delete red" holds at every level.
   No underlined word ever performs an action on these screens.

The form commit row stays `FormFooter`: Cancel (black), Save (amber), right,
sticky above the safe area on a phone.

## Screens

### Flight trip — `/flights/journeys/:tripId`

- Header actions: `[Open trip]` black, `[Edit]` amber →
  `/flights/journeys/:tripId/edit`.

### Flight trip edit — new, `/flights/journeys/:tripId/edit`

- `BackLink` → the flight trip; title "Flugreise bearbeiten / Edit flight trip"
  (the German is one word — this line said "Flug-Reise" until the whole-branch
  review of 2026-10-15; the copy was right and the spec was not).
- Header actions: `[Re-sync from Immich]` black → `/trips/:id/resync`,
  `[Delete]` red → `TripDeleteConfirm`; after delete → `/flights`, the
  flights logbook the flight-trip page's own back link points at.
- Body: the popup's four tabs (General, People, Appearance, Notes) become
  sections on one scrolling page — the same sections the journey edit page
  draws.
- Save returns to the flight trip.
- Implementation: `TripEditPage` takes a `context` prop (`"journey" |
  "flightTrip"`) that picks the title, the back target and the post-save /
  post-delete target; `FlightTripEditPage` is a one-line wrapper. Same
  `useTripForm`, so the two pages cannot drift. (Not an extraction into a new
  file: the body reads legacy-palette tokens, and a new file carrying them
  would be a new `check:actions` offender.) Route guarded by
  `DomainRouteGuard domain="flight"` like its parent.
- `FlightPanel` (dashboard side panel) Edit navigates here instead of opening
  `TripModal`. `TripModal` remains only for *creating* a trip from the import
  flow (`tripAdapter.tsx`) — out of scope.

### Journey — `/trips/:id`

- Header: `[Edit]` amber.
- Timeline tab: the tab's own action row, black, at the right —
  `[Journal entry] [Add entry] [Add weather]`.
  **Ruling (whole-branch review, 2026-10-15): this row and the gallery's are the
  TAB's toolbar, not a section's.** They sit at the top of a tab the tab strip
  already names, so a `SectionHeader` here would print that name a second time
  as a section label; level 2 is about sections *within* a page (DATES, POINTS,
  ROUTE, RECORDINGS), which is why this bullet said `SectionHeader` in the
  first draft and why that reading was wrong. Nothing is waived by the ruling:
  the row ends right, its controls are the shared `Button`, and both are held
  by `actionCohesion` (`ends its action row right`, the underline case, the
  raw-`<button>` case). Timeline card actions (`TimelineJournalCard`,
  `StopCard`, `TimelineNoteCard`) become row icons at the card's right.
- Gallery tab: `[Upload] [Link Immich album]` black, right (Upload loses its
  hand-rolled amber fill). `ImmichAlbumSection`: `[Re-sync] [Unlink]` black
  buttons right; "delete copies" red.
- Overview: `SummaryCard` Generate / Regenerate become black `Button`s.

### Journey edit — `/trips/:id/edit`

- Header actions: `[Re-sync from Immich]` black, `[Delete]` red. The two
  sections below the footer go.
- The "what goes and what survives" sentence (`deleteJourneyHint`) moves into
  the confirm dialog.
- Cover row: `[Choose image]` black, `[Remove]` red, right.
- `FormFooter`: `[Cancel] [Save]`.

### Road trip — `/roadtrips/:id`

- Header: `[Edit]` amber.
- Station editor (`?station=…`): `[Done]` amber, right (unchanged).
  `StationEditor` move/remove stay `IconButton`s at the row's right.
- Station timeline "+ Day tour" and "Edit leg": compact black buttons at the
  row's right instead of dashed chips.
- Logistics: `[Add a cost]` and `[Take over as train ride]` already right,
  already secondary — confirmed, not changed.

### Road trip edit / tour editor — `TripRouteEditorPage`

```
← Back to the trip
Alpen 2026                     [Re-sync from Immich] [Delete trip]

DATES
 from [  ]  to [  ]                               [Save dates]
POINTS                                            [+ Add point]
 Munich ─ location ─ via ○                          ↑  ↓  🗑
 Innsbruck ─ location ─ via ○                       ↑  ↓  🗑
                                                 [Save points]
ROUTE                                    [Route the whole tour]
 Munich → Innsbruck   [car ▾] [OSRM ▾]                    ✕
RECORDINGS                                   [Add recording ▾]
 morning-ride.gpx   42 km                               ⤓  🗑
```

- Header (roadtrip): `[Re-sync from Immich]` (only when filed on a journey, as
  today) and `[Delete trip]`. `RoadtripEditSections` stops drawing sections and
  supplies these two header actions plus its confirm dialogs.
- Header (tour, `/tours/:id`, `/trips/:id/route/:routeId`): no Re-sync. No
  Delete is added here — tour delete stays on the tours list (scope).
- Dates: Save dates stays amber, bottom-right of the section.
- Points: `[+ Add point]` moves to the section header; `[Save points]` amber
  stays bottom-right (`FormFooter`). Row: `↑ ↓` become `RowActionButton` icons
  (`moveUp`/`moveDown`), Remove the red row icon — the Screens bullet said
  `IconButton` until the whole-branch review of 2026-10-15, and the Components
  table below said `RowActionButton` all along. The Components table was right:
  a 44×44 raised tile between two 28px row icons would be a second kind of
  control in one row. Add point also brings its new row into view and focuses
  it — the row is appended at the END of a list that sits under a 540px map, so
  appending it silently looked like nothing had happened (review, 2026-10-15).
- Route: `[Route the whole tour]` in the section header, a real `Button`
  (today a hand-rolled 12 px control). Row "Remove line" → row icon.
- Recordings: one `[Add recording ▾]` `MenuButton` in the section header —
  Upload file…, From Dawarich, From Strava. An unavailable source is a disabled
  item that shows its reason. Rows: `⤓` GPX download and red `🗑` delete icons.
  The upload item calls the hidden file input's `click()` — this also fixes the
  file `<input>` nested in a `<button>` that today does not reliably open.

### Tours list — `/tours`

- The create form's hand-rolled amber Save (`bg-(--accent) text-white`) → `Button
  primary toolbar`.
- Per-tour Delete → the red row icon (it was a full danger button in a row,
  against the row rule).

## Components

| Component | Change |
|---|---|
| `ui/ActionLink` | gains `variant?: "primary" \| "secondary"`; primary = amber, same 46 px recipe |
| `ui/SectionHeader` | new: `title`, `actions?`; label left, actions right, wraps |
| `ui/MenuButton` | new: black toolbar button + ▾; `items: {label, onSelect, disabled?, reason?}[]`; `role="menu"`, arrow keys, Esc, click-outside; disabled items show the reason |
| `table/RowActionButton` | delete icon red at rest; gains `download` and `moveUp`/`moveDown` kinds if not present |
| `ui/DangerSection` | deleted (both users move to header actions) |
| `pages/TripEditPage` | `context` prop; Re-sync and Delete in `PageHeader.actions` |
| `pages/FlightTripEditPage` | new, one line: `<TripEditPage context="flightTrip" />` |
| `EntityHeader`, `FlightTripDetailPage` | Edit → `ActionLink variant="primary"` |

DE and EN copy move together (`localeKeyParity`). New keys: the flight-trip edit
title, `Add recording`, the three menu items, and any delete-hint wording moved
into a dialog.

## What this does not do

- It does not touch the single flight's `FlightEditModal` (`/flights/:id`) or
  the other domains' edit popups — the modal-vs-page question stays open for
  them.
- It does not touch `TripModal`'s create path.
- It does not migrate the legacy palette in files it only passes through,
  beyond what the ratchet requires (it may only shrink).

## Testing

- `actionCohesion.test.ts`, rewritten for the new rule — fails on:
  - an Edit that is not `ActionLink variant="primary"` on the three detail heads;
  - `DangerSection` or a footer-below Re-sync on an edit page;
  - a section action on these screens drawn outside `SectionHeader`
    (`a section's own actions are drawn by the section header`, which fails on
    a `SectionHeader` without an `actions` slot as well as on its absence — the
    two tab toolbars are ruled exempt above);
  - an underlined-text action in the listed files (the list grows to include
    `TourLegList`, `TourTrackList`, `ToursPage`, `TimelineActions`,
    `TripGallery`, `ImmichAlbumSection`, `SummaryCard`, and the three load/save
    Retries converted on 2026-10-15: `TripRouteEditorPage`, `RoadtripDetailPage`,
    `JourneyTripsTab`);
  - a load or save Retry that is not the shared `Button` in those three files;
  - `FlightPanel` importing `TripModal` for edit;
  - `FlightTripDetailPage`'s Edit pointing anywhere but
    `/flights/journeys/:id/edit`.
- Unit tests for `SectionHeader`, `MenuButton` (keyboard, disabled reason,
  outside click) and `ActionLink` variant.
- `FlightTripEditPage` test: back target, save returns to the flight trip,
  delete confirm.
- `TourTrackList` test: the upload menu item opens the file input.
- `design/DESIGN_SYSTEM.md` §6 states the colour table and the three placement
  levels; `designDocClaims.test.ts` pins the colour table.
- Browser verification on the running app, every screen above, measuring each
  control's height and its distance from its row's right edge. Tests passed
  last round while the layout was wrong; a look is part of done.
