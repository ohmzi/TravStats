# Pitstop roadtrips and their own albums — design (TravStats fork)

Status: approved in conversation 2026-10-11 (owner); this document is the binding design.
Builds on: `2026-10-11-stopover-roadtrips-design.md` (the stopover feature). Everything the stopover spec defines — candidate shape, review ticks, the `stopovers` wire section, the second album's write/retry/link machinery, re-sync claiming, add-only guarantees — is reused verbatim unless stated here.

## 1. The want

The stopover feature covers **hours-long** layovers (a same-airport flight pair whose ground gap is under `LAYOVER_MAX_H` = 12 h). A **multi-day** stay between a flight in and a flight out of the same city is an ordinary ground **area** instead, and two gaps showed up on a real trip:

1. A four-day stay that was genuinely a visit (fly in, drive inland, roam the city, fly out) defaulted to a **timeline stop**, not a roadtrip — the review's area-kind default for compact single-city areas — so it produced no roadtrip at all.
2. Even when such a stay *is* a roadtrip, it never gets its own album: the independent-album machinery is wired to stopovers only (per-leg albums were never part of the original one-album-per-trip design).

The owner wants: **every multi-day pitstop — flights in and out of the same city on different days — is its own roadtrip, with its own independent album**, named `<City> <Year> Road Trip (<Trip Name>)`.

Owner rulings (2026-10-11):

- **On by default.** For a qualifying pitstop the review shows the area as a Roadtrip with its own album switch already ON — visible, one untick away. (Hours-long stopover cards keep their off-by-default rule: those are airport visits; these are stays.)
- **Naming.** The album is `<City> <Year> Road Trip (<Trip Name>)` — city and year like the stopover albums, the parent trip in brackets (e.g. a synthetic `Eastport 2031 Road Trip (Northvale loop)`).
- **Travel pitstops only.** The trip's **principal destination** — the ground stay with the most nights — keeps the trip's main album and gets no city album (a city album there would duplicate it). Home-side ground (before the first flight or after the last) is untouched.
- **On the existing area cards.** No new card type: the pitstop's kind defaults to Roadtrip and the album switch sits under it.

## 2. Detection (scan)

An area is a **pitstop** when all of:

- it lies strictly between two flights adjacent in departure order — the arriving flight before the area, the departing flight after it (the same edge test the stopover branch (b) uses);
- those two flights **share an airport** (`sharesAirport`: the same IATA in and out);
- the in/out flights are on **different days** — the owner's rule, literally: the arrival's local day differs from the departure's local day (an overnight or longer). This applies to precise pairs (`arrDay !== depDay`) and to pairs without times (the same comparison on their known days). Same-day pairs stay ordinary areas, whatever their gap; sub-12 h overnight connections are the stopover feature's business;
- it is **not the principal destination**: the area with the most nights wins that title (ties: most photo-days, then the earliest `firstDay`); exactly one area is the destination, and only when it is itself flight-bounded by a same-airport pair does the exclusion matter.

The DTO: `DraftArea` gains `pitstop?: { albumName: string }` — present only on qualifying areas; `albumName` is server-computed (§6). Nothing else about areas changes.

## 3. Review (the existing area card)

`ReviewAreaSection` gains, for a pitstop area only:

- the kind **defaults to Roadtrip** (a pitstop is a real stay);
- a `Switch` beneath the kind: **"Its own album: <albumName>"**, **checked by default**, one untick away;
- the switch is disabled when the kind is not Roadtrip (album without a roadtrip is refused, mirroring `album ⇒ roadtrip` on the stopover body) and when roadtrips are switched off in Settings (the existing `roadtripsHidden` reason).

Both the kind and the album tick are ordinary review edits: recorded in the `DraftEdit` union, replayed by `reapplyEdits` after a re-scan, surviving a reload. The commit body carries exactly what the card showed.

## 4. Commit

