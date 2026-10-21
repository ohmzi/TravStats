# What this fork changes, and how it fits together

This is a personal fork of [TravStats](https://github.com/Abrechen2/TravStats). It is
kept close to upstream — the changes below are additions, and everything else is
upstream's own work, merged on each release.

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

### The journey card's band shows one flag

The header band of a journey card — the card on the **Journeys** page — used to
be a light-to-dark wash in the trip's own colour, then carried the flags of the
countries the journey was in. It now carries **one flag: the country the journey
spent the most days in** (owner ruling, 2026-10-14). The band keeps its exact
geometry — 110 px tall, a 135° ramp from the light top-left to the dark
bottom-right, landing on `--ts-surface2` — and the title and figures below it do
not move. The ruling retired the earlier travel-order set (each flight and car
leg's destination country, the last element dropped to hide home) and replaced
it outright, because that rule removed home only by an ordering accident and
could show a country the traveller merely passed through.

**How the country is chosen.** The journey's own **stations** decide it, because
that is where the data holds real time. Each station contributes the distinct
calendar days it covers — its start through its end inclusive, one day for a
place with no dates — and a day two stations share counts **once**, so the
weight is days *spent*, not spans summed. The country with the most distinct
days wins; a tie goes to the country present on the earliest day, then to the
earliest station. A journey whose stations resolve no country falls back to the
country with the most **flight arrivals**, a tie to the earliest flight, so a
journey whose places were never recorded still shows something. A route
correction (a `via` point) counts for nothing, exactly as in every station
count. The answer is folded to ISO alpha-2 against the same catalogues the rest
of the app uses, so a catalogue spelling and a code cannot disagree.

The field on the wire is `destinationCountries` — **at most one entry**, empty
when nothing resolves — and it is separate from `trip.countries`, the sorted set
that still feeds the card's own country figure. The rule lives on the server in
`backend/src/routes/trips/tripCountries.ts` (`journeyPrimaryCountry`), one
function the list and detail endpoints both call. Because it is derived per
request and nothing is stored, a trip created after this change draws its flag
with no migration and no backfill.

**A country with no asset is dropped, never stood in for.** The band paints only
files this repository ships, by URL from `public/flags/`, reached by the
convention `/flags/<cc>.svg` over the app's own country list
(`ISO_3166_1_ALPHA2`) — there is no allow-list of flags to keep in step: the way
to give a country a flag is to add its code to that shared list and run
`node scripts/vendor-flags.mjs`. A test fails if the folder and the list ever
disagree, in either direction. Nothing is fetched at build or at runtime: the
app's own flag component loads `flagcdn.com` for the small chips it was written
for, but the card band reads a local source, and each SVG records its provenance
and licence in a header comment. When the field is empty — no country recorded,
or none drawable — the band keeps the trip's own colour gradient, so an absent
flag reads as the trip's colour rather than as a hole.

A **stay- or cruise-only trip** (one that went nowhere by flight or car) is not a
journey in this sense and still hands the band its full country set, painted as
overlapping diagonal ribbons with feathered seams. The seam is count-keyed, so a
several-flag band stays legible: one to three flags keep the pilot's formula
bit-for-bit, and four or more use a smaller fixed seam so no ribbon's solid core
reaches zero (the arithmetic that made the old three-flag cap impossible to
raise). The order is positional only — a trip's countries are a set, never a
route — so the band is not read first-visited-to-last.

**The dark end is a legibility requirement, not a style choice.** A **mask**
fades the flag along the 135° axis — strong at the light corner, exactly zero at
the dark corner — so the band lands on `--ts-surface2` for a pale flag and a
dark one alike; a **scrim** caps the brightest pixel where the status pill sits,
because the pill is a 12 %-alpha fill tuned for dark surfaces and a white-heavy
flag would otherwise break its contrast. The band's legibility is pinned by a
test that recomputes the composited pixels from the component's own stop
constants — jsdom paints nothing, so it asserts the model, never a pass nothing
measured — and the pill clears 4.5:1 over a pure-white worst case.

**The chips name the country once.** The trip head's country chips put the name
in both the flag's `alt` and the text beside it, so a screen reader said it twice
(owner, 2026-10-09). The flag is now rendered decorative there — `alt=""`,
`aria-hidden`, no `title` — and the chip's own text names the country. `FlagImg`
keeps its `alt`/`title` by default, because in the lodging table the flag is the
only thing naming the country. The chips also fold a duplicated `trip.countries`
entry, so a stored list that repeats a country draws one chip, not two.

### The figures band is navigation

The figures row at the top of the journey, trip and flight-trip pages used to be
a wall of read-only sums. A figure that names a surface is now a link to it, so
the row reads as the doorways of the page it heads. The wiring is all in the
three band components (`EntityFigures.tsx` for the journey and trip,
`FlightTripFigures.tsx` for the flight-trip page); `FigureBand` itself needed no
change, its `value` already being a `ReactNode`, and no DTO, endpoint or fetch
was touched.

The journey band's cells and where each goes: **days** to the journey's
`?tab=timeline`, **km** (driven) to the roadtrip it sums when there is exactly
one and to the journey's `?tab=trips` when there are several, **kmFlown** to the
flight journey's own route view, **countries** to `?tab=map`, **trips** to
`?tab=trips`, and **albums** to `?tab=gallery` when the trip has at least one.
The **dates** cell stays plain text.

The trip band's cells: **driven** and **countries** to `?tab=map`, **days** and
**places** to `?tab=timeline`; **dates**, the journey link and the album cell are
unchanged.

The flight-trip band: **distance**, **cities** and **airports** all open the
flight journey's own Route view with `?view=` cleared (there is no airport page,
so they return to the surface that draws those numbers), and **days** opens the
single associated roadtrip's timeline when there is exactly one, else the
journey's `?tab=trips`. The **flights** cell keeps its button, because that tap
swaps the table in rather than navigating and is the table view's only door.

A cell with no sensible target keeps today's plain rendering rather than linking
to nowhere — a journey with no roadtrip leaves its km plain, an album-less trip
leaves its count plain. The links reuse each cell's own text (so the band's
accessible names are unchanged) and carry the repo's quiet-link idiom,
`hover:underline`.

