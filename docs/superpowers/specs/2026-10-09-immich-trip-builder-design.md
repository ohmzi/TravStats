# Trip builder from Immich: final design (TravStats fork)

**Design in one line.** Create-trip popup toggles start a read-only **scan job**. The job builds a draft that lives **in memory**, bound to its owner and an expiry. The user reviews and edits it on a **dedicated page**. Edits survive a reload because they are kept in `sessionStorage`. A **commit job** then:

1. runs an Immich preflight (no writes);
2. writes every TravStats row in **one transaction**;
3. marks the draft committed;
4. routes the legs;
5. does the album step, which can fail on its own and be retried.

There is no Prisma migration. Nothing is written to TravStats or Immich before "Create trip" is pressed.

Paths are relative to the repository root.

---

## 0. Preconditions and housekeeping (checked at HEAD `bfc733992`)

**1. Work from another session is live and uncommitted.** Treat it as off-limits, and expect the list to change:
- `docs/FORK_CHANGES.md` (+65 lines)
- `Dashboard/RoadtripCardOverlay.tsx`, `Dashboard/tabs/AllTab.tsx`
- `DeckGLMap.tsx`, `GlobePinnedOverlay.tsx`, `GlobeView.tsx`, `MapContainer3D.tsx`
- `map/cards/*` and their tests
- `i18n/{en,de}/{map,roadtrips}.json`
- two untracked tests

Work in a worktree cut from `bfc733992`. Write the FORK_CHANGES section last, after rebasing onto whatever that session lands. Do not touch `roadtrips.json`; all new strings go in a new namespace.

**2. Size ratchet.** The gate must be green (decision 2), so three prerequisite commits land before any feature work:
- **P1:** move about 30 lines of types out of `frontend/src/types/index.ts` (824 lines, not baselined) into new `types/*.ts` files, re-exported from index.
- **P2:** move one helper out of `backend/src/routes/flights.ts` (1327 lines against a baseline of 1304) into `services/flights/`.
- **P3 = D1:** extract trip creation from `backend/src/routes/trips.ts` (812 to about 745 lines).

Room left elsewhere:
- `middleware/rateLimit.ts` (799) has no room, so reuse the existing limiters.
- `tripDetectionService.ts` (790): add nothing.
- `TripDetailPage.tsx` (1152, baselined): net change must be negative.
- `TripModal.tsx` (598): about +35 lines.
- `App.tsx` (727): +4 lines.

**3. Gates to run by hand** (CI has never run on the fork):
- tsc and lint (including the time rules)
- `check:size`, `check:coverage` (backend 76.35 / frontend 56.21, −0.25 pp tolerance), `format:check`
- Jest, Vitest, plus Vitest under `TZ=Pacific/Kiritimati` and `TZ=America/St_Johns`
- DE/EN parity, the OpenAPI coverage, response-schema, time-shape and response-shape ratchets, and the JobKind union

**4. Privacy gate.** The fork is public. No real trip names, places, dates, flight numbers or album names may appear in tests, fixtures, comments or docs. All fixtures are synthetic (section H). Before each commit, grep the diff for the owner's place and trip names.

**5. Data note.** A trip whose end date carries a year typo spans hundreds of days and swallows every later window (and the "narrowest span wins" flight filing). Fix such data before UAT; the builder flags any overlapping trip longer than 60 days as `suspiciouslyLong`.

---

## A. Architecture and data flow

```
TripModal (create: two visible switches | edit: "Build from Immich photos…" button)
  └─ <TripBuilderLauncher> (rendered only after Save; owns useNavigate)
       POST /trip-builder/scan → 202 {jobId}; sessionStorage[tb:job:<jobId>]={form, target, returnTo}
       navigate(`/trips/builder?job=<jobId>`) THEN onClose()
TripBuilderPage (/trips/builder)
  ?job=  → waitForJob(onPoll "Step n of 7") → result {draftId} → replace(`?draft=<draftId>`)
  ?draft= → GET /trip-builder/drafts/:id → review (pure reducer, persisted to sessionStorage[tb:draft:<id>])
            thumbnails GET /trip-builder/drafts/:id/preview/:index/file
  "Create trip" → POST /trip-builder/drafts/:id/commit {commitKey, …}   (sync: DB-only validation → 202)
     job tripBuilder.commit:
       P  preflight (Immich, no writes; 4 s timeouts) → may end with result {status:"blocked", …}
       B  ONE prisma.$transaction (trip create|update, flights, stops, roadtrips+stations+leg modes)
          → finishCommit(draft, {tripId}) immediately
       C  try: auto-route legs, recomputeTripStatus, resolve ticked photo-journey findings
       D  try: album find-owned|create → add → link (outcome recorded, never throws)
  album failed/blocked → POST /trip-builder/trips/:tripId/album (job tripBuilder.album)
  success → summary panel → navigate(`/trips/${tripId}`)
```

### Draft store

`backend/src/services/tripBuilder/draftStore.ts` is an in-memory `Map`. A draft is a short-lived answer to one click, the deployment is a single Node process under supervisord, and keeping it in memory means no migration.

```ts
interface StoredDraft {
  id: string; ownerId: string; createdAt: number; touchedAt: number;
  status: "ready" | "committing" | "committed";
  commitKey?: string; commitJobId?: string; result?: CommitResult;
  input: ScanInput;                 // name, startDay, endDay, inspect, createAlbum, target
  immichUserId: string; connSource: ImmichConnectionSource;
  dto: TripBuilderDraft;
  previewAssetIds: string[];        // ≤ MAX_PREVIEWS=400, index-addressed
  albumAssetIds: string[];          // server-only
  flightIds: ReadonlySet<string>;   // the only flights a commit may assign
  stationIndex: Map<string, { areaKey: string; firstDay: string; lastDay: string }>;
}
putDraft(d)                // evicts the owner's oldest READY draft beyond 3/user; 50 global; never evicts committing/committed
getDraft(ownerId, id)      // null if foreign or expired (indistinguishable); slides the TTL
beginCommit(ownerId, id, key): {kind:"start"} | {kind:"inProgress", jobId} | {kind:"committed", result} | {kind:"busy"}
finishCommit(id, result)   // called right after phase B commits
abortCommit(id)            // ONLY from phase P/B failure paths
```

**Expiry and thumbnails.**
- A draft expires after 2 hours idle, or 6 hours at most. Time comes from `now()` (`shared/time/clock.ts`).
- Thumbnails follow `routes/immich/assetProxy.ts:117`: `authenticate` plus `immichProxyLimiter`.
  - The asset id is `previewAssetIds[index]` and never comes from the request.
  - `index` is an integer from 0 to 399, declared with its own schema.
  - Responses use `streamAsset`/`sendPlaceholder`.

### Commit safety