- **Body.** The area's entry in `areas[]` gains `album: boolean` — declared in the strict `commitBodySchema`, offered-key-checked like `stopovers`, and `album: true` requires the area's kind to be `roadtrip` (schema-level, mirroring §5.1 of the stopover spec).
- **Plan.** The area's roadtrip write is unchanged; its plan entry gains an optional `album: { name, assetIds }` (asset ids = the area's own photo set, server-side only — the client never sends ids), mirroring `StopoverPlan`.
- **Phase D.** The pitstop album is written through the same machinery the stopover albums use — exact-name find-or-create among the user's owned albums, description keeping the exact `TravStats trip ·` prefix, members added, then `upsertAlbumLink` (a further linked album appended by `sortIdx`). The retry route resolves it by name through the same name-aware path; the success panel shows a line per album, with its own retry.
- **Failure semantics** mirror the other albums: the trip saves even when an album write fails; nothing is written before confirm.
- **Add-only.** A pitstop album never removes members and is never deleted by the builder.

## 5. Re-sync (spec §K)

- A pitstop area matches its stored roadtrip through the **existing area matching** (station overlap) — unchanged. What is new is the album: `applyExistingTarget` describes, for a matched pitstop area, whether a linked album named `albumName` already exists (its asset count included).
- A matched area whose album **exists** shows the switch ON and marked *already synced* (counts line, like stopovers); committing writes nothing.
- A matched area whose album is **missing** (an area turned into a roadtrip before this feature existed — the live case this design came from) shows the switch ON; committing **creates the album from the area's current photos without touching the roadtrip** (the area's own §K diff governs the roadtrip; an unchanged re-sync writes no stations).
- Unmatched: the pitstop writes its roadtrip and album together, as at first commit.
- The TRIP_CHANGED guards, the claim-before-areas discipline and the add-only v1 boundaries are those of the stopover spec; pitstop albums inherit them.

## 6. Naming

`<City> <Year> Road Trip (<Trip Name>)`, where:

- **City** is the roadtrip's own main-city title (§C.11's main city — the same string the roadtrip name uses after the `·`);
- **Year** is the area's `firstDay` year in the trip's zone;
- **Trip Name** is the trip's name; when City and the trip's name are equal (a destination-like case the rule mostly excludes), the parenthetical is dropped.

The album's description keeps the exact `TravStats trip ·` prefix so the marker rules (and any future removal default) hold, exactly like the other two album classes.

**Ruling (2026-10-12).** City is the city the **airport** serves, not the area's photo-majority `mainCity`: the owner, asked whether a stay whose photos sat in one town should be named for that town or for the airport both bounding flights used, answered the airport's city. The shared airport's served city therefore comes first, and a catalogue city that lists two (a "Northvale/Seeb" row — the airport serves Northvale) counts as its first name; then the airport's own display name, where no city can be trusted; then the area's main city, the rule this replaces. The roadtrip row takes the same city — the string its name follows the `·` with is the album's City — so the two can never disagree.

## 7. Out of scope (v1)

- Albums for timeline stops (an album requires a roadtrip); removal of pitstop albums; rebuilding a pitstop's tour; renaming the pitstop album in the review (the name is computed — an editable name is a follow-up if wanted).
- Multi-airport metros: a stay whose in/out flights use different airports of one metro (e.g. two airports 40 km apart) is not a pitstop by the same-airport rule; extending `sharesAirport` to a metro radius is a separate decision.
- Same-day stays and hours-long layovers (the stopover feature owns those).

## 8. Testing and acceptance

TDD per module, each unit independently reviewed; no migration; the copy in en and de. New tests cover: detection (the different-day pair, the same-day rejection, the day-level pair, the principal-destination exclusion including the tie-break, the first/last-flight exclusions); the DTO field; the review defaults (kind Roadtrip, album ON, untick, the kind cross-rule, `roadtripsHidden`); the strict body (unknown key, album without roadtrip); the plan's album carry; phase D writes and the per-album lines; re-sync (already-synced no-op; missing-album creation add-only; the roadtrip untouched); the naming rules incl. the same-name guard; plus updates to the pinned tests the changes touch (area defaults, body key lists, i18n guards).

**Acceptance (private ledger carries the real case):** on a 26-day trip with (a) a four-day same-city stay between flights where the traveller drove inland, and (b) a second short same-city stay whose roadtrip already exists but has no album — one re-sync shows both areas as pitstops with their albums ON; committing creates the first stay's roadtrip **and** album and attaches the missing album to the second, all add-only; a further re-sync is a clean no-op; the trip's principal destination and a trip with no qualifying pitstop are unchanged.

## 9. Delivery

Same pipeline as every feature here: plan tasks with exact code → subagent-driven TDD with independent reviews → gate at the frozen HEAD → whole-branch review of the diff → deploy → the live re-sync as UAT evidence.