### A flight sorts by where it moved you, on the journey timeline

The journey timeline pairs a flight with a time-less place entry that shares its
day. The rule used to be direction-blind: any such flight sorted **first**, even
one that carried the traveller *away* from the place — so a departure flight out
of a place was drawn above presence in that place (owner report, 2026-10-14). The
rule now asks which of the flight's two airports is **nearer the place**, using
the repo's own Haversine helper:

- the flight's **arrival** airport is nearer ⇒ it **brought** the traveller there
  ⇒ the flight sorts **first** (the earlier ruling, kept);
- the flight's **departure** airport is nearer ⇒ it **took** them away ⇒ the
  flight sorts **last**, after the place's entries;
- a missing point on either side, or two airports equidistant ⇒ today's
  behaviour, a flight first.

The comparator is a pure function of its two arguments — the points ride on the
events, built in `tripTimelineEvents.ts` — so the rule corrects every journey,
past and future, with no re-sync. It lives in `frontend/src/lib/tripTimeline.ts`.

### A cluster's named places stand apart

Within one stay, the photo clusters a scan derives are cut by the places Immich
names. The rule used to re-merge named groups whose medians lay within the
clustering distance, so a compact island or a multi-district city — every
district name within a few kilometres of every other — collapsed into a single
station named by whichever name held the most photos. Now each named place group
that carries enough photos to stand alone **is its own station**: the named
groups are the split, and only unnamed or too-small strays are attached to their
nearest group. The clustering constants themselves are untouched; only the
re-merge step was removed. The rule lives in
`backend/src/services/tripBuilder/cityClusters.ts` (`splitByNames`).

### A dashboard line card is a way in, never a way into editing

A card a dashboard puts up over a line is a way IN to what the line summarises:
tapping it opens the read-only page for that flight or that roadtrip, and it
must never open the edit form (owner, 2026-10-09). The rule is written for
dashboard cards generally, because the next line to answer with a card will
follow it — a summary that opens an editor is a trap, since the reader asked to
see a thing and was handed the means to change it.

**The flight line's action was the bug.** Its card called `setEditingFlight`,
so a button that said "open" put the reader in the flight's edit modal (owner,
in other words, 2026-10-09: "open last flight opens edit mode, what it should do
is open the flight trip page of that flight not edit"). `AllTab`'s
`handleFlightOpen` now navigates to `/flights/:id` — the logbook's own
read-only flight page, the same one-liner `FlightsTab` already uses to open a
flight. Editing stays one tap away on the page this opens, and the back button
lands on the logbook it left.

**The edit affordance left the shared map card, on every surface and not just
the dashboard's.** The card drawn for a route carries ONE action now: a second,
"Bearbeiten" action was removed from `PinnedCard`, and with it the
`onFlightEdit` and `selectionScope` props the flat map and the globe threaded
down to it. The same card answers a route on the dashboard, on the flights map
and on the globe, so an edit action on one surface and not another would have
been two cards — the rule holds everywhere the card is drawn, not only where it
was noticed.

**The action opens the flight the reader can see.** The flight the action names
used to be the route aggregation's own tail (`flightIds[flightIds.length - 1]`),
which is the order the grouping produced, not date order — a "Last flight"
button built from it could open a flight that is not the one the card's list
shows first. It now resolves to the most recently departed flight on the route —
the row the card's own list shows first, since `CardFlights` sorts by departure
— so the action and the list cannot disagree about which flight is the last
(owner, 2026-10-09).

**The roadtrip line answers with the same card the roadtrips tab mounts.** A
roadtrip line on the dashboard's "Alle" tab used to be inert: the tab draws the
tour layer as an extra layer the map never sees, so a click reached no listener.
It now answers with `RoadtripCardOverlay` — not a second design for the
dashboard but the very component the roadtrips tab already mounts — whose one
action is a `Link` to `/roadtrips/:id`, the roadtrip's own read-only detail
page. A day-tour leg is left inert on purpose: a tour's figures already sit on
the row that opens it, and only a roadtrip answers with a card, the same rule
the roadtrips tab keeps. The flight card and the roadtrip card are made mutually
exclusive, so only the line the reader last aimed at stays open.

