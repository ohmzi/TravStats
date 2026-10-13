# On-demand OSRM region fetching (`osrm-autofetch`) — design

2026-10-13. Owner ask: "create a system to automatically download the map place user is trying to sync the route for. so this error doesnt happen and we can download as per need". Owner decision (this session): the provisioner is triggered by the app, and the downloading state is shown in TravStats' routing messages ("Also show it in TravStats").

## 1. Context and goal

Twice in one day the same failure class hit live routing: the self-hosted OSRM graph merges a fixed list of Geofabrik extracts, and any route outside that list is answered by snapping to the nearest covered region — hundreds to thousands of km away, e.g. Muscat ("begins 9,532.9 km from the first place") and the Smokey Mountains ("begins 671.3 km… ends 517.9 km"). The app's anchor check correctly refuses those answers; each fix was manual (edit `REGIONS` in two scripts, download, rebuild 20–40 min, restart).

**Goal:** when a routing attempt involves coordinates outside the built coverage, the system fetches the covering extract(s) and rebuilds by itself; the routing message says what is happening; the next attempt routes.

**Non-goals (v1):** pre-fetching at trip sync time; per-country routing isolation; planet-scale coverage; serving clients other than TravStats (the transparent-proxy option was considered and rejected — an extra hop in the request path for no extra value).

## 2. Architecture

### 2.1 `regions` — the single region list

Today the extract list is duplicated in `download-osm.sh` and `build.sh`. The refactor: one plain-text file at `/home/ohmz/docker-container-data/osrm/regions`, one Geofabrik path per line (e.g. `north-america/us/tennessee`, `asia/pakistan`), `#` comments allowed. Both scripts read it (download keeps its basename→`-latest.osm.pbf` mapping); the autofetch service appends to it. This file is the single source of truth for what is built and what to fetch.

### 2.2 `osrm-autofetch` — the host service

A small Python 3 (stdlib only) HTTP service on the host:

- `/usr/local/sbin/osrm-autofetch.py`, systemd unit `osrm-autofetch.service`.
- Runs as the owner user (`ohmz`) — it needs the docker CLI (for `docker run` build steps and `docker compose restart osrm`) and write access to `/home/ohmz/docker-container-data/osrm/`.
- **Binds only the TravStats docker bridge gateway address** (looked up from `docker network inspect travstats_travstats-network` at start), port **5013** — reachable by the app container, never from the LAN.
- Endpoints:
  - `POST /ensure` body `{"points":[[lat,lon], …]}` (1–20 points) → one of:
    - `{"status":"covered"}` — every point's extract is already built.
    - `{"status":"started","region":"Tennessee","etaMinutes":25}` — missing extract(s) persisted to `regions`, ONE build job enqueued.
    - `{"status":"running","region":"Tennessee","etaMinutes":15}` — the same (or any) build is already in progress.
    - `{"status":"no_map_data"}` — no leaf extract contains a point (ocean etc.); negative-cached.
    - `{"status":"blocked","reason":"…"}` — a cap (below) was hit.
    - `{"status":"unavailable","reason":"…"}` — internal trouble (index unfetchable, disk, lock).
  - `GET /status` → `{"built":[…], "job":{"state","region","startedAt"} | null, "lastResult":…}` for the controller/owner.

### 2.3 Build pipeline (the worker; one job at a time)

Reuses `build.sh`'s steps but **stages** them so the live graph keeps serving until the swap:

1. Resolve missing extracts from the cached Geofabrik `index-v1.json` (point-in-bbox over leaf extracts; refresh weekly). Cap: **≤4 new extracts per job**.
2. Download each with `curl -sL --fail --retry 3 -C -` to `<name>-latest.osm.pbf.part`, then rename.
3. Build into `data/staging/`: `osmium merge` (all extracts) → `osrm-extract -p /opt/car.lua` → `osrm-partition` → `osrm-customize` (the same `osrm/osrm-backend` and `stefda/osmium-tool` images, run `nice`d).
4. Swap: `data/merged.osrm*` → `data/previous/`; `data/staging/merged.osrm*` → `data/`.
5. `docker compose restart osrm` (the compose lives beside the data dir).
6. Health probe against `127.0.0.1:5001` (the Toronto control leg). Failure → restore `data/previous/`, restart, mark the job `failed` (routing never stays broken silently).
7. State: `data/.osrm-autofetch.state.json` (jobs, built list, negative cache) + a file lock `/data/.osrm-autofetch.lock` held during builds; **manual builders take the same lock** (documented in build.sh), so a hand-run rebuild cannot collide with a job.

### 2.4 TravStats side (the fork change)

