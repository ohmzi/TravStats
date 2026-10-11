# Stopover roadtrips — design (TravStats fork)

Status: approved in conversation 2026-10-11 (owner); this document is the binding design.
Builds on: `2026-10-09-immich-trip-builder-design.md` (the trip builder), whose machinery this spec extends. Everything not changed here keeps that spec's rules.

## 1. The want

A flight trip often connects through an airport where the traveller actually left the terminal — Istanbul for ~8 h on the way to Karachi, with 98 photos downtown. Today the builder classifies that stretch as a **layover**, flags its photos `layover`, and deliberately keeps them out of ground areas, stations and nights: the stopover can never become a roadtrip, and only a "N photos during the layover" line on the flight row marks it.

The owner wants, in the sync review:

1. a per-stopover toggle to make the stopover a **roadtrip** — its stops derived from the photos' geotags, mapped in the journey between the two flights, with a timeline;
2. once that is on, a second toggle to also make it an **independent album and roadtrip** named `"<City> <Year> Road Trip"` ("Istanbul 2025 Road Trip"), combining all the stopover's pictures there — while those photos **also stay in the trip's main album**;
3. the journey shows everything combined: every flight, every roadtrip, the flight↔roadtrip mapping, and all albums with their pictures.

Owner rulings (2026-10-11, conversation):

- **In both albums.** The stopover's photos are in the independent city album and remain in the trip's main album.
- **One name for both.** The roadtrip entity and the Immich album share the name `<City> <Year> Road Trip`.
- **Offer when the outing is real.** The toggle is offered only when the layover has geotagged photos meaningfully away from the airport (thresholds below).
- **Both toggles off, per stopover.** Nothing is pre-selected; the album toggle only enables with the roadtrip toggle on.
- **Approach A — a dedicated stopover concept end to end.** Stopovers do not become areas and do not touch the area/night machinery; they are their own section from scan to commit (approach B, promoting layovers to areas, and C, deriving at commit time, were rejected — B erodes the deliberate area/layover split and the naming rules, C breaks "the review shows what will be written").

The example that must work: the owner's **Karachi 2025** trip (`94128bb5-…`, 2025-11-09 → 2025-12-04, 7 flights). On 2025-11-10, TK0036 (YYZ→IST) lands 10:25Z and TK0708 (IST→KHI) departs 18:20Z; Immich holds 98 photos in that window, 97 geotagged, all ~15–25 km from IST in the Sultanahmet area.

## 2. Detection (scan)

A **stopover candidate** is an existing `Layover` (see §2.1) that passes one added test:

- at least `STOPOVER_MIN_PHOTOS` (= 5) of its geotagged photos lie further than `STOPOVER_MIN_KM` (= 5) from the layover airport — the **outing set**.

Both are new constants in `services/tripBuilder/thresholds.ts`; both are tunable and pinned by tests.

### 2.1 What a layover is (unchanged, restated)

`splitIntoAreas` (`flightAnchors.ts`) pairs **adjacent flights in departure order** that share an IATA airport. When the precise ground gap is `0 ≤ gap < LAYOVER_MAX_H` (12 h) — or the two flights share a day when either lacks a time — and **every** photo of the stretch is within `LAYOVER_RADIUS_KM` (30) of the **arrival** airport, the stretch is a `Layover { inFlightId, outFlightId, airportIata, photoIds }` instead of a `GroundArea`. Its photos are flagged `layover` and excluded from movement/night evidence, but they remain in stats, per-day counts, and `albumAssetIds` — which is why "photos stay in the trip's main album" already holds and needs no change.

A consequence kept as-is in v1: an excursion beyond the 30 km radius fails the layover test and the stretch becomes a ground area by the existing rules; the stopover offer only covers layovers.

### 2.2 The tour

For each candidate the scan derives a stopover tour from the outing set, with the existing machinery and two stopover-specific rules:

