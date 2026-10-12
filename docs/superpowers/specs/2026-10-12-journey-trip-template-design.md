# One template for the journey and the trip — design

Status: approved in conversation 2026-10-12 (owner); this document is the binding design.
Relates to: the trip-builder, stopover and pitstop specs (the album rules reused here live there).

## 1. The want

The journey page and the trip page grew apart: the trip page has a clean figures table, a station chain and a map; the journey page has tabs, a meta line, roadtrip/album cards and an AI summary. The owner wants **one template for both levels**:

- the journey page adopts the trip page's anatomy — the figures table, a chain down the middle, a map, the AI summary **below the map**;
- the trip page adopts the journey's **tabs**, and gains its **own AI summary** below its map and a **full-screen map** tab;
- titles simplify to **name + country flag(s)**; the removed date/route crumbs move into a new **Dates** cell of the figures table;
- **one Edit button** opens one **edit page** per level, which also carries **Re-sync from Immich** and **Delete**;
- everything a trip changes is reflected on its journey.

Owner rulings (2026-10-12):

1. **Vocabulary:** the top level is a **Journey**; the nested car entity's UI label becomes **Trip** (the Tours tab becomes **Trips**). DB names (`Trip`, `TripRoute`) and URL paths stay as they are; this is a copy-level change.
2. **Tabs:** both levels share **Overview, Timeline, Map, Gallery, Logistics**; the journey adds one more, **Trips**. The trip page has no Trips tab. (The Trips tab keeps the Tours tab's beta gating on the roadtrip domain.)
3. **Edit:** a dedicated **edit page** per level, holding the entity's fields plus Re-sync from Immich and Delete.
4. **AI summary per trip:** a real summary, generated and stored like the journey's.
5. **Storage:** a **Prisma migration** adds the summary columns to the trip (roadtrip) table.
6. **Journey Overview chain:** its nodes are the journey's **trips** (name, date span, km, stops, link) — stops stay on each trip's own pages.

## 2. The shared template

A shared page shell (`EntityPage`, working name) renders, in order:

1. **Header** — the entity's name and its country flag(s) only. No meta line, no "Car · …", no "Completed · …". Exactly **one action: Edit** (links to the level's edit page).
2. **Figures table** — one row of cells; the set depends on the level:
   - **Journey:** Dates (from–to) · Days · Km (the **sum** of its trips' driven km) · Countries · Trips (count) · Albums (count).
   - **Trip:** Dates (from–to) · Driven km (this trip only) · Days · Slept in · Countries · Journey (link back) · Album (the trip's **own** album — the `albumForRoadtrip` resolution of the pitstop feature; falls back to the journey's album per that rule).
   - Days follows the days figure convention of 2026-10-11 (inclusive span, ≈ when approximate); Dates is the entity's own from–to.
3. **Tab bar** — the level's tabs (§3), driven by the existing `?tab=` mechanism (the Tours→Trips rename keeps `?tab=tours` as an accepted alias so old links land on Trips).

## 3. The tabs

**Journey** (6): Overview · Timeline · Map · Gallery · Logistics · Trips.

- **Overview** — the shared anatomy: figures table, then the **trips chain** (one node per trip: name, date span, km, stops count, a link to the trip), then the **map**, then the **AI summary below the map** (Regenerate as today).
- **Timeline** — the journey's existing timeline view (kept).
- **Map** — a full-screen map of the journey (all its trips' routes).
- **Gallery** — every album of every trip in the journey (the linked albums the journey already carries), each section as today.
- **Logistics** — the journey's existing logistics tab (kept).
- **Trips** — the journey's trips as cards (today's Overview roadtrips section, promoted to its own tab), each linking to the trip page. Gated on the roadtrips domain exactly as the Tours tab is today.

**Trip** (5): Overview · Timeline · Map · Gallery · Logistics.

- **Overview** — figures table, then the **finest chain**: day headers with every station (pills: free night / pass-through / day trip …), the legs between them (mode, km, duration), and the nights — the anatomy today's trip page shows, as the Overview's chain.
- **Timeline** — the same day-by-day material as a dedicated tab, with the deeper per-day detail (each day's stations, legs and nights; the day-by-day breakdown the Overview's chain does not spell out).
- **Map** — a **full-screen map of the trip** (its route and stations).
- **Gallery** — **only the trip's own album** (the `albumForRoadtrip` resolution; a trip with no own album falls back to the journey's).
- **Logistics** — the trip's own logistics (recordings and the rest the roadtrip page shows today).