**The word "last" is printed only when the route holds more than one.** It says
nothing about a single thing, so the action reads "Last flight" / "Last road
trip" only when the route holds MORE than one; with exactly one it reads the
plain "Open flight details" / "Open roadtrip details". The count is the one the
grouping that produced the line already carries — the flights on that airport
pair, for the route card (`RouteCardDatum.count`) — and, for the roadtrip card, a
`count` prop that is 1 today, because a roadtrip line is always exactly one
roadtrip; it exists so the wording can appear the day a route groups several
rather than printing "last" with nothing for it to be last of. This is the
dash-not-zero honesty of `ListSummaryStrip` applied to a label: a word that
claims a group is not printed when there is no group.

The labels are ordinary i18n keys in both languages — `map:globe.openLastFlight`
(reworded from "Open last flight" to "Last flight") and the new
`map:globe.pinned.openFlightDetails`, `roadtrips:list.openDetails` and
`roadtrips:list.lastRoadtrip`; `roadtrips:list.open` is left where it was, for
the underway card that still reads it.

### A trip is built from its photos

The Create Trip form can read the photos taken inside the trip's dates from
Immich and draft the trip from them: where each day was spent, how the logged
flights cut the ground travel into stretches, and where each night was slept.
Nothing is saved until the review page's button is pressed. The same flow adds
to a trip that already exists and re-syncs it after the dates change or more
photos arrive, and there the review reads as a diff: unchanged, changed, new,
and "not in your photos". Almost all of it is new files, so rebasing is mostly a
matter of checking the seams listed at the end.

**How it runs.**

- **Form.** The Create Trip form carries a "Photos from Immich" block with two
  switches, "Inspect Immich" and "Create album in Immich", both off, and nothing
  is asked of the server until one goes on; the answer can switch it back off,
  with the reason beside it. The import chooser's "Build it from your photos"
  route is always offered, fetches nothing to be offered, and opens the form
  with Inspect already on, so the check runs at once.
- **Scan.** `POST /api/v1/trip-builder/scan` starts a read-only job
  (`tripBuilder.scan`). It fetches the window's assets, gives every photo one
  instant and one zone, keeps the user's own photos, cuts the ground movement at
  every flight of the logbook, clusters the places, builds the stations and
  legs, and decides each night. The result is a draft held **in memory**, bound
  to its owner (two hours untouched, six at most, three per user). A server
  restart therefore turns a review into "expired, scan again", never into a
  corrupt trip. There is no migration.
- **Review.** `/trips/builder` shows the draft by area and day. The edits are a
  pure reducer (`frontend/src/lib/tripBuilder/draftEdits.ts`) whose list is kept
  in `sessionStorage` under the stable station and area keys, so a reload
  resumes and a re-scan with other dates puts the edits back where they still
  apply.
- **Commit.** `tripBuilder.commit` runs in four phases: **P** preflights Immich
  without writing, and where the album cannot be made, nothing is written at
  all; **B** writes the trip, its flights, stops and roadtrips in **one
  transaction**; **C** routes the legs and recomputes statuses; **D** does the
  album. The draft is marked committed straight away after B, so a failure later
  can never leave it open to a second commit; a failed album is reported and
  retried on its own (`POST /api/v1/trip-builder/trips/:tripId/album`).

**What the scan decides, and the rules inside it.**

- **Flights are the spine, and the air is not ground.** Every logged flight cuts
  the ground photos into areas before anything else is decided, and a road leg
  never crosses a flight. Photos taken while airborne are excluded from the
  clusters and never become stations — they count in the scan's
  `excluded.inFlight` and stay in the album — and a night the plane is airborne
  across is a flight night before any photo has a say.
- **One roadtrip per ground area, named after the trip.** Each area becomes one
  roadtrip, or a timeline stop when roadtrips are off or when the area is one
  city with the home legs off. Exactly one roadtrip takes the trip's own name;
  several read `"<trip> · <main city>"`, the main city being the area with the
  most nights, then the most photos, and a duplicate gains a short day suffix. A
  re-scan uses the `·` form when a roadtrip of the trip's own name already
  exists.
- **Nights are decided in one order.** An airborne night is a flight night; a
  flight that lands in the night — after the night's last ground photo, or when
  it has no photo at all — takes it, the night being spent where it landed
  (home, the first station of the area the flight opens, else `unknown`);
  otherwise ferry, home, a late night-drive and finally the last photo's station
  take it. A stored stay always beats a derived free night, a night can only go
  to a station whose photos touch it, and the plan is derived and validated by
  the same mirrored file as rule 4, so the review and the commit write the same
  nights.

**Rules to keep when forking this in turn.**

1. **Nothing is written before the user confirms** the reviewed draft, to
   TravStats or to Immich.
