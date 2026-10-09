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

### A journey has a page of its own

Tapping a journey card in the Flights logbook used to drop the reader into the
whole table filtered to that trip: a list of rows with no home for the journey
itself. The card now opens the journey's own page at `/flights/journeys/:tripId`,
shaped like the roadtrip detail page on purpose — a head bearing the name and the
trip's edit affordances, a band of figures under it, then a body — so the two
read as the same kind of page rather than as two designs side by side. The route
sits under `/flights` as a static segment, so it can never collide with
`/flights/:id` and the logbook stays lit. A flight with no trip has no journey and
keeps opening its own page at `/flights/:id`.

**The band** carries what a flight trip can answer — distance covered, nights,
cities, airports, flights, then the journey and its album as entry points — and
stays visible whichever body is shown. The folding lives in
`lib/flights/journeyFigures.ts`, beside `flightSummaryFigures.ts`, so the rules
are testable without rendering a band.

**The distance is a sum of derived numbers, and says so.** A leg's distance is
the great-circle chord stamped with the row unless the leg carries a recorded
track (`routeSource` is `"live_tracking"`), so the sum is DERIVED and is marked
`~`. The same fold and the same marker (`journeyFigures.distancePrefix`) feed the
journey card a tap away, so a card and a band cannot print different figures for
one journey. Two cases the marker keeps honest:

- A leg with no distance at all — no stamp and no two real endpoints — is NOT a
  zero. It adds nothing and the total reads `≈`, "at least this much", rather
  than being lowered by a leg pretending to be nothing. (A stored distance of 0
  and the `(0,0)` "no coordinate" sentinel both mean "we never worked one out",
  not a real nought-leg; the map draws no arc for such a leg.)
- When a leg is missing AND the rest are chords, both signs are shown — `≈ ~` is
  "at least this much, and the sum is an estimate" — because dropping the `~` the
  moment a leg went missing would pass a derived figure off as a measured one.
- A journey where no leg yields a distance at all is a dash with its reason,
  never a zero.

This is the contract `ListSummaryStrip` states of itself: flight time and
distance are both derived, "and the app is careful to mark them as estimates
wherever they appear". The roadtrip LIST deliberately carries no distance
headline for the same reason; a single journey's band may print the sum because
it can mark that sum derived, and the list's rule is left as it was.

**Cities is not airports, and both are real.** They are deliberately different
figures — a journey that lands twice in one city is two airports and one city.
Cities come from the airport catalogue's own city, resolved by the server in the
lookup that already rides back with the flight, so the count costs no per-code
request from the browser. A journey where no airport resolves a city is a dash
with its reason; a PARTIAL resolution is a lower bound, and the band says by how
many airports it is short. (A roadtrip has no normalized city either — a
station's only name is free text — so its LIST counts CITIES as the distinct
station titles its shown rows carry, unioned across them, with the same
free-text caveat recorded in code. A single band has room to say what it counted
and answers the same way.)

**Nights are the journey's SPAN, not the sum of its stays** (owner, 2026-10-08).
The legs are ordered by departure and walked; the journey ends at the first leg
that arrives back at the city the first leg left from, so the count runs from the
day of leaving to the day of returning. A journey that never comes back — a
one-way — ends at the last arrival: start to end of journey. The figure is the
whole calendar days between those two dates, read in UTC, so a 1 Oct departure
returning on the 6th is five nights. A journey with no dated leg to measure is a
dash with its reason, never a fabricated number and never `days − 1`. The one
fold (`journeyNights`) feeds both the band and the journey card, so the two
cannot disagree. The stays' own night sum is still folded (`nightsFromStays`) and
still tested, but it is no longer the journey's nights and no surface shows it as
such.

The **journey** and **album** cells are entry points, and draw "N/A" rather than
vanishing when they have nothing to point at — an absent entry point and a hidden
one read the same otherwise. The **flights** cell is a BUTTON, not a link: tapping
it swaps the body in place rather than navigating, which is the owner's "when user
taps the flights number". The tab strip below the band names its second tab with
that count — "3 Flights", or "1 Flight" for a single leg.

**The body is one of two readings of the same journey, and the tab chooses:**

- **Route** (the default tab): the journey's airports in travel order with the
  flights between them — a station here is an airport and a leg is a flight —
  beside a sticky map that rings the airport you pick. The route timeline is a
  parallel row to the roadtrip's stations, not a generalisation of it: a drive has
  a mode, a distance and a duration the router worked out, while a flight has an
  airline, a number and a departure. Timeline and map are ordered by the same
  rule, so they cannot disagree about which leg came first.
