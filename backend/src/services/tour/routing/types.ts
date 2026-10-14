import { Coord, LegMode } from "../tourDistance";

/**
 * Request to a routing provider to compute a path between two points.
 */
export interface RouteRequest {
  from: Coord;
  to: Coord;
  mode: LegMode;
  /**
   * The roadtrip's vehicle, when the leg belongs to one (`TripRoute.vehicle`).
   * A provider may refine its profile by it — a bicycle roadtrip's road leg is
   * ridden, not driven. Absent or null means "no vehicle known".
   */
  vehicle?: string | null;
}

/**
 * Geometry and distance for a routed path.
 */
export interface RouteResult {
  /** GeoJSON coordinate order: [lon, lat] tuples. */
  waypoints: Array<[number, number]>;
  /** Distance in kilometres. */
  distanceKm: number;
  /** Time in minutes to traverse this leg; null if unavailable. */
  drivingMinutes: number | null;
}

/**
 * Why a leg ended up a straight chord instead of a routed line. Carried in the
 * routing endpoints' responses so a client can say WHY ("the point is not near
 * a road", "the key was refused") instead of a bare "no route found" — a
 * tester pressed "Strecke berechnen" and saw nothing happen, because every one
 * of these collapsed into the same silent straight line (2026-09-26).
 *
 *  - `no_provider` — the instance has no routing provider configured.
 *  - `unroutable_mode` — ferry or rail; never sent to a road router.
 *  - `provider_error` — network error, 5xx, unreadable answer, or an adapter
 *    that reports failure without a cause.
 *  - `no_route` — the provider found no route between the two points.
 *  - `point_not_near_road` — a stop is too far from anything routable.
 *  - `rate_limited` — the provider's quota answered 429.
 *  - `auth` — the provider refused the key (401/403).
 *  - `untrustworthy` — the provider answered, but its line did not anchor at
 *    the stops or its distance was implausible (see `routeLeg.ts`).
 */
export const ROUTE_FALLBACK_REASONS = [
  "no_provider",
  "unroutable_mode",
  "provider_error",
  "no_route",
  "point_not_near_road",
  "rate_limited",
  "auth",
  "untrustworthy",
] as const;
export type RouteFallbackReason = (typeof ROUTE_FALLBACK_REASONS)[number];

/**
 * The numbers behind an `untrustworthy` fallback, in kilometres — why the
 * provider's answer could not be kept, in a form a client can show beside
 * the reason. A bare "the answer did not fit the two places" cannot tell a
 * stop 1.3 km off the nearest road apart from a provider whose road graph
 * has no data for the whole region and snapped ~9,500 km away (owner report
 * 2026-10-13, the Muscat roadtrip — every leg stayed straight and the
 * message read like the app rejecting a good answer). The numbers can tell
 * the two apart, which is the difference between "move the pin" and "add
 * the region to the router".
 *
 *  - `anchors` — the returned line does not begin/end at the requested
 *    stops: how far its first and last points lie from them.
 *  - `distance` — the line anchored, but the distance it reports is
 *    implausible against the straight-line chord: both numbers.
 *
 * `null` on every other reason: a `no_route` or an `auth` refusal carries no
 * geometry to measure.
 */
export type RouteFallbackDetail =
  | { kind: "anchors"; headOffKm: number; tailOffKm: number }
  | { kind: "distance"; distanceKm: number; chordKm: number };

/**
 * What the host's `osrm-autofetch` service answers `POST /ensure` with
 * (spec 2026-10-13 §2.4), when a refusal looks like a wrong-region one and
 * the app asks it to fetch the missing map data. Carried as `autofetch`
 * BESIDE `fallbackReason`/`fallbackDetail` on the same leg's response — the
 * field is absent (never null) when the feature is off or the service is
 * silent, so a response without an answer is byte-identical to today's.
 *
 *  - `covered` — the built graph already has this leg's area.
 *  - `started` — a build job was accepted and is about to run; `region` and
 *    `etaMinutes` say what is downloading and roughly how long.
 *  - `running` — a build job is already running; the request joined nothing.
 *  - `no_map_data` — no extract covers this area at all (ocean, or an area
 *    Geofabrik has nothing for); nothing will download.
 *  - `blocked` — a cap refuses the job (disk floor, region count); a human
 *    has to look.
 *  - `unavailable` — the service itself cannot serve right now.
 */
export const AUTOFETCH_STATUSES = [
  "covered",
  "started",
  "running",
  "no_map_data",
  "blocked",
  "unavailable",
] as const;