**Sync handler (DB only, no Immich calls, so it answers well inside the browser's 10 s limit):**
- The draft exists, belongs to the caller, and is `ready`.
- Zod body validation.
- `deriveStationRows` + `validateNightPlan` (section C.10), then `stationsSchema.parse` for each roadtrip area. Failures return **400** with `NIGHT_PLAN_INVALID` or `STATIONS_INVALID`.
- The window equals the draft's window. Otherwise **409** `WINDOW_CHANGED`.
- Flight ids are a subset of `draft.flightIds` and are owned by the caller.
- For the `existing` target, `resolveTrip(userId, tripId)` must succeed.
- Roadtrip areas require `loadVisibleDomains` to include `roadtrip`. Otherwise **409** `ROADTRIPS_HIDDEN`.

**Phase P (in the job, no writes)** runs when `album.create` is set:
- The connection is re-resolved and must have `source==="user"`.
- `whoami().id === draft.immichUserId`.
- `GET /api-keys/me` must grant `album.read`, `album.create` and `albumAsset.create`.
- On failure, the job **succeeds** with `{status:"blocked", reason:"sharedConnection"|"connectionChanged"|"missingScopes"|"unreachable", missingScopes}`, and the draft returns to `ready`. The UI offers "Fix key" or "Save trip without album (add later)", which re-commits with `album.create=false`.

**Phase B.** One `prisma.$transaction(fn, {timeout: 30_000})`.
- A throw rolls everything back. Then `abortCommit` runs and the job fails with `COMMIT_FAILED`.
- On success, `finishCommit` runs **before** phases C and D. A later throw can therefore never return the draft to `ready`, so no duplicate trip can be created.

**Phases C and D** are each wrapped in try/catch and only add to the result.

**Idempotency.**
- There is one `commitKey` per review session (a `useRef` plus `sessionStorage`).
- The same key while committing returns the same `jobId`.
- After success, any key returns 409 `ALREADY_COMMITTED {tripId}`.
- A different key while committing returns 409 `COMMIT_IN_PROGRESS`.
- A lost commit job shows "outcome unknown, check your trips". Phase B is atomic, so the trip either exists completely or not at all.

**Album retry.** `POST /trip-builder/trips/:tripId/album` rebuilds the asset list from the trip's own dates with the same fetch-and-clean pipeline, so it survives restarts.
- Re-adding an asset returns `duplicate`.
- The album is found again by its exact owned name.
- The link row is upserted on `tripId_immichAlbumId`.

---

## B. Immich client, tester and settings

**`backend/src/services/immich/immichClient.ts`** (387 lines today, about 600 after). The header changes to say: "read-only except album create and add-to-album".

- **Constructor option:** `timeoutMs?` (default 15 s; preflight and capabilities use 4 s).

**Search uses the legacy flat body** `POST /search/metadata`, because the client is pinned to the 3.0.1 API and the structured shape only exists from v3.2.
- Body: `{takenAfter, takenBefore, withExif:true, order:"asc", page, size:1000}`.
- No `type` field, so both IMAGE and VIDEO come back.
- Trash and locked assets are excluded by default. Hidden and partner assets come back and are filtered by the client.
- The client dedupes by asset id, because offset pages shift if uploads happen mid-scan.
- Assets with no EXIF row are skipped by the inner join; this is documented.
- When Immich v4 drops the flat body, this file is the only one to change.

**`types.ts` additions** (all optional or new):
```ts
export interface ImmichAssetDetail extends ImmichAsset {
  localDateTime: string | null;      // naive wall clock, fake-Z stripped
  timeZone: string | null; fileModifiedAt: string | null;
  city: string | null; state: string | null; country: string | null;
  ownerId: string | null; visibility: "timeline"|"archive"|"hidden"|"locked"|null;
  livePhotoVideoId: string | null; duplicateId: string | null;
  make: string | null; model: string | null; isFavorite: boolean; originalFileName: string;
}
export interface ImmichAlbumWriteResult { added: number; duplicate: number; refused: Array<{id: string; error: string}> }
// ImmichError gains optional 4th arg detail?: { missingScope?: string }
```

**Methods:**
```ts
searchWindowAssets(range, onPage?): Promise<{assets: ImmichAssetDetail[]; truncated: boolean}>   // MAX_PAGES=50
searchByFileName(fragment: string, range): Promise<ImmichAssetDetail[]>  // flat originalFileName (ILIKE %x%), size 1000, one page
getMyApiKey(): Promise<{permissions: string[]} | null>                  // GET /api-keys/me; 403 → null
findOwnedAlbumByName(name, ownerId): Promise<ImmichAlbum | null>         // GET /albums?name=&isOwned=true; exact name AND albumUsers[0].user.id===ownerId
createAlbum({albumName, description}): Promise<ImmichAlbum>              // POST /albums, no assetIds
addAssetsToAlbum(albumId, ids): Promise<ImmichAlbumWriteResult>          // PUT /albums/:id/assets, chunks of 1000; "duplicate" = already in
getAlbum(albumId): Promise<ImmichAlbum>
```

A 403 whose body matches `/Missing required permission: (\S+)/` becomes `ImmichError("auth", …, 403, {missingScope})`.

**Capability check** goes in a new file, `services/immich/immichCapabilities.ts`. `testImmichConnection(baseUrl, apiKey)` and `immichTester.ts` stay **unchanged**.
```ts
export async function albumCapability(baseUrl: string, apiKey: string):
  Promise<{ canCreateAlbums: boolean | null; canView: boolean | null; missingScopes: string[] }>
// album needs album.read+album.create+albumAsset.create; inspect needs asset.read+user.read+asset.view. null = /api-keys/me unanswerable.
```

`routes/settings/immich.ts` (test route):
- `source = body.apiKey ? "user" : stored.source`.
- After `testImmichConnection` succeeds:
  - `source==="user"`: add `details.capabilities = await albumCapability(...)`, using the same normalised `baseUrl` (the AUD-087 binding is untouched);
  - otherwise: `{canCreateAlbums:false, sharedConnection:true}` with no Immich call, so a user is never handed the admin key's permissions.
- The admin route is unchanged.
- `immichSettingsRoutes.test.ts` mocks `immichCapabilities`, and any exact `res.body` assertions on `/test` are updated.
- The OpenAPI entry `POST /settings/immich/test` stays in the response-schema baseline (no 200 schema today), so nothing is added to `paths/settings.ts`.

**Frontend card** (`ImmichConnectionCard.tsx`):
- The capability line is rendered in a **sibling** element under the status `<p>`, so the exact `getByText("connected")` test still passes. Its states:
  - "Can create trip albums ✓"
  - "Albums need: album.create, albumAsset.create"
  - "Albums only with your own key"
  - "Couldn't verify permissions"
- `types/immich.ts` `ImmichTestResult` gains `capabilities?`.

**Settings copy** (`immich.json`, en and de):
- `apiKeyScopes` keeps naming only the read scopes. The existing negative test (`not.toContain("album.create")`) stays as it is.
- New key `apiKeyScopesAlbums`: "For trip albums also grant album.read, album.create, albumAsset.create." A new test checks it contains all three.
- New `capability.*` keys.
- New `urlHintContainer`: "Inside Docker use the container address, e.g. http://immich_server:2283; localhost won't work."

---

## C. Itinerary algorithm (`backend/src/services/tripBuilder/`, pure unless marked)

### C.0 `thresholds.ts`

The first group is the owner's accepted recipe, kept as is. The rest are design parameters.

```
CITY_LINK_KM=30 SEGMENT_CONTINUE_GAP_H=30 EXCURSION_MAX_H=8 VISIT_MIN_H=6
MISDATED_COUNTER_WINDOW=25 MISDATED_COUNTER_DAYS=3 MISDATED_MIN_NEIGHBOURS=5 MISDATED_FILENAME_H=36 MISDATED_LOOKUPS=6
BRIEF_MIN_PHOTOS=3 BRIEF_MIN_MINUTES=30 CLUSTER_OVERSIZE_KM=60
WINDOW_PAD_BEFORE_H=14 WINDOW_PAD_AFTER_H=12 CONTEXT_PAD_DAYS=3 MAX_WINDOW_DAYS=62 NIGHT_BOUNDARY_H=4
ARRIVAL_TOLERANCE_MIN=30 ARRIVAL_TOLERANCE_KM=15 DEPARTURE_GRACE_MIN=45 DEPARTURE_GRACE_KM=15 DELAY_CORRIDOR_H=3
CORRIDOR_KM=50 AIRPORT_NEAR_KM=50 STATIONARY_GROUP=(3 photos, 2 km, 20 min) LAYOVER_MAX_H=12 AIRPORT_ANCHOR_KM=30
HOME_RADIUS_KM=30 HOME_LEG_MAX_KM=900 NIGHT_DRIVE_MIN_KM=150 NIGHT_DRIVE_LAST_AFTER="18:00" NIGHT_DRIVE_FIRST_BEFORE="09:00"
IMPLICIT_FLIGHT_MIN_KM=400 IMPLICIT_FLIGHT_MIN_KMH=200 AT_SEA_BUFFER_KM=3 FERRY_PROBE_SHARE=0.5 FERRY_MIN_SEA_PHOTOS=2
FERRY_CHIP_MIN_CHORD_KM=20 FERRY_CHIP_WATER_FRACTION=0.5 FERRY_CHIP_WATER_RUN_KM=30
SNAP_MIN_KM=0.9 SNAP_MAX_KM=10 TITLE_REUSE_KM=5 MAX_GEOCODE_LOOKUPS=20 PREVIEWS_PER_STATION=6 MAX_PREVIEWS=400
```

**Reused helpers:**
- `toLocal`, `toInstant`, `localDay` (`shared/time/instant.ts`)
- `zoneOfCoordinates` (`shared/time/resolveInput.ts:184`)
- `isValidZone` (`shared/time/zonedParts.ts`)
- `distanceKm` (`photoJourneys/cluster.ts:276`)
- `buildTzMap` (`stats/departureClock.ts:59`)
- `flightEndZone`
- `findNearestAirport`, `getCachedAirports`, `airportDisplayName` (`utils/airportDisplay.ts:96`)
- `reverseGeocode` (`geo/nominatim.ts:391`)
- `getCountryResolver` (`geo/countryFromCoordinates.ts:150`)
- `loadHomePeriods`, `periodAt`, `isHomeAirportAt` (`utils/homeAirport.ts`)
- `describeRoutingAvailability`

### C.1 `clock.ts`: one clock model

Immich's `localDateTime` is only trustworthy as a wall clock when the zone is right (verified in `immich/server/src/services/metadata.service.ts:1020-1061`, and the exiftool setup at `repositories/metadata.repository.ts:89-99`). Each asset therefore gets a **real instant** `t(p)` and a **zone** `z(p)`:

| Case | Condition | `t(p)` |
|---|---|---|
| A | `timeZone` is not null | `fileCreatedAt` is a real instant. This includes videos treated as UTC. |
| B | `timeZone` is null and the asset looks like a file-time fallback (`!make && !model`, or `fileCreatedAt === fileModifiedAt`) | `fileCreatedAt` is a real instant (from file mtime). |
| C | `timeZone` is null otherwise | `localDateTime` is the naive camera wall clock. `t = toInstant(wall, z(p))`. |

**Zone `z(p)`**, first match wins:
1. located: `zoneOfCoordinates(lat, lon)`;
2. an IANA or `UTC±N` `timeZone` other than `UTC`/`UTC+0`;
3. the zone of the nearest located photo within ±12 h;
4. the area's dominant zone;
5. the home zone;
6. `UTC`, marked `dayGuessed`.

**Local clock.** `local(p)` is `localDateTime` for case C when unlocated, and `toLocal(t(p), z(p))` otherwise. It also produces the note's HH:MM.

- For a phone with automatic time zone, this equals `localDateTime`; the recipe's "clock = localDateTime" still holds.
- It fixes airplane-mode offsets kept after landing, and UTC-stamped videos.
- `day(p)` is the calendar day of `local(p)`.
- `nightDay(p)` is the day of `local(p) − 4 h`. Photos from 00:00 to 03:59 count as the previous evening; this handles a night drive that ends at 02:53.

**All durations, ordering and in-flight tests use `t(p)`.** That keeps them correct across the EDT→NDT offset and DST changes.

**Window** (`window.ts`):
- The fetch range runs from `S 00:00Z − 3 days − 14 h` to `(E+1) 00:00Z + 3 days + 12 h`.
- `inWindow ⇔ S ≤ day(p) ≤ E`.
- This fixes decision 10: an evening photo at E 21:30 EST is fetched and kept, and so is a no-EXIF screenshot at E 21:30 EDT (case B, zone borrowed).

### C.2 `clean.ts`

`cleanAssets(assets, {ownerId, window})` returns `{photos, albumAssetIds, excluded}`.

**Order of exclusion:**
1. `ownerId !== me`: partner;
2. `visibility==="hidden"`: live-photo motion half;
3. outside the window by `day(p)`.

**Album list.** `albumAssetIds` is every remaining IMAGE and VIDEO, including those with no GPS, archived ones, duplicates, misdated ones, in-flight ones and at-sea ones (decision 8).

**GPS.** GPS is missing when it is null or `|lat|,|lon| < 1e-6`. For movement only, keep one photo per `duplicateId`.

**`flagMisdated(photos, lookup)`** (`lookup` is impure and injected) returns ids excluded from movement only. It applies three checks:

1. **Straggler check (recipe).** For iPhone counters `^IMG_E?(\d{4})`, grouped by make and model: with at least 5 neighbours within ±25 counter positions in the context range, flag a photo whose time is more than 3 days from the neighbours' median. Counter wrap is allowed only across the 9999→0000 boundary, and only when the photos are within 30 days of each other.
2. **Batch check (new).** Group counters into runs (consecutive gaps of 25 or less). For each run, find its counter predecessor and successor, first in the context, else via `searchByFileName("IMG_" + prefix2)` (at most 6 lookups per scan). Flag the whole run when both exist, are within 3 days of each other, and the run's median time is more than 3 days outside `[pred, succ]`. This catches a large batch whose counter neighbours sit weeks earlier.
3. **Filename clock.** `^(\d{8})_(\d{6})` (Samsung, local) is compared with `local(p)`. `^PXL_(\d{8})_(\d{6})` (UTC) is compared with `t(p)`. Flag when they differ by more than 36 h.

**`flagAtSea(photos, countryAt)`.** A photo is at sea when `countryAt` is null at the point **and** at 8 ring points 3 km out. The buffer is needed because coastal cities can resolve to sea in the 1:10m data. At-sea photos:
- are excluded from clusters;
- stay in the album;
- serve as ferry evidence and night evidence.

### C.3 `loadFlights.ts` (impure)

- Query: `{userId, status:{not:"cancelled"}, departureTime ∈ [S−2 days, E+2 days]}`, with `trip {id, name}`.
- Days and HH:MM come from `toLocal(instant, flightEndZone(...))`. `LEGACY_FAKE_UTC` rows read their stored components.
- Output `FlightAnchor`:
  ```ts
  {id, label, depIata, arrIata, dep, arr, depDay, arrDay, depClock, arrClock, precise, depMs?, arrMs?, hasActualDep, hasActualArr, tripId, tripName}
  ```
- **`precise`** requires dep and arr `TimeSemantics === "UTC"`, `precision !== "day"`, and both times present. This is stricter than the `tripPhotoWindows.ts:183-211` guard, which checks semantics only. `depMs` is `actualDeparture ?? departureTime`, and `arrMs` likewise.
- **Listed** (tickable): `depDay ≤ E && arrDay ≥ S && depDay ≥ S−1`.
  - Default tick is ON when `tripId === null` or the flight is already in the target trip. Already-filed flights are shown ticked and locked.
  - Otherwise it is OFF with "currently in <tripName>". Moving a flight out of that trip warns that the trip's status will be recomputed.
- **Anchors:** every non-cancelled flight loaded (decision 5).

### C.4 `flightAnchors.ts`

**`classifyInFlight(p, anchors)`, precise flights:**
- A photo with `depMs < t < arrMs` is in flight, with two exceptions:
  - **arrival tolerance:** `t ≥ arrMs − 30 min` and within 15 km of the arrival airport means ground, side `after`;
  - **departure grace** (when `!hasActualDep`): `t ≤ depMs + 45 min` and within 15 km of the departure airport means ground, side `before`.
- **Delays** (when `!hasActualArr`): a photo in `(arrMs, arrMs + 3 h]` that is more than 50 km from both airports, on the corridor, is in flight.

**Imprecise flights** (decision 7: day-level fallback, documented). On days `depDay..arrDay`, a photo is in flight when **all** of these hold:
- it is more than 50 km from both airports;
- cross-track distance is 50 km or less, and along-track it lies between the airports;
- `t` is after the last photo within 50 km of the departure airport and before the first within 50 km of the arrival airport (a missing reference leaves that bound open);
- it is **not** part of a stationary group (3 or more photos within 2 km over 20 minutes or more; a plane cannot do that).

In-flight photos count toward `excluded.inFlight` and stay in the album.

**`splitIntoAreas(ground, anchors)`.** Every ground photo gets a side:
- Precise flights cut at `max(depMs, last grace photo)` and `min(arrMs, first tolerance photo)`. Grace photos go before, tolerance photos after. A road leg never crosses a flight.
- Imprecise flights:
  - photos before `depDay` go before, after `arrDay` go after;
  - on boundary days the time-order references decide;
  - a photo with no reference goes to the side of the nearer airport.

**Layover** (not an area; the photo count is shown under the flight):
- precise: the ground interval is under 12 h and all photos are within 30 km of the shared airport;
- imprecise: `arrDay(f1) == depDay(f2)`, the same airport, and all photos between are within 30 km of it.
- Layover photos are never stations and never night evidence.

**Implicit flights.** `splitImplicitFlights(area)`: consecutive segments 400 km or more apart at 200 km/h or faster split the area and raise the warning `possibleUnrecordedFlight {fromDay, toDay, nearestAirports}`.

**Post-return drop.** An area that starts with a landing at a home airport (`isHomeAirportAt`) and has no night away from home is dropped. Its photos stay in the album.

### C.5 `cityClusters.ts` / `nameClusters.ts`

**Clustering.**
- Single linkage at 30 km, using union-find on a 0.27° grid.
- The longitude neighbourhood is `⌈30 km / cellWidthKm(lat)⌉` cells, and is not limited to 3×3.
- Haversine check on each candidate pair.

**Splitting oversized clusters.** A cluster with spread over 60 km is split by Immich `city|state`. Groups under 3 photos join the nearest group, and groups whose medians are within 30 km re-merge.

**Titles**, first match wins:
1. an existing station title of the user's within 5 km (one bbox query on roadtrip `TripStop`s), which keeps titles like "City, Province" consistent;
2. the majority Immich `city`;
3. `reverseGeocode(median)` (at most 20 lookups);
4. coordinates to 2 decimals, `titleSource:"coords"`, flagged for rename.

Two clusters with the same title more than 30 km apart get `"city, state"`.

**Home cluster:** the median is within 30 km of `periodAt(day).residence`.

### C.6 `segments.ts`

- Walk the located ground photos (not misdated, not at sea, not layover) by `t`. The same cluster with a gap of 30 h or less continues the segment; anything else starts a new one.
- **There is no merging of adjacent same-cluster segments.** A gap over 30 h at one place produces two segments, and the gap nights become unknown (decision 11).
- **Excursion.** A segment shorter than 8 h, between two segments of the same cluster A, that does **not** hold the last photo of any `nightDay`, is marked `excursionOf: A`.
  - It is emitted as a pass station B, followed by A′, a continuation of A. This keeps the cities and km of the accepted hand-built reference result.
  - Review offers "Fold day trip into A" and shows the km saved.
- **Transit noise.** A segment that is not first or last in its area, with fewer than 3 photos, lasting under 30 minutes, becomes a "passed through" chip.
- **Visit or brief.** A segment of 6 h or more is a visit; anything else is brief. Both become stations.

### C.7 `ferry.ts` / `probe.ts`

**Primary signal.** Add `probe?(a, b): Promise<{distanceKm, ferryKm} | null>` and `snap?(c): Promise<Coord | null>` to `RouteProvider` (`services/tour/routing/types.ts`). Only `customOsrm.ts` implements them:
- `GET /route/v1/car/{a};{b}?overview=false&steps=true`, summing steps with `mode==="ferry"`;
- `GET /nearest/v1/car/{lon},{lat}?number=1`.

They run only when the provider is the custom OSRM (local, with no rate limit), at concurrency 4.

**A leg defaults to `ferry` when:**
- `ferryKm ≥ 0.5 × distanceKm`, **or**
- 2 or more at-sea photos have a `t` between the two stations.

**Otherwise it defaults to `road`.** The land-polygon chord test (20 km, water fraction 0.5 or a water run of 30 km) only raises the chip "looks like a water crossing". It is never a default, because it over-flags bays and bridges.

**Routed km.** The probe's `distanceKm` is shown as routed km in the preview. No route, or a snap beyond 10 km, raises the warning `noRoadData {stations}`.

### C.8 `nights.ts`

`attributeNights(S, E, stations, ground, atSea, anchors, home)`. For each night N in [S, E−1], the first rule that matches wins:

1. **flight:** an anchor is airborne across local midnight N→N+1 (by `t` for precise flights, `depDay ≤ N < arrDay` otherwise).
2. **afterLanding:** take the latest arrival L with arrival `nightDay = N`, and the last ground photo P with `nightDay(P) = N`. If L lands after P, or P is missing, the night goes to:
   - home, if the arrival airport is within 30 km of the residence;
   - otherwise the first station of the area that starts after L (its `firstDay` is pulled to N);
   - otherwise unknown.

   This covers both an evening flight out of home on S and a flight home on E−1.
3. **unknown**, when P is missing. `suggestedStationKeys` lists the same station on both sides, else the neighbours of the gap. **The default stays unknown** (decision 11).
4. **ferry:** P is at sea, or the next first photo Q is reached across a ferry leg. The night goes to the **boarding** station, matching the accepted hand-built reference result.
5. **home:** P is in the home cluster.
6. **nightDrive:** all of these hold, and the night goes to Q's station:
   - Q is the first ground photo with `nightDay = N+1` and is at a different station;
   - Q is 150 km or more from P;
   - `local(P)` is 18:00 or later, where 00:00–03:59 counts as 24:00–27:59;
   - `local(Q)` is before 09:00;
   - no flight anchor falls between them.
7. **lastPhoto:** P's station.

Day E is `lastDay`. **How P maps to a station:**
- a kept station: that station;
- dropped transit noise: the next kept station in the area, else the previous one;
- a home-only area: home.

An excursion can never hold P.

### C.9 `stations.ts`, `airportAnchors.ts`, `home.ts`

**Stations.**
- Coordinates are the per-axis median of the segment's photos, snapped when the snap distance is between 0.9 and 10 km.
- Each station carries:
  - `firstLocal`/`lastLocal` (`"YYYY-MM-DD HH:MM"` from `local(p)`);
  - `photoCount`;
  - `previewIdx` (up to 6, favourites first, spread evenly);
  - `kind: "visit"|"brief"|"dayTrip"|"home"|"airport"`;
  - stable `key = round(lat/0.05)|round(lon/0.05)|firstDay`.

**Airport anchors.** When an area's first or last station is more than 30 km from its inbound or outbound airport, add a pass station titled `airportDisplayName(airport)`, never a bare IATA code. In a `stops` area, airport and home stations are dropped.

**Home legs** (decision 6). They apply to an area end that has no flight at that end and a `periodAt(day)` home.
- **`defaultOn`** when the home cluster appears in the area, or when the area's first or last located photo is within 900 km of the residence and passes the implicit-flight speed check from home. Otherwise the toggle is offered but OFF, with `possibleUnrecordedFlight`.
- **Title:** the home cluster's Immich city, else the first comma-part of `residence.name`.
- **Unconfirmed residence** (migrated, at the airport): the same rules apply, plus the chip "home location not confirmed — confirm in Settings". It is titled `airportDisplayName` when no home cluster exists.
- **Placement:** if the first or last cluster is the home cluster, it is relabelled `kind:"home"`. Otherwise a Home pass station is added, dated S or E.

### C.10 Night plan (the single source of truth)

New mirrored pair, following the existing "change both together" convention:
- `backend/src/shared/tour/builderNightPlan.ts`
- `frontend/src/shared/tour/builderNightPlan.ts`

```ts
type NightAssign = string /*stationKey*/ | "home" | "unknown" | "flight";
deriveStationRows(stations: PlanStation[], nights: Record<string /*day*/, NightAssign>):
  Array<{ key; title; lat; lon; startDate; endDate; slept: boolean; notes? }>
  // slept station: one row per CONTIGUOUS run of its nights → startDate=min, endDate=max+1 (=daySpan nights,
  // matching countRoadtripNights); non-contiguous → split rows (same coords; a 0 km leg is fine).
  // pass station: startDate=firstDay, endDate=lastDay. Rows ordered by (startDate, station order).
validateNightPlan(stations, nights, areas): string[]   // errors: night outside the station's area span,
  // overlapping slept rows, slept row outside [S,E], station assigned a night not adjacent to its photos
```

The client derives what it displays from this; the server re-derives at commit. They cannot diverge.

**What the reducer may do:**
- assign a night only to the stations next to the gap in the same area, plus home;
- delete a slept station, which turns its nights unknown, with a visible chip;
- merge across an unknown night only through an explicit "assign".

### C.11 Areas, names, countries

**Area kind:**
- one distinct city, excluding home and airport stations, with home legs off: `stops` (one TripStop over the area's first to last ground day);
- otherwise `roadtrip` if roadtrips are visible;
- otherwise `stops`.

**Names** (decision 4, counted over areas that become roadtrips):
- exactly one: exactly the trip name;
- several: `"<Trip> · <mainCity>"`, where the main city has the most nights, then the most photos;
- duplicate names get `" (<d MMM>)"`.

For the `existing` target, if a roadtrip with the trip's name already exists, the new one uses the `·` form.

**Countries.** Union of `countryAt(station)` for non-home stations plus the arrival-airport countries of ticked flights. They are pre-filled and editable, and unioned with the trip's existing countries for `existing`.

**`originLabel`/`destinationLabel`:** home city (or the first city) → main city.

### C.12 `buildDraft.ts` (orchestrator)

`buildTripDraft(userId, input, report): Promise<StoredDraft>` reports 7 steps: fetch, clean, flights, movement, names, roads, nights.

**Warnings:**
- `truncated`
- `possibleUnrecordedFlight`
- `noRouting`, `cannotSnap`, `noRoadData`
- `roadtripsHidden`
- `overlappingTrip {name, startDay, endDay, suspiciouslyLong}` (excludes the target trip)
- `flightOutsideDates {flightId, suggestStartDay|suggestEndDay}` (on by default for a ticked S−1 red-eye)
- `movementOutsideDates {day, km}`: context photos more than 30 km from home that join the first or last area
- `pendingPhotoJourneys {ids}`
- `albumLinkedElsewhere {tripName}`
- `homeUnconfirmed`
- `emptyWindow {checkedFrom, checkedTo, partner, trashedNote}`
- `noLocatedPhotos`

---

## D. Write path (`services/tripBuilder/commit.ts`, `albumWrite.ts`)

**D1.** `services/trip/createTrip.ts`:
- `prepareTripCreate(userId, body)`: colour, `resolveCompanions`, `statusFromOwnDates`, `provenanceForWrite`.
- `insertTrip(tx, prepared)`.
- `createTripRecord(userId, body)`.

`POST /trips` uses it.

Companion rows may be created before the transaction and survive a rollback. This is documented as harmless: they are find-or-create and get reused.

**D1b.** In the `PATCH /trips/:id` rename block (`routes/trips.ts:593-603`), also rename routes whose name starts with `"<old> · "` to `"<new> · "`, via `findMany` plus `update` per row (about 8 lines).

**D2.** `services/roadtrip/createRoadtrip.ts` `insertRoadtrip(tx, userId, {tripId, name, mode, vehicle})` with `orderIdx = last + 1`. `POST /roadtrips` wraps it in its own `$transaction`.

**D3.** Split `replaceStations` without changing its public contract:
```ts
export interface ReplaceStationsOptions { legModes?: ReadonlyArray<LegMode | undefined> }
export async function replaceStationsInTx(tx, userId, routeId, stations, opts?): Promise<{ createdLegs: LegPair[] }>
// after recomputeLegs(): tx.tripRouteLeg.updateMany({where:{routeId, fromStopId, toStopId}, data:{mode}}) for non-default modes
```
`routeLegs` re-reads the stored mode and skips ferry legs (`autoRouteLegs.ts:56-59,96-100`).

**Phase B, in one transaction:**
1. **Trip.** For `new`: `insertTrip`, with form fields plus the window plus `countries` and labels. For `existing`: `tx.trip.update` with the window dates (when `applyWindow`) and the union of countries.
2. **Flights.** Read `{id, tripId}` where `userId` matches, then `updateMany({where:{id in ids, userId}, data:{tripId}})`. Remember the previous trips.
3. **`stops` areas:** `tx.tripStop.create({tripId, title, lat, lon, startDate, endDate, ...stationTimeColumns(...), notes, orderIdx, domain:null})`.
4. **`roadtrip` areas:**
   - `insertRoadtrip`;
   - rows from `deriveStationRows` (already validated in sync);
   - `night: slept ? {kind:"free"} : {kind:"pass"}`;
   - `notes` defaults to "First photo HH:MM · last HH:MM · N photos";
   - `replaceStationsInTx(..., {legModes})`.

**After B:** `finishCommit(draftId, partialResult)`.

**Phase C** (try/catch):
- `autoRouteNewLegs` in chunks of 25 within a 120 s budget;
- `recomputeTripStatus` for the target and for each previous trip;
- **ticked** photo-journey findings → `accepted`, `createdTripId`, `resolvedAt`. Overlap means the finding's range lies within [S−1, E+1].

**Phase D** (try/catch), skipped when the album has 0 assets:
1. `findOwnedAlbumByName`, else `createAlbum({albumName, description:"TravStats trip · S – E"})`;
2. `addAssetsToAlbum`;
3. `getAlbum`;
4. `tripImmichAlbum.upsert(tripId_immichAlbumId, {mode:"link", sortIdx: next, ...})`;
5. `invalidateAlbumAssets`.

The base URL is the stored one (`http://immich_server:2283`). Nothing reads or emits Immich's `externalDomain`.

**Ownership:**
- the draft by owner;
- flights `where userId`;
- `resolveTrip` for `existing` and for the album retry;
- stays and places by `replaceStationsInTx` (none are sent).

**Result:**
```ts
{ tripId, created: boolean, roadtrips:[{id,name,stations,nights}], stopIds, flightsAssigned, flightsMovedFrom:[{tripId,name}],
  routing:{routed,straight,ferry,providerAvailable}, photoJourneysResolved, unknownNights,
  album:{status:"linked"|"skipped"|"failed"|"blocked", immichAlbumId?, albumName?, reused?, added?, alreadyIn?, refused?,
         error?:{kind, missingScope?}, missingScopes?} }
```

---

## E. Roadtrip stations on the trip timeline

**Backend.** `services/trips/tripRoadtripStations.ts`:
```ts
export async function roadtripStationsForTrip(userId, tripId): Promise<TripRoadtripStationDto[]>
// [] unless loadVisibleDomains(userId) includes "roadtrip"
// tripStop.findMany({where:{tripId:null, viaPoint:false, route:{tripId, userId, kind:"roadtrip"}}, orderBy route.orderIdx, routeOrderIdx})
// → withTripStopTimes(row) + {state, routeId, routeName, nights}
```
- `tripId:null` leaves out adopted stops, which already appear in `trip.stops`.
- `GET /trips/:id` adds `roadtripStations` (+3 lines).
- The OpenAPI `tripResponse` gains `roadtripStations` (optional). The rows carry `times`.

**Frontend.**
- `types/tripRoadtripStation.ts`.
- `lib/tripTimelineEvents.ts`: new kind `"roadtrip-station"`, de-duplicated against `trip.stops`.
- `timelineTransit.tsx` renders the new `components/Trips/RoadtripStationTimelineCard.tsx`:
  - built on the exported `components/Trip/ExpandableEventCard.tsx`, not the page-local `EventCard`;
  - read-only: title, `routeName · N nights`, dates;
  - links to `/roadtrips/:routeId`;
  - colour `var(--domain-roadtrip)`.
- Move `dotColor` out of `TripDetailPage.tsx:619-640` into `components/Trips/timelineDotColor.ts` (about −21 lines) and add the new case there.

---

## F. API surface (`backend/src/routes/tripBuilder.ts`, bare family)

**Wiring:**
- `router.use(authenticate)`, `router.use(requireWriteScope)`, `rejectDemo` on writes.
- Mounted in `routes/mounts.ts` as `{id:"tripBuilder", base:"/api/v1/trip-builder"}`.
- Added to `apiResponseShape.baseline.json` under `bare`.
- Schemas in `schemas/tripBuilder.ts`; OpenAPI in `services/openapi/paths/tripBuilder.ts`.
- Day and local-time fields are documented as **pattern strings**, not `format: date`, to satisfy the time-shape ratchet.
- JobKind (`jobRegistry.ts:25`) and `paths/jobs.ts:17-26` gain `tripBuilder.scan|commit|album`.

| Method and path | Limiter | Request | Response |
|---|---|---|---|
| `GET /capabilities` | proxy | – | `{immich:{configured, source, inspect:{ok, missingScopes}, album:{canCreate: bool\|null, reason}}, roadtrips, routing:{available, canProbe}, home}`. Not cached; Immich calls use 4 s timeouts. |
| `POST /scan` | import | `{name, startDay, endDay, inspect, createAlbum, target:{kind:"new"}\|{kind:"existing", tripId}}`. Strict, at most 62 days, at least one toggle. | 202 `{jobId}`. 409 `notConfigured`. 404 for a foreign trip. Job result `{draftId}`. |
| `GET /drafts/:id` | – | – | `TripBuilderDraft` or 404 |
| `DELETE /drafts/:id` | – | – | 204 |
| `GET /drafts/:id/preview/:index/file` | proxy | `?size=thumbnail\|preview` | image or placeholder |
| `POST /drafts/:id/commit` | import | `CommitBody` | 202 `{jobId}`. 400 `NIGHT_PLAN_INVALID` / `STATIONS_INVALID`. 409 `WINDOW_CHANGED` / `ALREADY_COMMITTED {tripId}` / `COMMIT_IN_PROGRESS` / `ROADTRIPS_HIDDEN`. 404 `DRAFT_EXPIRED`. |
| `POST /trips/:tripId/album` | import | `{name?}` | 202 `{jobId}`. Job result is the album outcome. |

```ts
CommitBody = { commitKey: uuid,
  target: {kind:"new", trip: CreateTripInput} | {kind:"existing", tripId: uuid, applyWindow: boolean, countries?: string[]},
  flightIds: uuid[] (≤100),
  nights: Record<YYYY-MM-DD, NightAssign>,
  areas: Array<{ key, as:"roadtrip"|"stops"|"skip", name(1..200), vehicle="car",
    homeStart: boolean, homeEnd: boolean,
    stations: Array<{ key, title(1..200), lat, lon, kind, firstDay, lastDay, notes?≤5000 }> (≤300; roadtrip ≥2 after derivation),
    legModes: ("road"|"ferry")[] }> (≤20),
  photoJourneyIds: uuid[], album: { create: boolean, name(1..200) } }

TripBuilderDraft = { id, expiresAt, window, options, target, tripName, countries[], originLabel, destinationLabel,
  stats:{assets, images, videos, located, excluded:{partner, hiddenLivePart, misdated, inFlight, atSea, unlocated, dayGuessed}, truncated},
  flights:[{id, label, depIata, arrIata, depLocal, arrLocal, precise, currentTrip, defaultAssign, locked, layover?}],
  days:[{day, photos, located, stationKeys[], flightIds[], passedThrough[]}],
  nights: Record<day, {assign: NightAssign, reason, suggestedStationKeys[]}>,
  areas:[{key, defaultAs, suggestedName, mainCity, startDay, endDay, afterFlightId?, beforeFlightId?,
          home:{start:{offered, defaultOn, station?}, end:{…}, unconfirmed},
          stations:[{key, title, titleSource, kind, excursionOf?, lat, lon, snappedKm, firstDay, lastDay, firstLocal, lastLocal, photoCount, previewIdx[]}],
          legs:[{fromKey, toKey, chordKm, routedKm|null, mode, ferryEvidence:"router"|"seaPhotos"|"chip"|null}]}],
  photoJourneys:[{id, startDay, endDay, defaultTick:true}],
  album:{name, existing:{immichAlbumId, assetCount, linkedTripName?}|null, assetCount, images, videos, allowed, blockedReason?, missingScopes[]}|null,
  warnings:[{code, params}] }
```

---

## G. Frontend

**API client and types.**
- `lib/api/tripBuilder.ts`: `capabilities`, `scan`, `getDraft`, `discardDraft`, `commit`, `retryAlbum`, and `previewUrl(draftId, index, size)`. URLs never contain an asset id.
- DTO types live in `types/tripBuilder.ts`.

**Popup (create mode).** `components/Trips/tripBuilder/TripImmichOptions.tsx` sits after the dates, showing the "Inspect Immich" and "Create album in Immich" switches, **visible and off**.
- The first flip calls `capabilities()` once. Existing TripModal, DomainImportPanel and tripManualEntry tests never flip, so they stay network-free.
- Not configured: the switch reverts, and `EmptyState kind="unpaired"` shows with a link opening `/settings/services?section=externalServices` in a **new tab**, so the form is kept.
- Album blocked (shared connection or missing scopes): disabled with the reason.
- `canCreate:null`: enabled, with "couldn't verify permissions".
- Roadtrips hidden: a note "Roadtrips are off, so no km/nights — turn on in Settings › Beta".
- When a toggle is on, the Save label becomes "Scan photos" and the cover picker is hidden. The note reads "add a cover after saving", because a buffered file can't go into sessionStorage.
- The flag `immichOpts.active` makes `handleSave` render `<TripBuilderLauncher/>` instead of calling `tripsApi.create`. `useNavigate` lives **only** in the launcher, so the Router-less TripModal tests are unaffected. The launcher navigates first, then calls `onClose()`.

**Edit mode** (the `existing` target): a "Build from Immich photos…" button. It is disabled while the form has unsaved edits ("save first"), and it launches with the trip's saved dates.

**Chooser.** `components/import/adapters/tripAdapter.tsx` gains a `from-photos` route, always shown with no fetch, which opens TripModal with "Inspect" pre-on. Adapter tests that count routes are updated.

**Review page: `pages/TripBuilderPage.tsx`.**
- Lazy route `/trips/builder` in `App.tsx`. The static segment outranks `/trips/:id` under react-router 7.
- **State.** `?job=` drives progress, which reads "Step n of 7 · <phase>". A lost scan reads "Scan interrupted — nothing was saved. Scan again". A 429 shows the retry time.
- **Persistence.** `?draft=` loads the draft. Reducer state is persisted to `sessionStorage["tb:draft:<id>"]`. `beforeunload` guards unsaved edits.
- **Header.** Editable name, dates with "Change dates…" (re-scans and re-applies edits by stable key: "kept N of M edits"), editable country chips, "← Back" (confirm if there are edits; returns to `returnTo`), and "Create trip" (for `existing`: "Add to trip").
- **Body, wide layout:**
  - **Left:** one list grouped by area, then by day (`ReviewDayGroup.tsx`).
    - Station cards (`ReviewStationRow.tsx`) are collapsed by default and hold: rename, slept switch, merge with next, delete, lazy thumbnails, editable note, "moved N km onto the road", and "Fold day trip" for excursions.
    - Night chips sit between days. An unknown night has a `Select` offering only the adjacent stations or home, with the suggestion marked.
    - Leg rows (`ReviewLegRow.tsx`) show chord or routed km, a road/ferry `Segmented`, and the evidence chip.
    - Each area header (`ReviewAreaSection.tsx`) holds the name, kind (roadtrip / timeline stop / don't save), vehicle and home switches.
  - **Right (sticky):** `ReviewMapPreview.tsx`, a lazy `TripMap` on the app basemap with straight legs.
  - **Also shown:**
    - `ReviewFlightRows.tsx`, with a "currently in X" pill, unticked;
    - `ReviewAlbumSection.tsx`: create or "adds to existing X (n)", "linked to <trip>" warning, counts;
    - `ReviewPhotoJourneys.tsx`, ticked by default;
    - `ReviewExcluded.tsx`;
    - `ReviewWarnings.tsx`, with "extend start/end" chips that re-scan.
- **Toggle combinations:**
  - album only: Flights and Album sections plus a confirm step, no movement;
  - inspect only: no Album section.
- **Empty states:**
  - **0 assets:** "No photos from S–E in your Immich library (checked S−3…E+3)", with counts of excluded partner assets and the actions [Change dates] [Create trip with the N flights only] [Cancel].
  - **0 located:** no movement section; the album still proceeds.
- **Outcomes:**
  - **blocked:** [Fix key ↗] [Save without album].
  - **success:** summary panel ("N stations · N nights · N legs straight · N unknown nights · album N added (M already in)"), with Retry album when it failed, and Open trip.

**Edits reducer.** `lib/tripBuilder/draftEdits.ts` (pure) handles:
- rename, merge, delete, toggleSlept, foldDayTrip, setLegMode, assignNight, toggleHome, setAreaKind, setAreaName, setFlightTick, setAlbum, setCountries, togglePhotoJourney;
- `reapplyEdits(newDraft, edits)` by stable keys;
- `buildCommitBody`.

Leg modes re-index on merge and delete. Names are recomputed from the number of roadtrip areas unless the user edited them.

**i18n.**
- New namespace `tripBuilder` in `i18n/resources/{en,de}/tripBuilder.json`, registered in the 3 places in `i18n/config.ts`. German uses informal "du".
- `immich.json` keys as in section B.
- `RoadtripDetailPage`'s `?station=` is not used.

---

## H. Testing (all fixtures synthetic: invented places, flight numbers `ZZ101…`, shifted years)

**Pure Jest** (`services/tripBuilder/__tests__/`):

`clock.test`
- cases A, B and C;
- airplane-mode offset after landing → GPS-zone day;
- a UTC video;
- a no-EXIF screenshot at E 21:30 (UTC−4) kept, and one at S−1 21:00 dropped;
- a photo at E 21:30 EST kept (decision 10);
- Kiritimati and Pago Pago.

`clean.test`
- partner, hidden, 0,0 GPS;
- straggler;
- a **48-photo batch** whose counter neighbours lie 3 weeks earlier (lookup mocked);
- wrap only at the boundary;
- filename clocks;
- the at-sea buffer at a coastal city.

`flightAnchors.test`
- precise exclusion;
- an early arrival 8 minutes before, 5 km from the airport → ground, in the **later** area;
- the same time 40 km out on approach → in flight;
- departure grace → earlier area;
- the delay corridor;
- DATE_ONLY corridor with time order and the stationary-group guard (a highway town at 34 km on the flight day stays ground);
- a precise layover and a DATE_ONLY layover;
- red-eye on S−1.

`nights.test`
- afterLanding home on E−1;
- evening departure from home on S;
- two areas linked by an evening flight;
- a 02:53 night drive with the 04:00 boundary;
- overnight ferry → boarding station, with and without deck photos;
- unknown night;
- the transit-noise mapping.

`builderNightPlan.test` (backend and frontend mirrors)
- contiguous runs and splits;
- `daySpan === countRoadtripNights`;
- every `validateNightPlan` error.

The rest:
- `segments.test`: excursion → B pass + A′; no fold when B holds an evening; the 30 h gap is not merged.
- `cityClusters.test`: grid neighbourhood at 47°N; the 60 km split; title reuse within 5 km.
- `ferry.test`: probe ferry share; sea photos; a bay/bridge gets the chip only.
- `home.test`: unconfirmed residence; the 900 km rule.
- `draftStore.test`: eviction never removes committing drafts; `beginCommit` transitions.

**Scenarios.**
- `buildDraft.strait.test`: a 14-night ferry roadtrip with a day ferry, an overnight ferry, a misdated batch, an excursion, a night drive, one no-photo night and home legs. Expected night-by-night table.
- `buildDraft.redEyeSingleCity.test`: a precise red-eye, early arrival, a single-city `stops` area, a DATE_ONLY connection with a layover, and an evening flight home (8 nights, last night = home).
- `buildDraft.multiArea.test`: names, duplicate-city suffix, and `existing` target naming.

**Integration** (test DB, Immich mocked):

`commit.test`
- all-or-nothing on a throw in `replaceStationsInTx`;
- a phase D throw keeps the draft `committed` and a second commit returns `ALREADY_COMMITTED`;
- ferry legs not routed;
- old trip status recomputed;
- preflight `blocked` writes nothing;
- `existing` target;
- album retry is idempotent.

Also:
- `replaceStations.legModes.test`;
- the existing roadtrip and trip tests green after D1 and D2;
- the PATCH rename `·` prefix test.

**Client and routes.**
- The client: exact flat body, page cap, dedupe, `searchByFileName`, `getMyApiKey` 403 → null, album methods, `missingScope` mapping.
- `immichCapabilities.test`.
- `routes/tripBuilder.test`: 400s, foreign-draft 404s, preview index bounds, commit 400/409s, foreign trip on retry.
- `immichSettingsRoutes.test` updated.

**Vitest.**
- `TripImmichOptions.test`: no request until a flip.
- `TripModal.immichBuild.test`, with a MemoryRouter inside this test only.
- `draftEdits.test`, including re-apply.
- `TripBuilderPage.test`: sessionStorage resume, "currently in" unticked, blocked → save without album, empty states.
- `tripTimelineEvents.roadtripStations.test`, `timelineDotColor.test`, `ImmichConnectionCard` capability line, parity, `immichScopes` (new key).

**Manual UAT** with the owner's real trips. The comparison notes stay **outside the repo**.
1. Capability states with a key lacking album scopes and with a full key.
2. Rebuild the window of a previously hand-built roadtrip under a test name with no album. Compare it against the accepted result, expecting these differences:
   - the no-assignment night now goes to the last-photo station (the hand-built result was a judgement call);
   - excursions are kept as pass stations;
   - ferry defaults depend on the router and deck photos.
   
   Delete the test trip **and** its roadtrip afterwards.
3. Enrich an existing flight-only trip (`existing` target) with the album:
   - count matches the Immich UI;
   - evening photos of the last day included;
   - the red-eye's in-flight photos excluded;
   - the last night is home.
4. Revoke a scope → `blocked`, nothing written.
5. Restart during review → "expired — scan again keeps your edits".
6. Count the time semantics of the owner's flights.

---

## I. Phasing and ideas

**v1 landing order:**
1. P1, P2, D1 (gates)
2. D1b, D2, D3
3. Immich client, capabilities, settings card
4. Clock, clean and flight modules
5. Areas, clusters, segments, nights, night plan
6. Probe and snap, home, airports, naming
7. Draft store, scan job, router
8. Commit and album jobs
9. Timeline stations
10. Popup, launcher, review page
11. `existing` target (edit-mode entry)
12. Map preview (can be cut)
13. FORK_CHANGES section, last and rebased

**Ideas:**

| # | Idea | Effort |
|---|---|---|
| 1 | Re-sync: add new window photos to the album and suggest new stations (the retry endpoint does half of it) | M |
| 2 | Turn `possibleUnrecordedFlight` into a pre-filled Add Flight form (pre-fill only, never invent flights) | M |
| 3 | Day trips as day tours (`kind:"tour"`, `anchorStopId`) instead of pass stations | M |
| 4 | Match overnight stations to LodgingStays (`night:{kind:"stay"}`), or offer to create a stay | M |
| 5 | Dawarich fill for unknown nights and real leg paths (`pullDawarichWindow`) | M |
| 6 | Best photo per station and trip cover from favourites; set the album thumbnail | S |
| 7 | Daily journal drafts. First make `tripSummaryService.ts:319-325` read roadtrip stations, which today it doesn't, so a builder trip's AI summary misses the drive. Then "Write the diary" gated by `useHasLlm`. | M |
| 8 | Companions from Immich people (`withPeople:true` on the same search) | M |
| 9 | Station galleries in link mode by station time window (no import copies) | M |
| 10 | "Build this trip" from a PhotoJourney inbox finding | S |
| 11 | Photo-proven land border crossings fill `countries` and crossing days for the citizenship tracker | M |
| 12 | Immich `GET /map/reverse-geocode` (`map.search`) before Nominatim: local, no 1 per second limit | S |
| 13 | Photo locations as via points when routing | M |
| 14 | Per-user defaults ("inspect on", "album on") in `UserSettings.data` | S |
| 15 | "Show excluded misdated / in-flight photos, include anyway" | S |
| 16 | A "Roadtrip(s)" cell on the journey band (`FlightTripFigures.tsx`) | S |

Dropped ideas:
- Writing corrected dates back to Immich assets: a risky write outside the trip.
- A public shared link: against the owner's privacy stance.

---

## J. Risks, edge cases, open owner questions

**Open questions for the owner:**
- **Decision 7.** Should `LEGACY_FAKE_UTC` rows with a stored or catalogue zone count as precise? They convert exactly (`utils/timezone.ts:144,166`). The default stays as decided; ask after the UAT count.
- **Decision 4.** When several areas exist but only one becomes a roadtrip, it is named exactly like the trip. Confirm.
- **Excursions.** The recipe folds them, while the accepted hand-built result kept them as stations. v1 keeps them by default and offers a fold.

**Clocks.**
- Case B/C detection is heuristic, and borrowed-zone photos are marked `dayGuessed` in the stats.
- An EXIF offset that disagrees with GPS resolves to GPS, and is counted.

**Algorithm.**
- **Chaining** is limited by the 60 km split; the user can merge or rename in review.
- **Ferry detection** needs the custom OSRM or deck photos; otherwise only the chip appears. OSRM covers 9 regions, so legs elsewhere stay straight and are reported as such.

**Limits.**
- 62-day window; 50 pages with `truncated`; 300 stations; 20 areas; 6 filename lookups; 20 geocodes.
- The shared import bucket is 20 per 15 minutes across scans and imports, so repeated scans can hit 429.

**Restarts.** Drafts and jobs are lost. The UI says "expired" or "unknown", and sessionStorage edits are re-applied on re-scan. Phase B is atomic.

**Deletion.** Deleting a builder trip detaches its roadtrips (document this) and never deletes the Immich album.

**Album.**
- Only an album the user owns with that exact name is reused.
- An album already linked to another trip gives a warning.
- An empty album is never created.

**Repository.**
- The other session's files, including `FORK_CHANGES.md`, stay untouched until the final rebase.
- Its uncommitted `AllTab.tsx` (836 lines) will need its own size fix.

---

## Review resolutions

| Issue | Resolution |
|---|---|
| **Alg B1** no afterLanding rule | **Fixed.** Rule C.8.2 (landing after the last photo goes to home, the next area's first station, or unknown). Layover photos are never P. Tests for an evening departure from home and a flight home on E−1. |
| **Alg B2** area split vs tolerance/grace | **Fixed.** Each ground photo gets a side. The cut is at `max(depMs, last grace)` and `min(arrMs, first tolerance)`. Imprecise flights use the time-order references. |
| **Owner B1 / Codefit 7** real itinerary in a public repo | **Fixed.** Synthetic fixtures only (H). The real comparison is UAT outside the repo. Privacy grep added to the gates (0.4). |
| **Alg M1** `localDateTime` is UTC for no-EXIF assets and UTC videos | **Fixed.** Verified at `metadata.service.ts:1020-1061`. The case A/B/C clock model (C.1). |
| **Alg M2** airplane-mode offset; duration clock unspecified | **Fixed, refined.** Local time from the GPS zone. All durations use the real instant `t(p)`, which is **not** `fileCreatedAt` for case C, because Immich stores naive EXIF times as fake UTC. |
| **Alg M3** misdated batch missed | **Fixed.** Run-based batch check with `searchByFileName` lookups. The ILIKE filter was verified at `database.ts:503-507`. The reviewer's "use the context" alone was insufficient: a 48-photo batch is its own majority. |
| **Alg M4** ferry false positives | **Fixed.** Defaults come from the OSRM probe's ferry steps or from sea photos. The polygon test is a chip only. |
| **Alg M5 / Owner minor 5** stations at sea | **Fixed.** At-sea classification with a 3 km buffer; excluded from clusters; used as ferry and night evidence. |
| **Alg M6 / Owner M1** excursion fold loses km and nights | **Fixed.** Never fold a segment holding an evening. Emit B as pass plus A′. Fold is optional in review. |
| **Alg M7** nights on stationless photos; start-date over-count | **Fixed.** P-to-station mapping (C.8); slept rows start at `minNight`. |
| **Alg M8** reducer breaks the night count | **Fixed.** The mirrored `builderNightPlan` is the source of truth. The server re-derives and validates (400 `NIGHT_PLAN_INVALID`). Night assignment limited to adjacent stations. |
| **Alg M9** false fixture facts | **Fixed.** Synthetic fixtures with explicit night tables. Expected UAT differences listed. Ferry night → boarding station, matching the accepted result. |
| **Alg M10 / Owner minor 1 / Codefit 15** home placeholder | **Partly fixed.** Name taken from `periodAt` (verified at `homeAirport.ts:146-149`), the 900 km rule, an "unconfirmed" chip and title fallback. **Rejected:** requiring `residenceConfirmed` for the default, because decision 6 makes the home legs default ON from home periods. The evidence rule is the guard instead. |
| **Alg M11** legacy times, corridor misfires | **Partly fixed.** Time-order condition plus the stationary-group guard. Relaxing decision 7 is an open owner question (J), since the decision is binding. |
| **Codefit 1** scope-copy test | **Fixed.** New `apiKeyScopesAlbums` key; `apiKeyScopes` and `REQUIRED_SCOPES` unchanged (negative assertion verified at `immichScopes.test.ts:43-48`). |
| **Codefit 2** `useNavigate` in TripModal | **Fixed.** Navigation lives only in `<TripBuilderLauncher>`, rendered after Save; navigate runs before `onClose`. Verified: the four tests have no Router. |
| **Codefit 3** tester signature | **Fixed.** Tester untouched. Capabilities live in the route via `immichCapabilities.ts`, only for `source==="user"`. |
| **Codefit 6** duplicate trip after a post-transaction failure | **Fixed.** `finishCommit` right after B; C and D wrapped; abort only from P/B; eviction skips committing drafts. |
| **Codefit 8** live work in progress touches FORK_CHANGES | **Fixed.** Verified with `git status`. Off-limits list; worktree; doc written last and rebased. |
| **Codefit 10** sync Immich calls vs the 10 s browser timeout | **Fixed.** Preflight moved into the job (phase P, `blocked` result); capabilities use 4 s timeouts. |
| **Codefit 17** size check stays red | **Fixed.** Prerequisites P1 and P2; `check:coverage` and `format:check` added to the gates. |
| **Owner M2** existing trips unsupported | **Fixed.** `target:{kind:"existing"}` in v1 (edit-mode entry, window and countries update). |
| **Owner M3** edits lost; no Back | **Fixed.** Review moves to a page (`/trips/builder`), with sessionStorage resume, `beforeunload` guard and Back to `returnTo`. `useBlocker` is not available under `BrowserRouter`, so a confirm on in-app Back/Cancel is used instead. |
| **Owner M4** date correction loses edits | **Fixed.** `movementOutsideDates` warning; stable station keys; `reapplyEdits`. |
| **Owner M5** toggles hidden in a disclosure | **Fixed.** Visible switches with lazy capabilities on first flip, plus a `from-photos` chooser route. |
| **Owner M6** empty and error states; preflight blocks the trip | **Fixed.** Empty-window and no-located screens; album skipped at 0 assets; "Save without album". |
| **Owner M7** 18:00 threshold misses a 02:53 night drive | **Fixed.** 04:00 `nightDay` boundary; the 18:00/09:00 rule kept, plus "no flight between". |
| **Owner M8** countries never filled | **Fixed.** Countries and origin/destination labels derived and pre-filled. |
| **Owner M9** rename doesn't reach `·` names | **Fixed.** D1b prefix rename in PATCH (verified at `trips.ts:593-603`). |

Minor items from all three reviews were folded into the sections above. These include:
- the layover rule for connections without times;
- the 15 km arrival tolerance;
- the post-return drop;
- the grid neighbourhood;
- duplicate-name suffixes;
- `airportDisplayName`;
- title reuse within 5 km;
- the photo-journey checkbox;
- roadtrip visibility on the timeline;
- the link to `/roadtrips/:routeId`;
- the `ExpandableEventCard` base;
- `toLocal` for HH:MM;
- 400s for station validation;
- pattern strings in OpenAPI;
- the sibling capability line;
- leaving the OpenAPI test endpoint baselined;
- documenting companion rows created outside the transaction.

### Critical Files for Implementation
- backend/src/services/immich/immichClient.ts
- backend/src/services/roadtrip/replaceStations.ts
- backend/src/routes/trips.ts
- frontend/src/components/Trips/TripModal.tsx
- backend/src/shared/tour/roadtrip.ts (with its frontend mirror, the model for the new `builderNightPlan.ts`)