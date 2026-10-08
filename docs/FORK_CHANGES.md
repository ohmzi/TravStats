# What this fork changes, and how it fits together

This is a personal fork of [TravStats](https://github.com/Abrechen2/TravStats). It is
kept close to upstream — the changes below are additions, and everything else is
upstream's own work, rebased on each release.

## Why

A travel logbook holds structured history: where you were, when, how you got
between places, and what it cost. Most of that is worth MORE than the app itself
shows — the same rows can answer questions the UI was never built to ask.

So two themes run through this fork:

1. **Expose the data.** Journeys, their legs and their media are reachable through
   the API in a shape an external application can digest, so other tools can build
   their own views on top of it — a dashboard, a countdown chart, a report, a
   reminder. Nothing in this fork assumes what those are; it assumes they exist.
2. **Make the bookkeeping invisible.** A logbook only stays useful if filing an
   entry is not a chore, so where the app can work out what a row belongs to, it
   does, rather than asking.

## The changes

### Self sign-up with admin approval

Adds public registration to the login page. New accounts are created `pending`,
cannot authenticate, and become usable only when an admin approves them;
rejecting one hard-deletes it.

A pending account is unauthenticatable **by construction** rather than by a
status check: sign-up leaves `user.password` empty and parks the hash in
`user_metadata`, which approval promotes into the real column. Upstream's login
already refuses an empty password, so a pending row cannot be logged into on any
build — including a stock image, which is what makes switching this fork off
safe. `createLoginResponse` also refuses to mint a session for a non-active
account, covering the OAuth path for free.

Login answers `403 {code: "pending_approval"}` after validating the password, so
the client can show a waiting panel instead of a misleading "incorrect email or
password". The check depends on the account status, never on whether sign-up is
currently enabled, so turning the feature off does not strand existing pending
users. Pending accounts are filtered out of the user list and the sync stream,
which would otherwise show them in every sharing picker and on every syncing
client.

No database migration: `user.status` is a plain varchar with no enum or check
constraint, and metadata keys are unconstrained.

### Journeys, roadtrips and flights agree with each other

Upstream lets a trip, its route sections and its flights drift apart in name and
in filing. Three rules close that:

- A route section created on a trip **without a name of its own takes the trip's
  name**; an explicit name is still honoured, so a deliberate second section
  keeps its own.
- **Renaming a trip carries to the sections still carrying the old name.** A
  section named otherwise was named deliberately and is left alone.
- **A flight created or imported with no trip is filed with the trip whose date
  span contains its departure day.** Days are compared, not instants, and the day
  is resolved by the detector's own local-day helper so the two cannot disagree
  about when a leg left. The narrowest span wins; a genuine tie leaves the flight
  unlinked rather than guessing.

### Maps on the cards, drawn from real geometry

Cards draw on a real basemap with the geometry over it, rather than the shape
alone on a flat background. `components/map/CardMap.tsx` is the one component:
the basemap under, the line as an SVG overlay, both pinned by a single
projection computed from the geometry's bounds — a map whose view the component
already decides needs no second source of truth about where a coordinate lands.

Two things worth knowing if you touch it:

- MapLibre's world is `512 × 2^zoom` CSS pixels. 512 is its base unit and a raster
  tile's own 256 is only how that tile is displayed across it, so the fit and the
  projection must use the same number or the overlay lands at half scale.
- The basemap is a **vector** style. Raster tiles carry one fixed level of detail
  per zoom and stretch badly across a card that fits a continent.

The card grid's route line is the routed path when one exists and the stations
alone when it does not, so a section whose legs were never routed still draws.

### A flight's page shows its journey

A flight is one leg of a journey, and upstream's flight page knows nothing about
its siblings. Here, a flight that belongs to a trip opens on that trip's
breakdown — its figures, the map of every leg, and the journey's flights as
rows, each linking to the next — with the flights table in a second tab. A flight
belonging to no trip falls back to its own numbers and its own arc.

### The flights log page is one page shown two ways

The card view and the table view were two pages that happened to share a title:
the summary line, the filters and the footer hint existed on the table side
alone, and the card view carried a heading of its own. They are now one page with
two middles, and that furniture is the same above and below both of them.

**`?view=table` selects the table**; anything else is the cards. The presence of
a trip used to decide, which was an accident of how the table's filter was
reached. A card now links to `?view=table&trip=<id>` and the flight detail page's
table tab uses the same shape, so the trip travels beside the view rather than
implying it, and each view's footer carries the link to the other.

The filters fold away behind one button that slides them open on a height
transition, with a count when any is active and a way to reset them. They narrow
the FLIGHTS, not the cards: a journey with no matching leg left leaves the grid
with them — matching a card on "does any of its legs match" and then drawing it
whole would answer a question nobody asked. The summary line — flights,
airlines, airports — is counted over what is currently shown, on both views.

### The roadtrip list says what it holds

The roadtrip list was the one list in the app that answered "how many, of what"
only by counting. It now leads with a summary line of three figures —
**roadtrips, drives, stations** — folded from exactly the rows on screen, so the
line and the list beneath it cannot disagree. Planned roadtrips are included: the
strip's promise is to describe what is shown, and the Planned section is part of
what is shown. ("A planned roadtrip counts for nothing in any statistic" governs
the dated `/stats` rollups — a different surface.) The strip renders nothing
rather than a row of zeros while the list is loading, failed, empty or unmatched.

**What "drives" counts.** The road legs the shown rows record, one per distinct
consecutive stop pair. It is deliberately NOT stations minus one: a via point is
a leg endpoint too — the route bends through it and the leg writer joins it to
both neighbours — so counting station pairs would undercount every route that
bends. The count shares its allow-list with the card's kilometres
(`drivenLegs`, beside `drivenKm`), so a ferry, rail, foot or bike leg is not a
drive and the count cannot drift from the distance. Legs are keyed by endpoint
pair, so a repeated ordered pair — an out-and-back — is one drive, not two.

**Why the third figure is stations and not cities.** A station's only name is
free text; there is no normalized city on a station. This line speaks for many
rows at once, so a free-text count of them would inflate without the reader being
able to see why. Stations is the one number the row and the line can agree on,
and that is the rule this strip keeps. (A single card is a different question: it
has room to say what it counted, and may answer it differently. The list does
not.)

**Why there is no distance headline.** A leg with no drawn line and no routing
is stored as the great-circle chord, and routing is optional per instance, so
summing chords and routed kilometres would present a mix of measured and
estimated as measured. Rail, rental and flight carry the same rule, and
`ListSummaryStrip`'s own contract forbids the alternative. A distance total keeps
its home on `/stats`, where its wording can say what it contains.

The figures live in `lib/roadtrip/roadtripSummaryFigures.ts`, beside
`flightSummaryFigures.ts` and `railSummaryFigures.ts`, so they are testable
without rendering a page.

### Smaller things

- **One page width.** The three container widths collapse to one, so every page
  is the width of the logbook rather than a shape of its own.
- **Back goes where you came from.** The detail header returns through history
  instead of a fixed target; a page opened directly has no history and still uses
  its section's front door, and middle-click still opens that section's home.
- **A figure that comes and goes resizes the line it sits in.** The filter
  badge, the "N match" caption, Reset and the filtered chip were each mounted
  only while a filter was active, so the first keystroke grew the row — the chip
  is taller than the line it rides on — and everything under it shifted. All four
  are drawn once and hidden with `visibility`, so the row measures the same
  either way; the badge and the chip carry `aria-hidden` while they are down, and
  Reset is disabled rather than absent. The "is it filtered" test trims
  whitespace too, so a lone space narrows nothing and the chip stays down.

## How it fits with Immich

The photo library is where the journeys actually happened, and the logbook links
to it rather than duplicating it.

**The connection** is configured per user (`PUT /api/v1/settings/immich`) with a
base URL and an API key. Point it at an address the app's container can reach:
the images are fetched by the SERVER and proxied to the browser, so the browser
never talks to Immich directly and the photos never leave that network path.

**An album belongs to a journey.** `TripImmichAlbum` links an Immich album to a
trip, in `link` mode (reference, no copies) or `import` (fetch them into the
logbook). Because the album hangs off the TRIP and not off a route section — a
roadtrip can move between trips — everything that wants to show photos reads it
through the trip.

**Where it surfaces:**

- a trip's **Gallery** tab shows the linked albums and their assets;
- the trip **Overview** lists them beside its other areas, so a journey's photos
  are countable without opening a tab;
- a **roadtrip's** figures band carries the journey it belongs to and that
  journey's album as entry points, saying N/A rather than vanishing when either
  is absent;
- a **flight's** page reaches the same album through the journey it opens on.

Note that Immich's own album counts exclude Live Photo motion parts, so an album
holding N still reads as fewer than N; the count is Immich's, and re-adding an
asset reports `duplicate`, which is the reliable membership test.

## Running it

Build and deploy notes live beside this file in the fork's own deployment — the
container image is built from this repository (`docker build -f server/Dockerfile`),
and the app runs from a compose file that pins `IMMICH_VERSION` so the server and
the machine-learning image move together. Immich does not support version skew
between the two.

No credentials, hostnames, album names or itinerary data belong in this
document. If you are forking this in turn, keep it that way: the code is meant to
be shared, the logbook behind it is not.