- **Stations.** Cluster the outing photos (the same city-cluster/median machinery areas use), in time order. The tour **always begins with the arrival airport as its first stop** (title = the airport's city/name, rendered like the area airport anchors), then the derived clusters. That guarantees at least two stations whenever the candidate exists (a single downtown cluster still yields `[IST airport, downtown]`), which the roadtrip model and the review's `roadtripTooShort` check both want. Station keys are minted in the same pass and from the same scan-wide `taken` set as area stations, so keys never collide.
- **Legs.** Between consecutive stations, by the existing leg machinery (mode evidence; road unless evidence says otherwise) — for a compact downtown cluster this is usually a single short leg from the airport.
- **Nights: none.** A stopover is hours; no night is assigned to its stations, and they never enter the night plan.
- **Name.** `<City> <Year> Road Trip`, where City is the existing naming chain's answer for the outing set (Immich city majority → reverse geocode, falling back to the airport's city) and Year is the stopover day's year in the trip's local time. The name is both the roadtrip's name and the album name (owner ruling).
- **Album asset list.** The stopover's album pictures are the **whole layover's photo set** (`Layover.photoIds`, all 98 for Istanbul), not only the outing set.
- **Previews.** The stopover stations' thumbnails join the draft's numbered preview space (no Immich asset id crosses the API) exactly as area stations do.

### 2.3 The draft

`StoredDraft` gains `stopovers: StoredStopover[]` (`{ key, title, city, day, inFlightId, outFlightId, airportIata, photoIds, stations, legs }`), persisted at scan time — today the layover's photo ids are dropped after the scan and only `{photoCount, airportIata}` reaches the API, so this is the one new piece of server state.

`TripBuilderDraft` gains `stopovers?: DraftStopover[]` (backend and frontend mirrors, OpenAPI):

```
DraftStopover = {
  key: string            // `${inFlightId}#${outFlightId}` — stable across scans
  city: string           // "Istanbul"
  title: string          // "Istanbul 2025 Road Trip"
  day: string            // the stopover day (YYYY-MM-DD, trip zone)
  airportIata: string | null
  photoCount: number     // the whole layover set (album list)
  outingCount: number    // the ≥5 km set (the tour)
  stations: DraftStation[]  // airport first; previewIdx-based thumbnails
  legs: …                // the derived legs between those stations, in the same shape the
                         // draft's area stations already use (drawn by the same row component)
}
```

The stopover key stays **outside the area-key namespace** (`YYYY-MM-DD#n`); validation of the new section (§5) treats it as its own namespace.

## 3. Review

A new **Stopovers** card (`ReviewStopovers.tsx`, built on the shared `ReviewSection` frame) sits in the review body directly after the flights card — same flight/layover context. Per draft stopover:

- heading: city, the day, "N h at <IATA>", and the photo counts (`98 photos in the city`);
- the tour's stops listed (arrow styles like the area station rows), **read-only in v1** (names come from the geotags; station-level editing inside a stopover is a follow-up);
- switch 1 **"Make it a roadtrip"** — off by default; disabled with the existing reason when roadtrips are switched off in Settings (`roadtripsHidden`);
- switch 2 **"Its own album: <title>"** — disabled until switch 1 is on; a caption states the photos stay in the trip's album too;
- the sticky map preview pins the stopover's tour.

Selections are ordinary review edits: a tick per stopover lives in `ReviewState` beside `flightTicks`/`photoJourneyTicks`, is recorded in the `DraftEdit` union, replayed by `reapplyEdits` after a re-scan, and survives reload through the stored review session. The commit body is the single source of truth for what is written — the review and the write cannot disagree.

## 4. Journey (no new read code)

The stopover roadtrip is an ordinary roadtrip filed on the trip, and the independent album is an ordinary linked album:

- the trip page's ROADTRIPS card lists it beside the trip's own roadtrips;
- the timeline places its stops **between the two flights** (the existing date-driven flight↔roadtrip mapping; for Istanbul: after TK0036 lands, before TK0708 departs);
- the ALBUMS card and the gallery already render every linked album in `sortIdx` order, so both albums appear with no new read path.

## 5. Commit

### 5.1 Request

`commitBodySchema` (backend, `.strict()`) and the frontend `CommitBody` gain one top-level section:

```
stopovers: [{ key, roadtrip: boolean, album: boolean }, …]   // only toggled-on candidates
```

- `album: true` requires `roadtrip: true` (the review enforces this; the schema does too).
- Every `key` must name a draft stopover (an `assertOffered`-style check) — a body can only write what was offered.
- The pinned "exactly these eight keys" test (`draftEdits.commitBody.test.ts`) is updated in the same change, deliberately.

### 5.2 Plan

`prepareCommit` gains a `stopoverPlan()` step, next to `roadtripPlan`/`stopPlans`:

