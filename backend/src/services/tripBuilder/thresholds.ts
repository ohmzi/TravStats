/**
 * Every number the trip builder decides with (spec 2026-10-09 §C.0), in one place.
 *
 * The first group is the owner's accepted recipe — the rules the hand-built
 * reference roadtrip was made with — and `__tests__/thresholds.test.ts` pins
 * it: change it only with the owner. Everything below it is a design parameter
 * of the spec; each comment names the rule that reads it.
 */

// ─── The owner's accepted recipe (pinned) ────────────────────────────────────

/** Single linkage: two located photos this close are one city cluster (§C.5). */
export const CITY_LINK_KM = 30;
/** Same cluster and a gap no longer than this: the segment continues (§C.6). */
export const SEGMENT_CONTINUE_GAP_H = 30;
/** Shorter than this, between two segments of one cluster: an excursion (§C.6). */
export const EXCURSION_MAX_H = 8;
/** At least this long: a visit; shorter: brief (§C.6). */
export const VISIT_MIN_H = 6;
/** Straggler check: neighbours lie within ± this many counter positions (§C.2). */
export const MISDATED_COUNTER_WINDOW = 25;
/** Straggler and batch check: further than this many days from the neighbours is misdated. */
export const MISDATED_COUNTER_DAYS = 3;
/** Straggler check: a photo with fewer neighbours than this is not judged. */
export const MISDATED_MIN_NEIGHBOURS = 5;

// ─── Clean (§C.2) ────────────────────────────────────────────────────────────

/** A filename clock (Samsung local, Pixel UTC) further than this from the photo's is misdated. */
export const MISDATED_FILENAME_H = 36;
/** At most this many `searchByFileName` lookups per scan, for the batch check. */
export const MISDATED_LOOKUPS = 6;
/** A batch lookup searches this many days either side of the fetch range. */
export const MISDATED_LOOKUP_PAD_DAYS = 60;
/** A counter may wrap 9999 → 0000 only between photos at most this many days apart. */
export const COUNTER_WRAP_MAX_DAYS = 30;
/** |lat| and |lon| both below this is "no GPS" written as 0,0. */
export const GPS_ZERO_EPSILON = 1e-6;
/** At sea: no country at the point nor at any ring point this far out. */
export const AT_SEA_BUFFER_KM = 3;
/** How many ring points the at-sea test asks. */
export const AT_SEA_RING_POINTS = 8;

// ─── Clusters and segments (§C.5, §C.6) ──────────────────────────────────────

/** A cluster spread wider than this is split by Immich `city|state`. */
export const CLUSTER_OVERSIZE_KM = 60;
/** A split group with fewer photos than this joins the nearest group. */
export const CLUSTER_SPLIT_MIN_PHOTOS = 3;
/** Clustering buckets photos on this grid, in degrees. */
export const CLUSTER_GRID_DEG = 0.27;
/** A middle segment with fewer photos than this … */
export const BRIEF_MIN_PHOTOS = 3;
/** … that also lasts less than this is transit noise: a "passed through" chip. */
export const BRIEF_MIN_MINUTES = 30;

// ─── Window and clock (§C.1) ─────────────────────────────────────────────────

/** The fetch starts this long before S 00:00Z: midnight at UTC+14. */
export const WINDOW_PAD_BEFORE_H = 14;
/** The fetch ends this long after (E+1) 00:00Z: midnight at UTC−12. */
export const WINDOW_PAD_AFTER_H = 12;
/** Days fetched either side of [S, E] as context; also the "checked" span of the empty state. */
export const CONTEXT_PAD_DAYS = 3;
/** The longest window a scan may cover, S and E included. */
export const MAX_WINDOW_DAYS = 62;
/** nightDay(p) is the day of local(p) minus this: 00:00–03:59 is the evening before. */
export const NIGHT_BOUNDARY_H = 4;
/** Zone rule 3: borrow the zone of the nearest located photo within ± this many hours. */
export const ZONE_NEIGHBOUR_H = 12;

// ─── Flights (§C.3, §C.4) ────────────────────────────────────────────────────

/** A photo this long before landing … */
export const ARRIVAL_TOLERANCE_MIN = 30;
/** … and this close to the arrival airport is on the ground, after the flight. */
export const ARRIVAL_TOLERANCE_KM = 15;
/** Without an actual departure, a photo this long after departure … */
export const DEPARTURE_GRACE_MIN = 45;
/** … and this close to the departure airport is on the ground, before the flight. */
export const DEPARTURE_GRACE_KM = 15;
/** Without an actual arrival, photos up to this long after arrival may still be airborne. */
export const DELAY_CORRIDOR_H = 3;
/** Cross-track distance of the flight corridor. */
export const CORRIDOR_KM = 50;
/** "Near an airport" for the corridor and imprecise-flight tests. */
export const AIRPORT_NEAR_KM = 50;
/** A stationary group — this many photos … */
export const STATIONARY_GROUP_PHOTOS = 3;
/** … within this distance … */
export const STATIONARY_GROUP_KM = 2;
/** … over at least this many minutes — is never in flight. */
export const STATIONARY_GROUP_MIN = 20;
/** A ground interval shorter than this at the shared airport can be a layover … */
export const LAYOVER_MAX_H = 12;
/** … when every photo in it lies within this of that airport. */
export const LAYOVER_RADIUS_KM = 30;
/** An area end further than this from its airport gets an airport station (§C.9). */
export const AIRPORT_ANCHOR_KM = 30;
/** Flights are loaded with a departure in [S − this, E + this]. */
export const FLIGHT_LOAD_PAD_DAYS = 2;
/** A flight is listed when it departs no earlier than S − this (a red-eye). */
export const FLIGHT_LIST_EARLY_DAYS = 1;
/** Consecutive segments at least this far apart … */
export const IMPLICIT_FLIGHT_MIN_KM = 400;
/** … at this speed or faster were flown, recorded or not. */
export const IMPLICIT_FLIGHT_MIN_KMH = 200;