2. **Albums are made and changed only through the user's own Immich key**
   (`source === "user"`), never through the admin, global or environment
   connection, which is the operator's library. Removing photos from an album is
   further gated on the album being one TravStats made — its Immich description
   starts with the marker `TravStats trip ·`, written at creation — and on the
   `albumAsset.delete` scope.
3. **No Immich asset id crosses the API.** A thumbnail is the draft's id and an
   index; the stored draft is the permission.
4. **The night plan is one rule in two files.**
   `shared/tour/builderNightPlan.ts` exists in both trees, identical but for its
   first comment, and a test fails when they differ. The review derives what it
   shows from it and the commit derives and validates again with the same code.
5. **Time goes through `shared/time`.** A photo's day is the day on the clock of
   the place it was taken; durations use instants; a night is the day of the
   local time minus four hours. The lint rules that forbid host-zone code apply
   to all of it.
6. **The numbers live in `services/tripBuilder/thresholds.ts`**, and a test pins
   the ones that were accepted by hand against a real trip.
7. **A re-derivation must not destroy good data.** Re-syncing an existing trip
   keeps the stored stations by id, with their titles, notes, stays, places and
   coordinates, and the hand-corrected legs, and it deletes nothing that the new
   scan merely fails to see.
8. **A commit is idempotent.** One key per review session: the same key while it
   runs returns the same job, and after it succeeded every key answers "already
   created".
9. **Fixtures are invented** (made-up places, years after the present, flight
   numbers like ZZ101). This repository is public; no real trip, place or album
   name belongs in a test or here.
10. **Mind the shared budgets.** A scan covers at most 62 days, and the import
    rate limit of 20 per 15 minutes is shared with the other Immich imports, so
    repeated scans can meet a 429.

**When the trip already exists, the review is a diff.** A re-scan against a trip
reconciles the derived plan with what is stored: every station and stop pair is
`same`, `changed`, `new`, or `notSeen` ("not in your photos"), a row carries its
pill, and a "Show unchanged" toggle folds the `same` rows so a re-sync with few
changes reads short. A matched station keeps its id and the user's fields (rule
7); a `notSeen` one defaults to keep, and only a station that lies entirely
outside the new dates is offered for removal. The commit refuses a trip that
changed under it: `TRIP_CHANGED` (409) fires when the trip no longer holds
exactly the stored ids the draft offered, because deleting by omission is only
safe against an unchanged list. Album members outside the new dates are listed
and can be taken out under rule 2's marker and scope, and only ids the server's
own window computation classified as outside are ever removed — never ids the
client sent, and never a member with no capture time.

**Entry points and deletion.** A re-sync starts from the trip page's head, from
a roadtrip's figures band when the roadtrip is filed on a trip, and from the
toast after an edit moved a trip's dates ("Dates changed — re-sync photos?").
All of them open `/trips/:id/resync`, which scans the trip's saved dates and
reviews as an update; it refuses cleanly when the trip has no dates, when Immich
is not connected, or when the trip is longer than one 62-day scan. Deleting a
builder trip never deletes the Immich album — the album is the user's, on the
user's server — and its roadtrips are only detached from it, because a roadtrip
outlives its trip.

**A re-sync can be scoped to one roadtrip.** A trip that shares a journey with
others should be correctable without rewriting the whole journey (owner request,
2026-10-12), so the trip's own edit page and the roadtrip's figures band each
carry a "Re-sync from Immich" entry. Its scan target names the route as
well as the trip (`{kind:"existing", tripId, routeId}`): the window is the
trip's own saved dates, and `routeScope.ts` merges the window's areas into the
single area the target roadtrip becomes, in travel order, with a straight road
leg joining the boundary. The journey-level machinery that would re-mint the row
is skipped — no naming pass, no pitstop album, no stopover offers, no photo
findings — and the annotation forces the association with the stored roadtrip, so
the owner's corrected photo locations cannot fail a name or proximity match and
turn the update into a second row. The commit writes exactly that roadtrip and
its album, add-only, through the same writer the journey-wide flow uses; nothing
else of the journey moves, its `updatedAt` included. A scanned stop that also
stands on another stored roadtrip's stations refuses with a conflict rather than
writing across rows.

**Known limits of a re-sync.** An `unknown` night that a kept `notSeen` slept
station covers still counts as unknown in the draft and in `unknownNights`.
`trips.updated_at` may still move, because the base writer updates the trip row
unconditionally: the "zero writes except `lastSyncedAt`" promise holds for the
roadtrip stations, the stops and the album, and a guard that skips the update
when the window was not applied and the countries add nothing belongs in that
base writer. A coordinate-fallback title is detected by pattern
(`isCoordinateTitle`); if `nameClusters` ever formats one differently, that one
regex is what to adjust.