- **`?view=table`**: the logbook's OWN table, locked to the journey through the
  extracted `FlightsTablePanel` — literally the table the logbook shows, not a
  second renderer that drifts the first time a column changes. A row there still
  opens the flight's page exactly as it does at `/flights`, and the trip filter is
  not drawn at all: the page owns the trip, and a control the reader cannot change
  is a lie.

**The swap lives in the URL**, not in state alone: `?view=table` is the logbook's
own word for "show me the table", so one meaning holds across the whole Flights
section, a shared link lands on the table, and Back leaves the page rather than
toggling a tab. The band and the tab strip never unmount across the two bodies,
and the title never changes across them.

**The page is matched to the roadtrip detail page, difference by difference**
(owner, 2026-10-08: "try to match flight page to road trip page"). The furniture
is shared rather than copied, so the next edit cannot move one page alone: the
two figures bands are one component (`components/ui/FigureBand.tsx`), the head's
outline link one `ActionLink`, which phase earns a status pill one rule
(`lib/detailPhase.ts`), and the two numbers the sticky map panel is built from —
its offset under the header, the framed box's radius — one module
(`lib/detailChrome.ts`). Two of the alignment's changes follow from that
directly. A past journey draws no `PAST` pill, because a past roadtrip draws
none: the reference is the roadtrip page, and a finished journey reads as
finished from its date span, exactly as a finished roadtrip does. And the band's
grid is a breakpoint cadence rather than a cell count — the roadtrip's six cells
keep their two / three / six rhythm, the journey's seven run two / four / seven
with the trailing album cell spanning the last row's remainder and reset to a
single track at `xl`, where seven across is full. Four across at `sm` is itself
the decision: seven cells three-across would be three rows, which reads less like
the reference's two than four does. The band's Journey and Album cells also read
one shared `common:summary.*` key set on both pages, so the same two entry points
cannot end up labelled two ways.

**The differences that remain are the subject's, not the drawing's**, and each is
kept on purpose — none is to be "fixed" to make the two pages match. The back
link reads "Logbook · Flights", not the roadtrip's "Roadtrips": a journey belongs
to the Logbook, and the four sibling detail pages — the single flight, a cruise,
a stay, a place — all say "Logbook · …", while "Roadtrips" names a top-level
section rather than a Logbook area. The head's two actions are the same furniture
— an outline link then a primary pencil button — pointing at each page's own
second object: a roadtrip's recorded route, a journey's own trip. The subtitle is
the same date span joined the same way, but a journey has no vehicle and is its
own trip, so it names neither. The distance keeps its own word and carries its
marker: "Distance covered" with the `~`/`≈` prefix and the great-circle caption,
because a plane is not driven and the sum is derived, where a routed roadtrip's
is measured — matching the look never means dropping the marker. And the body
carries a tab strip at all, because the table behind a tab is the owner's own
request and a roadtrip has no second view to hide; the strip is this page's
furniture, drawn like the band's labels. The list under it is headed by its own
noun, "Airports" — the parallel of the roadtrip's "Stations" — through a key
separate from the tab's "Route", so neither word drags the other along.

**The row bodies differ because the things in them do; only the shell is
shared.** A roadtrip station carries a state, a night, a stay and its day tours,
so its marker is a shape per state and its row a set of chips; an airport has no
state, so its marker is one plain dot and its row an IATA code and a name, and
the leg between two rows says what each mode can — a drive's routed distance and
duration, a flight's airline, number and departure. Two smaller differences ride
the same rule. The single-flight page keeps its own header tile, the airline's
IATA code, where the journey draws the domain's `plane` line icon like every
other detail page, because one airline names one flight while a journey has many.
And a leg's duration is the app-wide `formatDuration` — not the roadtrip leg's
`"{{h}} h {{m}}"` shape — because the same flight's duration prints this way in
the logbook table a tab away and the two must agree; one format for both pages
would be a change to `formatDuration` itself, not to this row.

### The flights log page is one page shown two ways

The card view and the table view were two pages that happened to share a title:
the summary line, the filters and the footer hint existed on the table side
alone, and the card view carried a heading of its own. They are now one page with
two middles, and that furniture is the same above and below both of them.

**`?view=table` selects the table**; anything else is the cards. The presence of
a trip used to decide, which was an accident of how the table's filter was
reached. A journey card now opens the journey's own page (above), whose table tab
is the logbook's own table under `?view=table`, and the logbook's table keeps
`?trip=<id>` as its trip filter — so the trip travels BESIDE the view rather than
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
**roadtrips, drives, cities** — folded from exactly the rows on screen, so the
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