// ─── Home and nights (§C.8, §C.9) ────────────────────────────────────────────

/** A cluster, airport or photo this close to the residence is home (also `movementOutsideDates`). */
export const HOME_RADIUS_KM = 30;
/** A home leg defaults on only when the area end lies within this of home. */
export const HOME_LEG_MAX_KM = 900;
/** A night drive covers at least this distance … */
export const NIGHT_DRIVE_MIN_KM = 150;
/** … leaves after this local time (00:00–03:59 reads as 24:00–27:59) … */
export const NIGHT_DRIVE_LAST_AFTER = "18:00";
/** … and arrives before this local time. */
export const NIGHT_DRIVE_FIRST_BEFORE = "09:00";

// ─── Roads, ferries, names, previews (§C.5, §C.7, §C.9) ──────────────────────

/** The router's ferry steps cover at least this share of the leg: a ferry. */
export const FERRY_PROBE_SHARE = 0.5;
/** At least this many at-sea photos between two stations: a ferry. */
export const FERRY_MIN_SEA_PHOTOS = 2;
/** The water chip only looks at chords at least this long … */
export const FERRY_CHIP_MIN_CHORD_KM = 20;
/** … that are at least this share water … */
export const FERRY_CHIP_WATER_FRACTION = 0.5;
/** … or hold one water run at least this long. */
export const FERRY_CHIP_WATER_RUN_KM = 30;
/** A station median further than this from the road is moved onto it … */
export const SNAP_MIN_KM = 0.9;
/** … unless it is further than this: then `noRoadData`. */
export const SNAP_MAX_KM = 10;
/** Probes and snaps run this many at a time (custom OSRM only). */
export const PROBE_CONCURRENCY = 4;
/** An existing station title of the user's within this distance is reused. */
export const TITLE_REUSE_KM = 5;
/** At most this many Nominatim lookups per scan (1 per second). */
export const MAX_GEOCODE_LOOKUPS = 20;
/** Thumbnails per station card. */
export const PREVIEWS_PER_STATION = 6;
/** Thumbnails per draft; the preview route accepts index 0 … MAX_PREVIEWS − 1. */
export const MAX_PREVIEWS = 400;
/** Station keys round the median to this grid, in degrees. */
export const STATION_KEY_GRID_DEG = 0.05;

// ─── Draft store, commit, request limits (spec §A, §D, §F, §J) ───────────────

/** A draft expires after this long untouched … */
export const DRAFT_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
/** … or this long after it was made, whichever is first. */
export const DRAFT_MAX_TTL_MS = 6 * 60 * 60 * 1000;
/** Ready drafts kept per user; the oldest ready one goes first. */
export const MAX_DRAFTS_PER_USER = 3;
/** Drafts kept in the process. Committing and committed drafts are never evicted. */
export const MAX_DRAFTS_TOTAL = 50;
/** Areas per commit. */
export const MAX_AREAS = 20;
/** The roadtrip station cap of `stationsSchema` (schemas/roadtrip.ts:83). */
export const MAX_STATIONS_PER_AREA = 300;
/** Flights per commit. */
export const MAX_COMMIT_FLIGHTS = 100;
/** Ticked photo-journey findings per commit. */
export const MAX_PHOTO_JOURNEYS = 50;
/** Immich calls of the commit preflight. */
export const PREFLIGHT_TIMEOUT_MS = 4_000;
/** Phase B's one transaction. */
export const COMMIT_TX_TIMEOUT_MS = 30_000;
/** Phase C routes new legs in chunks of this many (`AUTO_ROUTE_MAX_LEGS`) … */
export const ROUTE_CHUNK_LEGS = 25;
/** … until this budget is spent. */
export const ROUTE_BUDGET_MS = 120_000;
/** Asset ids per `PUT /albums/:id/assets`. */
export const ALBUM_ADD_CHUNK = 1000;
/** An overlapping trip longer than this is flagged `suspiciouslyLong`. */
export const SUSPICIOUS_TRIP_DAYS = 60;
/** A pending photo-journey finding overlaps when it lies within [S − this, E + this]. */
export const PHOTO_JOURNEY_PAD_DAYS = 1;