- each toggled stopover becomes `{ key, roadtrip: { name, vehicle: "car", stations }, album: null | { name, assetIds } }` — **no nights**, and **outside** `body.areas`/`body.nights`, so the night-plan validation never sees it;
- stations go through `deriveStationRows` with no night assignments, then the same `stationsSchema` the areas use; the airport-first rule (§2.2) keeps the two-station minimum;
- album asset ids come from the stored draft's stopover (server-side only; the client never sends asset ids).

### 5.3 Phase B (the one transaction)

Per toggled stopover: `insertRoadtrip(tx, userId, { tripId, name, mode: "road", vehicle: "car" })`, then `replaceStationsInTx` with the stopover's station rows. Ordinary tables, no migration.

### 5.4 Phase D (albums) and failure

- The main album write is unchanged; the stopover photos are already in its list.
- Per stopover with `album: true`: preflight (own-key scopes, ownership — the existing check), **find-or-create by exact owned name** `"<City> <Year> Road Trip"` with the description keeping the exact `TravStats trip ·` prefix (`TravStats trip · Istanbul 2025 Road Trip`), add the stopover's asset ids, then `upsertAlbumLink` — a second linked album, appended by `sortIdx`.
- Failure semantics mirror the main album: the trip still saves; the success panel shows a line per album, each with its own retry. Retries of the trip's albums run one at a time in v1 (the existing per-(user,trip) album-job key stays); the retry route's target selection becomes **name-aware** so it can retry the stopover album rather than always the trip-named one.

## 6. Re-sync (spec §K) — v1 boundaries

- `loadExistingState` also loads the trip's roadtrips into a **stopover match pass** keyed by the stopover key. The stored tables carry no stopover key (no migration), so the match itself is by data: the trip's roadtrip whose name equals the computed title and whose stations' days fall inside the stopover day. The key identifies the candidate within a scan (and its review edits); the match bridges to storage. Matched roadtrip ids are **claimed before** `matchAreasToRoadtrips` runs, so a regular area can never match, steal or duplicate a stopover roadtrip.
- The review shows a matched stopover with both switches **on and locked**, marked *already synced*, with current vs stored photo counts. `StoredExisting` gains a stopovers map carrying matched ids, mirroring `StoredRoadtripOffer`.
- **Add-only:** a re-sync never rebuilds or deletes a stopover roadtrip and never removes members from the city album. The main album keeps its full existing removal behavior. New photos in the same window surface as an updated count with a note; tour rebuilds and city-album removal are follow-ups.
- A stopover whose flights were deleted and re-added (new ids → new key) reads as a **new** candidate; the previous roadtrip is left untouched, never auto-deleted.
- The `TRIP_CHANGED` guards extend to stopover writes through the same write path (`writeMatchedRoadtrip`'s offered-ids re-read) so the delete-by-omission protection holds everywhere.

## 7. Out of scope (v1)

- Editing a stopover tour's stations (names, add/remove) in the review.
- Removing a stopover (toggle-off) or rebuilding its tour on re-sync; city-album removal.
- Date-only connections (a layover between flights without times is already detected; the stopover offer for those comes later).
- Excursions beyond the 30 km layover radius (they take the existing ground-area path) and stopovers at non-layover gaps.
- Any change to how the trip's own album is built, named or removed.

## 8. Testing and acceptance

TDD per module, in the builder's style, each unit independently reviewed; no migration. The pinned tests the grounding identified must be updated deliberately and named in the units: the commit-body key list test, the review's switch-index tests, and the i18n key guard. New tests cover: thresholds at the boundary (4 vs 5 photos, 5 km either side); the airport-first two-station minimum; name generation; the strict commit body (unknown key, album without roadtrip); the plan's night-free rows; phase B rows (one roadtrip per toggled stopover, no nights); the second album (create/add/link, the marker, name-aware retry); re-sync matching (claimed before areas; locked toggles; no rebuild; flight-ids-changed → new candidate); and the review composition (the Stopovers card, the switch gating, replay after re-scan).

**Acceptance (UAT on the owner's Karachi 2025):** scan → the Istanbul stopover appears with ~98 photos → toggle both switches → Update trip → the journey shows the roadtrip named "Istanbul 2025 Road Trip" with its stops on the timeline between TK0036 and TK0708, and the album of the same name linked beside the trip's album, its photos in both; a re-sync then marks it *already synced* with nothing changed; the Smokey Mountains 2025 trip (no qualifying stopover) is unchanged.