- New admin setting **`routingAutoFetchUrl`** (empty = off = today's behaviour), served and edited exactly like `routing_custom_url`.
- In the routing refusal path (`routes/trips/tourRouting.ts`, single-leg and route-all): when the refusal detail is `kind:"anchors"` and `min(headOffKm, tailOffKm) > 20`, the backend POSTs `/ensure` with THAT leg's two coordinates (2.5 s timeout) and merges the answer into the leg's response as `autofetch: {status, region?, etaMinutes?}`. Route-all attaches it to the same leg that carries `fallbackReason`/`fallbackDetail` (its first fallback), so the numbers and the message always describe one leg. A real pin error (≤1.3 km) and a genuine distance mismatch never trigger it.
- OpenAPI updated for the response addition.
- Frontend copy (`lib/routeFallbackCopy.ts`, one composer for both the editor toasts and the LegDialog):
  - `started` / `running` → " Map data for <region> is downloading (~<eta> min) — try again after."
  - `no_map_data` → " No map data is available for this area."
  - `covered` → nothing extra (the refusal had a different cause).
  - `unavailable` / `blocked` → nothing extra (today's message).
  - New en+de keys under `trips:tours.routing.autofetch.*`.

## 3. Caps, thresholds, constants (v1)

- Trigger threshold: `AUTOFETCH_MIN_OFF_KM = 20` (wrong-region offsets are ≥ hundreds of km; a pin error is ~1.3 km).
- Acceptance bound: `AUTO_SNAP_MAX_KM = 25` in `routeLeg.ts` — the provider's snapped line is accepted when the larger anchor offset is ≤ 25 km (owner ruling 2026-10-13: a beach/hike pin routes to its nearest road); above that the refusal stands and, by construction, always triggers the auto-fetch (every refusal is > 25 km on both ends, which is > 20 km).
- ≤4 new extracts per job; ≤40 built regions total (beyond → `blocked`, i.e. talk to a human); ≥100 GB free disk required; ONE job at a time.
- Negative cache: a 1° grid cell with no containing extract → `no_map_data` for 24 h.
- ETA heuristic: ~3 min per 100 MB downloaded + ~12–20 min for the merge/extract/partition/customize, rounded to the nearest 5, reported as `etaMinutes`.

## 4. Security

- The service never binds beyond the TravStats bridge gateway; no LAN exposure, no new hostname, no port forward.
- It runs as `ohmz` with fixed command shapes — `docker run <image> <fixed argv> <validated file paths>` and `docker compose restart osrm`; request data is numbers only, region ids are validated against the cached index before use.
- No docker socket is exposed to any container.
- Systemd hardening: `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict` with `ReadWritePaths=` the osrm data dir + state, `Restart=on-failure`.

## 5. Failure handling

- Download fails → job `failed`, parts kept, `regions` unchanged; the next request retries.
- Build fails → staging discarded; the LIVE graph is untouched and keeps serving all covered areas.
- Swap/probe fails → `previous/` restored, osrm restarted, job `failed` (loud in journalctl).
- Service down/unreachable → the app's ensure call times out → the routing message is byte-identical to today (no regression).
- osrm restart after swap: routing answers blip for ~30–60 s while the graph reloads.

## 6. Testing

- **Service units (fixtures, no network):** index parsing + bbox containment (boundaries, multi-match, parent-entry exclusion), negative cache, the job state machine, the regions-file reader/appender, the `/ensure` contract per status, lock behaviour.
- **Scripts:** after the refactor, a dry check that `download-osm.sh` and `build.sh` resolve exactly the same list as today (the 13 regions).
- **Fork:** backend tests for the trigger threshold and the ensure call (mocked HTTP) + the DTO; frontend copy tests with en/de parity guards, RED first.
- **Live E2E (acceptance):** the owner's **Iceland 2020** trip is genuinely uncovered — attempt its routing, see the downloading copy, watch the build complete, then route it for real. Re-check a covered trip (Smokey) routes with no extra copy.

## 7. Rollout

1. Today's manual TN+NC rebuild finishes; Smokey routes (in flight now).
2. `regions` refactor + both scripts read it (verified against today's list).
3. Install `osrm-autofetch` + unit; `/status` green; caps live.
4. The fork change (setting, ensure, DTO, copy, OpenAPI), tests, gate, deploy, push (standing instruction: implement and deploy).
5. Live E2E on Iceland; record in `FORK_CHANGES.md` + this spec's status.

## 8. Open questions

None. Resolved by the design above: trigger threshold 20 km; caps as listed; Iceland as the E2E; the app is the only client; the download+build runs on the host under the owner's user with no docker-socket exposure.