**Where it touches code upstream also changes.** These are the places to look at
after a rebase: trip creation, now in `services/trip/createTrip.ts` and called
by `POST /trips`; the rename of a trip, which also renames its `"<trip> ·
<city>"` roadtrips; `replaceStations`, which now has an in-transaction form that
sets a leg's mode before anything routes, and only on a leg the write creates —
a mode sent for any other leg fails the transaction, so a stale plan cannot
leave a ferry carrying a road's geometry; the Immich client, which gained the
window search and the album writes; the connection test, which reports the key's
capabilities; the `JobKind` union and the `ApiErrorCode` union; the router
mounts and the response-shape baseline; `GET /trips/:id`, which carries
`roadtripStations` (the trip timeline's roadtrip-owned stations, empty while
roadtrips are off); `TripModal`, `App.tsx` and the trip page's header; and the
new `tripBuilder` i18n namespace, registered in `i18n/config.ts`.

### A stopover can become a roadtrip

A flight that connects through an airport where the traveller actually left the
terminal used to be a dead end: the builder classifies the stretch as a
**layover**, keeps its photos out of the ground areas, stations and nights, and
marks it with only a "N photos during the layover" line. Now every layover
whose photos show a real outing is offered as a **stopover**: a roadtrip built
from the stopover's own geotags and, with a second tick, an independent album
and roadtrip named `"<City> <Year> Road Trip"` whose photos also stay in the
trip's main album.

**How it runs.**

- **Detection.** A layover is unchanged: adjacent logged flights that share an
  airport, a ground gap under 12 h (or two flights sharing a day when either
  has no time), and every photo of the stretch within 30 km of the arrival
  airport (`LAYOVER_MAX_H`, `LAYOVER_RADIUS_KM`). It becomes a **stopover
  candidate** when at least `STOPOVER_MIN_PHOTOS` (5) of its geotagged photos
  lie further than `STOPOVER_MIN_KM` (5) from that airport: the outing set.
  Photos within a coffee break of the terminal are not an outing; a day in
  town is. Both numbers live in `services/tripBuilder/thresholds.ts` beside
  the `LAYOVER_*` pair and are pinned by the thresholds test.