**Why the third figure is cities.** The owner asked for "how many cities i
touched in all the road trips" (owner, 2026-10-08), so the figure is the UNION
of the shown rows' city names, not a sum of their counts — one city touched by
three roadtrips is one city. The grammar matches the flights strip, which counts
distinct airlines and airports over the shown flights rather than summing them.
A roadtrip has no normalized city — a station's only name is free text — so "a
city" is a distinct station title: trimmed, empties skipped, deduplicated by the
exact string. The owner was shown and accepted the caveat that "Oakville" and
"Oakville, Ontario" count as two and that a wild-camp station counts as one; the
rule lives in a code comment (`stationCityNames`), never in the label. The names
are computed server-side over ALL stations (not the placed-only array the map
markers read), so an unplaced station still names its city and the strip cannot
undercount the card, which reads the same field.

**Why there is no distance headline.** A leg with no drawn line and no routing
is stored as the great-circle chord, and routing is optional per instance, so
summing chords and routed kilometres would present a mix of measured and
estimated as measured. Rail, rental and flight carry the same rule, and
`ListSummaryStrip`'s own contract forbids the alternative. A distance total keeps
its home on `/stats`, where its wording can say what it contains.

The figures live in `lib/roadtrip/roadtripSummaryFigures.ts`, beside
`flightSummaryFigures.ts` and `railSummaryFigures.ts`, so they are testable
without rendering a page.

### The two journey cards print the same row

A roadtrip card and a flight-journey card used to answer "what is this, and how
much of it?" with different figures in a different order — kilometres, nights,
stations and day tours on one side; a flight count, an airports count and a
distance on the other. Two cards that open pages built to look alike should read
alike first, so the owner settled one row for both (owner, 2026-10-08): **km,
nights, cities**, three cells in that order and nothing else.

The cells that leave are as deliberate as the ones that stay. The flight card
loses its flights and airports cells outright — "remove number of airports from
the card of flight on logbook" — and the roadtrip card loses its stations and
day-tours cells, stations collapsing into cities since the two differ only where
two stations share a title or a spelling differs. None of those figures is gone
from the app: the journey band and the roadtrip detail band keep their own
cells, and the flights logbook strip keeps its own. A card and the page it opens
are different surfaces and are meant to differ; a cell is not stripped from a
band to make a card and a band agree.

**km** is the distance the row already carries. On a roadtrip card that is
`drivenKm`, the figure the detail band's "driven" cell also prints. On a flight
card it is the sum of the journey's leg distances, folded by
`journeyFigures.journeyDistanceKm` — the same fold the journeys page's band
reads — and that sum is DERIVED, a line of great-circle chords rather than a
path flown, unless a leg carries a recorded track. A derived sum is marked and
never printed bare: `distancePrefix` puts `~` on it, and `≈` as well when a leg
yielded no distance at all and the total is only a lower bound. This is the band's
own marker (above) reused at row scale, so a card and the page a tap away cannot
disagree about what one journey's number is.

**nights** is the journey's span, not a sum of recorded stays. A flight card
reads `journeyNights` — from the day the journey left to the day it came back to
the city it left from, or, one-way, to the last arrival — the same fold the band
reads. A roadtrip card reads the roadtrip's own nights and carries the `≈`
marker when a station has no departure date and the total is only a lower bound.
Both cards name the cell through the one shared key `common:summary.cardNights`,
so the two cannot spell one figure two ways. (The stays' own night sum,
`nightsFromStays`, still exists and is still tested, but it is no longer the
journey's nights and no surface shows it as such.)

**cities** is a different figure on each side, each counted by its own rule and
each labelled through the shared key `common:summary.cities`. On a flight card it
is the distinct cities OF the journey's airports (`distinctCities`, resolved from
the airport catalogue) — deliberately not an airport count, since a journey can
land twice in one city and then it is two airports and one city. On a roadtrip
card it is the distinct station titles the row carries (`cityNames`, computed
server-side by `stationCityNames`), the same field and rule the roadtrips list
strip unions across its rows. A title is free text, so "Oakville" and "Oakville,
Ontario" count as two and a wild-camp station counts as one; a via point is a
bend in the route and never a place. The owner was shown that caveat and
accepted it.