export interface AutoFetchStatus {
  status: (typeof AUTOFETCH_STATUSES)[number];
  region?: string | null;
  etaMinutes?: number | null;
}

/**
 * The job PHASES the host's `osrm-autofetch` `GET /status` reports while it
 * builds a region — `AUTOFETCH_STATUSES` above is what `POST /ensure` answers
 * a routing refusal with (covered / started / running / …), a different
 * vocabulary from the states the running job moves through, so the two must
 * not share an enum. Declared here, beside the other shared consts, so the
 * admin progress panel's schema and its copy cannot drift from the service.
 *
 * `queued` → `downloading` (fetching the extract) → `building` (osrm-extract/
 * customize) → `swapping` (publishing the new graph) → `restoring`.
 */
export const AUTOFETCH_JOB_STATES = [
  "queued",
  "downloading",
  "building",
  "swapping",
  "restoring",
] as const;
export type AutoFetchJobState = (typeof AUTOFETCH_JOB_STATES)[number];

/** A provider's "could not route this", with the cause it could identify. */
export interface RouteFailure {
  failure: RouteFallbackReason;
}

export function isRouteFailure(value: RouteResult | RouteFailure | null): value is RouteFailure {
  return value !== null && "failure" in value;
}

/**
 * What a provider can say about a leg without drawing it: how far the road
 * router thinks it is, and how much of that is ferry (spec 2026-10-09 §C.7).
 */
export interface RouteProbe {
  distanceKm: number;
  ferryKm: number;
}

/**
 * A routing provider that can answer route queries.
 *
 * Never throws for a routing failure. `null` is "could not route this" with no
 * cause known (read as `provider_error`); a `RouteFailure` names the cause.
 */
export interface RouteProvider {
  readonly id: RoutingProviderId;
  route(req: RouteRequest): Promise<RouteResult | RouteFailure | null>;
  /**
   * How far the road router thinks `a` → `b` is, and how much of that is
   * ferry. Optional, and implemented only by the self-hosted OSRM
   * (`customOsrm.ts`): it is local and has no quota, which a hosted provider
   * does not allow for the dozens of questions a trip builder scan asks. Never
   * throws; `null` is "no answer".
   */
  probe?(a: Coord, b: Coord): Promise<RouteProbe | null>;
  /**
   * The nearest point on a road to `c`, or null when the router has none.
   * Optional and OSRM-only, for the same reason as `probe`. Never throws.
   */
  snap?(c: Coord): Promise<Coord | null>;
}

export const ROUTING_PROVIDER_IDS = ["openrouteservice", "graphhopper", "custom"] as const;
export type RoutingProviderId = (typeof ROUTING_PROVIDER_IDS)[number];

/**
 * The set of leg modes a road router can meaningfully answer.
 * Road, foot, and bike are self-directed: the traveller or vehicle follows
 * a path the router can compute. Ferry and rail are excluded by design.
 */
export type RoutableMode = Extract<LegMode, "road" | "foot" | "bike">;

/**
 * Check whether a given leg mode can be routed by a road router.
 *
 * Road, foot, and bike are self-directed: the traveller or the vehicle follows
 * a path the router can compute. Ferry and rail are not routable: a ferry
 * crosses water no road router knows (it would return a road detour around the
 * body of water), and a train follows dedicated track the traveller does not
 * choose. Asking a road router for either mode returns a plausible number that
 * is silently wrong — the wrong answer looks right and gets added to the tour
 * total. This guard prevents that silent error by being a type guard: after
 * this check, TypeScript knows the mode is RoutableMode and can safely index
 * a provider's own profile map. Before the check, it cannot — forgetting the
 * gate is a compile error, not a silent road detour.
 *
 * There is deliberately no shared `PROFILE_BY_MODE` here: OpenRouteService,
 * GraphHopper and a self-hosted OSRM each use their own profile vocabulary
 * (e.g. ORS's heavy-vehicle profile is `driving-hgv`, GraphHopper's is
 * `truck`, and a custom OSRM instance's is whatever the operator named it).
 * A single shared string for "the heavy-vehicle profile" would be right for
 * at most one provider and silently wrong for the others. Each adapter
 * (`openRouteService.ts`, `graphHopper.ts`, `customOsrm.ts`) keeps its own
 * `Record<RoutableMode, string>`, sourced from that provider's documentation.
 */
export function isRoutableMode(mode: LegMode): mode is RoutableMode {
  return mode === "road" || mode === "foot" || mode === "bike";
}