- **The tour.** The scan clusters the outing photos in time order with the
  area machinery and always puts the **arrival airport first**, so a candidate
  has at least two stations even when only one downtown cluster exists. Legs
  between consecutive stations use the same mode evidence the areas use,
  usually one short road leg from the airport. A stopover is hours, not days:
  no night is ever assigned to its stations, and they never enter the night
  plan. The name comes from the same naming chain as stations (Immich city
  majority, else reverse geocode, else the airport's city), with the stopover
  day's year in the trip's own zone. A second candidate in the same city and
  year gains the short day suffix the trip's roadtrip names use —
  `"<City> <Year> Road Trip (4 Dec)"` — then a number for any further
  collision, so the scan never mints the same title twice.
- **Review.** A new **Stopovers** card sits directly after the flights card,
  where the layover's rows already live. Per stopover it shows the city, the
  day, "N h at <IATA>" and the photo counts, the tour's stops read-only in v1,
  the map preview pinned to the tour, and two switches, both off by default:
  "Make it a roadtrip", and "Its own album: <title>", enabled only while the
  first is on and captioned that the photos stay in the trip's album too. With
  roadtrips switched off in Settings, the first switch is disabled with the
  same reason the roadtrip switches already give. The ticks are ordinary
  review edits: they replay after a re-scan, and the commit body is the single
  source of truth for what is written.
- **Commit.** The body gains one top-level `stopovers` section
  (`{ key, roadtrip, album }` per toggled stopover; `album: true` requires
  `roadtrip: true`, and only keys the scan offered pass). The roadtrip is
  written in the one transaction like any other: mode road, vehicle car, its
  stations validated by the same schema the areas use with no nights. The
  album goes in the album phase, under the same preflight, marker and retry
  rules as the trip's own album.

**One name, two albums.** The roadtrip and the Immich album share the name
`"<City> <Year> Road Trip"`. The stopover's photos stay in the trip's main
album untouched, and a second album of that name is found or created by exact
owned name, keeping the `TravStats trip ·` marker prefix in its description,
and linked to the trip like any other album; its asset list is the whole
layover's photo set, not only the outing. The ALBUMS card and the gallery
render every linked album in `sortIdx` order, so both appear side by side with
no new read path. A failed album never fails the trip: the success panel shows
a line per album, each with its own retry, and the retry is name-aware so it
can never update the trip-named album instead.

**The journey shows it with no new read code.** The stopover roadtrip is an
ordinary roadtrip filed on the trip: the ROADTRIPS card lists it beside the
trip's own, and the timeline places its stops between the two flights through
the existing date-driven flight-to-roadtrip mapping — after the first lands,
before the second departs.

**Re-syncing a stopover is add-only.** The stored tables carry no stopover key
(there is no migration), so a re-sync matches by data: the trip's roadtrip
whose name equals the computed title and whose stations' days fall inside the
stopover day. Matched ids are claimed before the area match runs, so a regular
area can never match, steal or duplicate a stopover roadtrip. A matched
stopover shows both switches on and locked, marked *already synced*, with
current against stored photo counts; new photos in the same window surface as
an updated count and a note. A re-sync never rebuilds the tour, never deletes
the stopover roadtrip and never removes members from the city album. When a
stopover's flights were deleted and re-added (new ids, new key) it reads as a
new candidate and the previous roadtrip is left untouched. `TRIP_CHANGED`
covers the stopover writes through the same write path, so a trip that changed
under the scan can never lose stops by omission.

**Where it touches code upstream also changes.** The stopover reuses the
flight anchors, clustering, naming and leg machinery the areas use, so a
rebase that moves `flightAnchors.ts`, `areaPlans.ts` or `nameClusters.ts`
moves it too; also: `services/tripBuilder/stopovers.ts` and the thresholds,
`buildDraft.ts` and the draft store and types, the commit schema and
`commitPlan.ts`, `albumWrite.ts` and the album target resolver, the re-sync
match in `reconcile.ts` and `existingState.ts`, and the frontend review state,
`ReviewStopovers.tsx` and the `tripBuilder` i18n namespace.

**Out of scope in v1.** Editing a stopover's stations in the review; removing
a stopover or rebuilding its tour on a re-sync; removing members from the city
album; date-only connections; and excursions beyond the 30 km layover radius,
which keep taking the existing ground-area path. Nothing here changes how the
trip's own album is built, named or removed.

### A multi-day pitstop becomes its own roadtrip and album

A multi-day stay that starts and ends at the same airport — fly in, drive
inland, roam the city, fly out days later — used to fold into the ground
areas as an ordinary stay, and the review's default for a compact
single-city area is a timeline stop, so the stay often produced no roadtrip
at all. Ordinary roadtrips never got an album of their own either: the
independent-album machinery was wired to stopovers only. Now every
multi-day **pitstop** is offered as its own roadtrip with its own
independent album, **on by default** — a stay is not an airport visit, so
the stopover cards keep their off-by-default rule.

**How it runs.**

- **Detection.** An area is a **pitstop** when it lies strictly between two
  flights adjacent in departure order that **share an airport** — the same
  edge test the stopover branch uses — when the arrival and the departure
  fall on **different local days** (an overnight or longer; a pair without
  clock times compares the days it has), and when it is not the trip's
  **principal destination**. A same-day pair stays an ordinary area
  whatever its gap, and an overnight connection under 12 h is the stopover
  feature's business: hours are airport visits, days are stays.
- **The principal destination.** The ground stay with the most nights is
  the trip's destination; ties go to the stay with the most photo-days,
  then to the earliest first day. Exactly one area is the destination, and
  only when it is itself bounded by a same-airport pair could it otherwise
  qualify as a pitstop — it keeps the trip's main album and gets no city
  album, which would only duplicate it. Home-side ground, before the first
  flight or after the last, is untouched.
- **The name.** `<City> <Year> Road Trip (<Trip Name>)`, where City is the
  roadtrip's own main-city title — the same string its roadtrip name uses
  after the `·` — Year is the area's first day's year in the trip's own
  zone, and the parenthetical is the trip's name, dropped when City and
  the trip's name are equal.
- **Review.** No new card: the offer rides the existing area card. For a
  pitstop the kind already reads **Roadtrip**, and a switch sits beneath
  it — "Its own album: <name>" — **checked by default**, one untick away.
  The switch is disabled when the kind is not roadtrip and when roadtrips
  are switched off in Settings, with the reason the roadtrip controls
  already give. The kind and the tick are ordinary review edits: they
  replay after a re-scan, survive a reload, and the commit body carries
  exactly what the card showed.
- **Commit.** The area's entry in the body's `areas[]` gains an `album`
  boolean; `album: true` requires the area's kind to be roadtrip (the
  strict schema refuses the rest), and only an area the scan offered as a
  pitstop may carry it. The roadtrip write is unchanged; the album goes in
  the album phase **through the stopover album machinery**: found or
  created among the user's own albums by that exact name, its description
  keeping the `TravStats trip ·` prefix, the area's own photo set added,
  then linked to the trip like any other album.

**The third album class.** The trip's main album, the stopover albums and
now the pitstop albums share one writer, one marker and one retry. A
pitstop's photos stay in the trip's main album untouched. A failed album
never fails the trip: the success panel shows a line per album, each with
its own retry, and a city album's retry resolves its album by its key
against the committed draft that wrote the trip — refused (409) rather
than guessing when that draft is gone — so it can never write the wrong
one. A pitstop album is add-only: nothing is ever removed from it, and
the builder never deletes it.

**Re-syncing a pitstop is add-only.** A pitstop area matches its stored
roadtrip through the ordinary area matching — station overlap — unchanged;
what is new is the album's state in the review. When the trip links the
user's own album of the computed name, the review shows the switch on and
marked *already synced*, the current photo count beside the stored one,
and committing writes no station — the album's re-sync adds only the
members it lacks, nothing when nothing changed. When the album is missing
— an area that became a roadtrip before this feature existed is the live
case — the switch shows on, and committing creates the album from the
area's current photos **without touching the roadtrip**: the area's own
diff still governs the roadtrip, and an unchanged re-sync writes no
stations at all. An unmatched pitstop writes its roadtrip and album
together, as at first commit. The
`TRIP_CHANGED` guards, the claim-before-areas discipline and the add-only
v1 boundaries are those of the stopover feature; pitstop albums inherit
them.

