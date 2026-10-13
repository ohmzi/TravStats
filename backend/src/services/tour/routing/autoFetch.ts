import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { Coord } from "../tourDistance";
import { AUTOFETCH_STATUSES, AutoFetchStatus } from "./types";

/**
 * The one outbound call to the host's `osrm-autofetch` service (spec
 * 2026-10-13 §2.4): when a routing refusal is a WRONG-REGION one — the
 * provider's line snapped hundreds of kilometres away, which is what a road
 * graph with no data for that area does — ask the service to fetch and build
 * the missing region, and hand its answer to the client so the refusal's
 * message can say a download is running instead of the dead-end "the answer
 * did not fit the two places".
 *
 * Everything here is best-effort by design: this call rides on the response
 * of a routing endpoint, and when the service is unconfigured, down, slow, or
 * answers nonsense, the response must stay exactly what it was before this
 * feature existed (spec §5) — so every failure mode returns `null` and the
 * caller simply carries no `autofetch` field.
 */

export type { AutoFetchStatus };

/**
 * The refusal is read as a wrong-region one only when the smaller of the two
 * anchor offsets is beyond this. A wrong-region answer snaps both stops
 * hundreds of km away (the owner's Muscat roadtrip, 2026-10-13); a pin error
 * is ~1.3 km. The gap between the two is three orders of magnitude, so the
 * exact value is not delicate — it just has to sit well above a pin error and
 * well below any genuine wrong-region snap.
 */
export const AUTOFETCH_MIN_OFF_KM = 20;

const STATUS_SET: ReadonlySet<string> = new Set(AUTOFETCH_STATUSES);

/**
 * The configured service URL, or null when on-demand map fetching is off.
 *
 * Read the same way `resolveRouteProvider` reads its own settings — first row
 * by id, the singleton row every admin-setting reader uses. An empty string
 * also ends up "off": `maybeAutoFetch` refuses a falsy URL the same way, so a
 * blank field written straight into the column cannot produce a request to
 * `/ensure` (the admin UI saves a cleared field as null).
 */
export async function readAutoFetchUrl(): Promise<string | null> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { routingAutoFetchUrl: true },
  });
  return row?.routingAutoFetchUrl ?? null;
}

/**
 * Whether a refusal's detail says "this provider has no map for this area"
 * rather than "this pin is a bit off the road" or "this answer is broken".
 *
 * Only an `anchors` detail can be one: a `distance` mismatch means the line
 * DID anchor at both stops (the road is just implausibly long), so the graph
 * covered the area — downloading another region would not help. `min` of the
 * two offsets, strictly `>` the threshold: one end near its stop means the
 * line anchored there, however far the other end drifted.
 */
export function shouldAutoFetch(
  detail: { kind: string; headOffKm?: number; tailOffKm?: number } | null
): boolean {
  return (
    detail?.kind === "anchors" &&
    Math.min(detail.headOffKm ?? Infinity, detail.tailOffKm ?? Infinity) > AUTOFETCH_MIN_OFF_KM
  );
}

/**
 * Ask the service to ensure the leg's two points are covered. Never throws;
 * `null` is "no answer" — feature off, service unreachable, or a response
 * this client does not understand. The 2.5 s timeout bounds the refusal
 * path's added latency: a hung service must not hold a routing response open.
 */
export async function maybeAutoFetch(
  url: string | null,
  from: Coord,
  to: Coord,
  fetchImpl: typeof fetch = fetch
): Promise<AutoFetchStatus | null> {
  if (!url) return null;
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        points: [
          [from.lat, from.lon],
          [to.lat, to.lon],
        ],
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AutoFetchStatus;
    if (!data || typeof data !== "object" || !STATUS_SET.has(data.status)) return null;
    return data;
  } catch (err) {
    logger.warn({ err }, "autoFetch: ensure call failed");
    return null;
  }
}