**A figure that is not known is a dash, never a zero** — unless the zero is
itself the truth. A flight card dashes each unknown with its reason on hover: no
leg yields a distance, no dated leg to measure the nights, no airport names a
city. A roadtrip card dashes the kilometres before there are two stations to make
a leg, and its cities cell prints a real `0` for a row with no titled station,
because that is a known empty and not an unknown count. The two cities cells
diverge there on purpose — the data does — and are not to be "unified".

### The journey card's band carries the trip's flags

The header band of a journey card — the card on the **Journeys** page — used to
be a light-to-dark wash in the trip's own colour. It now carries the **flags of
the countries the trip was in**, laid over one another under the same
light-to-dark spectrum: the flags take the place the colour tint held, so the
band keeps its exact geometry — 110 px tall, a 135° ramp from the light top-left
to the dark bottom-right, landing on `--ts-surface2` — and the title and figures
below it do not move (owner, 2026-10-09).

**This is a rule for every journey, not a treatment for two trips.** The band
reads `trip.countries` and nothing else. Every journey resolves its own flags the
same way, through one pure selector (`bannerFlags` in `lib/tripFlags.ts`): no trip
is named, and no journey has a branch of its own. The owner is judging the
mechanism on two pilot cards before any other card design is built on it, so the
generality is the point, not a side effect.

**Only two flags are bundled so far, and that is deliberate.** `BUNDLED_FLAGS`
allows exactly **Canada** and **Pakistan** — the two SVGs under
`frontend/public/flags/`. The allow-list, not the set of files on disk, is what
holds "exactly two" true: a third flag dropped into that folder paints nothing
until it is also named here, so a pilot asset cannot become a shipped one by
accident.

**A country with no asset is dropped, never stood in for.** Each entry in
`trip.countries` runs through the app's own country resolver, which accepts a
code *or* a name in any language and returns nothing for what it cannot place —
"a wrong flag is worse than no flag" is the rule it was written to. Unplaceable
entries are dropped and duplicates collapsed, and only countries whose flags this
repo ships are painted. What the band does, case by case:

- **No country recorded, or none bundled:** the band keeps **today's exact
  `trip.color` gradient**. Nothing is invented — an absent flag shows as the
  trip's own colour, which is honest where a made-up flag or a flat grey block
  would not be.
- **Some bundled, some not:** the bundled flags paint and the band carries a
  `title` stating how many countries were left out, so an omission reads as a
  spoken reason rather than as a hole. The card's figures line still prints the
  trip's true country count, so the band never claims more than it can draw.
- **More than three drawable flags:** only the first three paint. The cap is
  written down in code (`BANNER_FLAG_CAP`), not left silent: past three
  overlapping ribbons the wash stops reading as flags and starts reading as mud,
  and the count itself is still whole in the figures line.

**The flags overlap; they are not a row of strips.** Several flags are cut into
equal diagonal ribbons along the one 135° axis with feathered seams, so
neighbours cross-fade over each other with no border, divider or shadow — a
drawn edge is what would turn the wash back into a collage of columns. The order
is the order the trip records, and it is **positional only**: a trip's countries
are a set, never a route (the stored array is the user's order, the derived one
sorted), so the band must not be read as first-visited-to-last. The first flag
merely reads as the more prominent.

**The dark end is a legibility requirement, not a style choice.** Two layers
keep the spectrum honest over a flag. A **mask** fades the flags themselves along
the 135° axis — strong at the light corner, exactly zero at the dark corner — so
the band lands on `--ts-surface2` for a mostly-white flag and a dark one alike:
Canada's white field and Pakistan's green reach the same dark end, and so would a
flag added later. A **scrim** then caps the brightest pixel where the status pill
sits, because the pill is a 12 %-alpha fill tuned for dark surfaces and a
white-heavy flag would otherwise break its contrast. The band's legibility is
pinned by a test that recomputes the composited pixels from the component's own
stop constants — jsdom paints nothing, so it asserts the model, never a pass
nothing measured — and the pill clears 4.5:1 over a pure-white worst case.
Without the scrim the flag would win and the pill would fail; without the mask the
band would not end dark enough for the chrome above it.

**Nothing is fetched.** The band paints only files this repository ships, by URL
from `public/flags/`. The app's own flag component loads `flagcdn.com` at
runtime — right for the small chips it was written for, forbidden for the card
band — so the band reads a separate, local source. The two SVGs were copied from
the flag set the repository already vendors for its backend (`flag-icons` 7.5.0,
MIT-licensed), not downloaded, and each records its source and licence in a
header comment.

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
- a **journey's** own page carries the journey and its album in its band, the
  same two entry points the roadtrip band has;
- a **flight's** page reaches that album through the journey it opens on.

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