**Where it touches code upstream also changes.** The pitstop marking
reuses the flight anchors, the area machinery and the naming chain the
areas use, so a rebase that moves `flightAnchors.ts`, `areaPlans.ts`,
`buildDraft.ts` or `nameClusters.ts` moves it too; also: the scan's
pitstop module beside `services/tripBuilder/stopovers.ts`, the area DTO
and its frontend mirror, the commit schema's area entry, `commitPlan.ts`,
the album machinery (`stopoverAlbum.ts`, `albumResync.ts`,
`albumWrite.ts`), the re-sync annotations in `reconcile.ts` and
`existingState.ts`, and the frontend's `ReviewAreaSection.tsx`, its review
state and the `tripBuilder` i18n namespace.

**Out of scope in v1.** Albums for timeline stops (an album requires a
roadtrip); removing a pitstop album; rebuilding a pitstop's tour;
renaming the pitstop album in the review (the name is computed); stays
whose in and out flights use different airports of one metro (the
same-airport rule stands); and same-day stays or hours-long layovers,
which the stopover feature owns. Nothing here changes how the trip's own
album is built, named or removed.

### The journey and the trip share one template

The journey page and the trip page had grown apart: the trip page carried a
figures band, a station chain and a map, the journey page a tab bar, a meta
line and roadtrip cards. They are one template now, at two levels, and the
words follow the shape: the top level is a **Journey**, the car entry nested
in it a **Trip**. The URL paths (`/trips/:id`, `/roadtrips/:id`) and the
database models keep their names — this is a copy change, not a schema one.

**One shell, two cell sets.** Both levels draw the same page: a header that
is the entity's name and its country flags and nothing else, exactly one
action — **Edit**, onto the level's own edit page — a figures table, then the
level's tabs. The table's cells are the level's own. A journey shows Dates ·
Days · Km · Countries · Trips · Albums, where **Km is the SUM of its trips'
driven kilometres**; a trip shows Dates · Driven km · Days · Slept in ·
Countries · Journey (a link back) · Album, and that album is the trip's OWN
one — the `<City> <Year> Road Trip (<Trip>)` resolution of the pitstop work,
falling back to the journey's first album by that rule. Days keep the
2026-10-11 convention: the inclusive span, `≈` while an end is coarse.

**Tabs.** Overview · Timeline · Map · Gallery · Logistics on both levels, and
the journey adds **Trips**. The old Tours tab became it: the same beta gate on
the roadtrips domain, the journey's trips as cards, and `?tab=tours` still
lands there for links written before the rename. The journey's Overview draws
the **trips chain** — one node per trip: name, date span, driven km, station
count, a link to its page — then the map, and the AI summary below the map.
The trip's Overview draws its finest chain (day headers, every station, the
legs, the nights), its deeper day-by-day detail sits on the Timeline tab, and
the Map tab is full-screen on both levels.

**Edit pages.** The standalone Edit, Delete and Re-sync buttons left the
headers. Each level has one edit page: the journey's carries the old modal's
fields (name, category, start and end dates, origin, destination,
description, companions, tags, cover, colour, notes) plus **Re-sync from
Immich** and **Delete**; the trip's is the existing route & recordings
editor with the same two sections. Deleting a journey detaches its trips —
never deletes them — and never touches the Immich album (§J of the builder
spec, pinned in `routes/__tests__/trips.deleteDetach.test.ts`).

**A trip's own AI summary.** `TripRoute` gains `summary`,
`summaryGeneratedAt` and `summarySource` — the journey's columns, through a
Prisma migration, no backfill — generated by the same service pattern and the
same provenance rules as the journey's, through a regenerate route mirrored at
the trip level. The trip's Overview shows it below the map, with Regenerate. A
detached trip shows no summary section until it is filed on a journey again.

**Everything a trip changes shows on its journey.** Both levels read the same
rows: the journey's kilometres are the sum of its trips' stored ones, and its
chain, Trips tab and Gallery read the trips and the album links the journey
carries — so a rename, a re-date, a station edit or an album change appears on
the journey with no second copy to update. The propagation rule is pinned, not
assumed (`pages/__tests__/TripDetailPage.tripsPropagation.test.tsx`).

**Words.** The sweep runs over both locales: every surface that said Roadtrip
for the car entry — page titles, cards, buttons, empty states, modals, the
domain labels, the builder's offer — reads Trip now (German also says "Trip",
the register it already used for "Roadtrip"). Untouched on purpose: the
DB-level kind labels (`roadtrip` vs `tour`) with the 2.7 classification review
that assigns them, the historic release notes, the spreadsheet's sheets and
columns (an export written before the rename must still read back, and the
journey sheet is already called "Trips"), and every URL path and model name.
The guard is `i18n/__tests__/tripVocabulary.test.ts`.