## 4. The edit pages

- **Journey edit** — a new page at the journey's existing edit path, holding today's modal form fields (name, dates, countries, color, icon, tags, companions, notes, cover) as page content, plus a **Re-sync from Immich** section (the same launch as today's header button) and a **Delete** section (the existing confirm flow; deleting a journey keeps §J's semantics — its trips are detached, never deleted, and the Immich album is never touched).
- **Trip edit** — the existing route & recordings editor page gains a **Re-sync from Immich** section (for a trip filed on a journey) and a **Delete** section (the existing roadtrip delete, with its confirm and its effect on stations — unchanged semantics, documented in the plan).
- The headers lose their standalone Edit/Delete/Re-sync buttons; the trip page's two edit buttons collapse into the single Edit action.

## 5. Propagation

Trip changes reflect on the journey because both read the same rows. The design pins it with tests: renaming/re-dating a trip, editing its stations, or its album changing (created, linked, re-synced) updates the journey's figures (km sum, days, dates), its Trips tab/chain, and the journey Gallery. The journey's delete detaches its trips (§J); a trip's delete leaves the journey otherwise intact.

## 6. The trip's AI summary

- A **Prisma migration** adds `summary`, `summaryGeneratedAt` and `summarySource` to the trip table (`TripRoute`), mirroring the journey's columns; no backfill.
- Generation reuses the journey summary service's pattern (`tripSummaryService`/`tripSummaryProvenance`): same provider, same Regenerate route shape extended to trips, same provenance rules; the summary covers the trip's own span and stations.
- The trip's Overview shows it **below the map**, with Regenerate; the journey's moves below its map.
- The deploy applies the migration to the live DB after the usual backup; the gate applies it to the test DB.

## 7. Copy and i18n

- The vocabulary sweep (en + de): the nested entity reads **Trip** in every surface that says Roadtrip today (nav breadcrumbs, cards, tabs, buttons, empty states); the top level stays **Journey**. The `?tab=tours` URL keeps working as an alias.
- New cell labels (Dates, Trips, Albums, the journey's Km-as-sum wording), removed meta strings, the Trips-tab name and empty state — all in the `trips`/`roadtrips`/`common` namespaces as each surface already uses, en and de, key-literal guard included.

## 8. Out of scope

- Renaming DB models, tables or URL paths (`/trips/:id`, `/roadtrips/:id` stay).
- Any change to the map engine, the timeline data model, or the reviews' commit flows.
- Per-trip summaries for standalone trips without a journey (none exist; the trip always belongs to a journey or is detached — a detached trip shows no summary section until it is filed again, documented in the plan).

## 9. Testing and acceptance

TDD per surface with independent reviews; the gate applies the migration on the test DB. Tests cover: the shared shell's per-level cell sets (incl. the km sum and the trip's own-album resolution), the tab sets and the alias, the trips chain, the per-level gallery scope, the edit pages' sections (resync + delete present, header buttons gone), the propagation pins, the trip summary's storage/generation/provenance, the copy sweep's key guard, and the migration.

**Acceptance (live UAT):** on a one-trip journey (the private ledger names the real one): both pages share the template; the trip's Overview shows its own AI summary under the map; the journey's km equals its trip's; the trip's gallery shows its own album; one Edit button each. On a multi-trip journey with a stopover album: the journey's km is the sum across its trips, the Trips tab lists them all, the journey gallery shows every album, and each trip page shows its own album and summary.