**Where it touches code upstream also changes.** The shell is
`components/Entity/` (page, header, figures), the folds it reads live in
`lib/entityFigures.ts` beside the levels' own (`roadtripView`,
`journeyFigures`, `roadtripAlbum`), the chain in
`Trips/JourneyTripsChain.tsx`, the tabs in `TripDetailPage` and
`RoadtripDetailPage`, and the summary service beside the journey's. A rebase
that moves the trip detail page moves all of it.

**Out of scope in v1.** Per-trip summaries for detached trips (documented
above); renaming the URL paths or the Prisma models; any change to the map
engine or the timeline data model; and the journey level's remaining "trip"
wording where it names the journey itself.

### Smaller things

- **One page width.** The three container widths collapse to one, so every page
  is the width of the logbook rather than a shape of its own. The number is
  `PAGE_WIDTH` in `frontend/scripts/generate-theme.mjs`, which writes
  `--ts-width-reading`, `-list` and `-table`; the generated CSS is never
  edited by hand (the theme guard fails if it is).
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
- **One yellow for every travelled way.** Roadtrip and tour paths are the
  accent `#f0a947` (the "+ New roadtrip" colour), on the map, the cards and the
  legend. `design/tokens.json` and the backend `domains.ts` mirror carry it too,
  a deliberate divergence from the Companion, whose `road` is still moss. The
  colour guard (`domainColorsNotStatus.test.ts`) exempts exactly the flight,
  roadtrip and tour from the accent rule, and only against `warn`, which is the
  accent's own pressed shade 39.4 apart; every other domain stays clear of the
  accent and of info, warn and bad.

### On-demand map fetching for routing (2026-10-13)

When the routing provider answers from a road graph that has no data for a trip's region, its line snaps hundreds or thousands of kilometres away; the app refuses that answer and now also asks an operator-configured helper — the `osrm-autofetch` service — to fetch the missing region. The helper downloads the region's OpenStreetMap extract, rebuilds the routing graph into a staging directory, swaps it in while the old graph keeps serving, and restarts the router; the next attempt routes. The admin setting `routingAutoFetchUrl` holds the helper's URL; left empty, behaviour is byte-for-byte what it was before this change. The refusal message itself then says the map for the region is downloading, and roughly how long it takes.

The same routing guard accepts the provider's own nearest-road snap when a trip
pin sits within 25 km of a road — a photo taken on a beach or a hike routes from
the nearest road instead of being refused — and keeps refusing (with the map
fetch) beyond that bound. The fetch trigger fires on **any** refusal, one-sided
included: the snap bound refuses only when one end is more than 25 km off, which
is always beyond the trigger's lower 20 km threshold, so a wrong-region refusal
never leaves without asking the service.

**The app reports the download, and links to it.** A running download used to be
invisible: the alert said a region's map was on its way and then nothing said how
far along it was. An admin **Settings** page now carries a map-download panel
(`RouteFetchProgressPanel`) that polls a new admin endpoint
(`GET /admin/route-fetch`, which proxies the service's own `/status` and never
throws — a stopped service is the panel's "unreachable" state, not a 500). The
panel shows what the service reports and nothing it invents: the phase in words,
the region label and regions, the elapsed time, and an ETA only when the service
supplies one — no invented percentage. The downloading alert links to that panel
on both surfaces it renders on (the toast and the leg dialog), for admins only
and only for the `started`/`running` answer that names a region, so neither
surface silently lacks it. The endpoint lives on the admin mount, which is
undocumented by design — no new public endpoint and no OpenAPI path.

**The service covers the ground between two points, not just the endpoints.** A
leg resolved only from its two ends could miss a region the route crosses; the
service now samples each consecutive pair's great circle and unions every
covering extract, so the corridor is covered. A mid-path sample is never allowed
to pull a continent-scale extract (only a request's own point may), the
already-built regions are dropped before the per-job cap is applied so a long
corridor makes progress across attempts, and an interior request point in
uncovered ground is refused rather than silently skipped. That work lives in the
service's own repository, not this one — see the README's "Outside this
repository".

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

**Albums can be written, with the user's own key only.** The trip builder can
make an Immich album for a trip and add its photos, and a re-sync can take
photos that fall outside the new dates out of it. Every such step checks that
the connection is the user's own and that the key grants the scopes it needs;
with a shared connection or a missing scope the builder says so and saves the
trip without the album. The album is linked to the trip afterwards, in `link`
mode like any other.

## Running it

Build and deploy notes live beside this file in the fork's own deployment — the
container image is built from this repository (`docker build -f server/Dockerfile`),
and the app runs from a compose file that pins `IMMICH_VERSION` so the server and
the machine-learning image move together. Immich does not support version skew
between the two.

The machinery that deliberately lives outside this repository — the on-demand
map-fetch service, the OSRM data layout it rebuilds, and the scripted
deployment with its pre-deploy database backups — is described in the README's
"Outside this repository" section.

No credentials, hostnames, album names or itinerary data belong in this
document. If you are forking this in turn, keep it that way: the code is meant to
be shared, the logbook behind it is not.
