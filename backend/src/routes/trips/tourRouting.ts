import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { LEG_MODES, LegMode } from "../../services/tour/tourDistance";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import { routeLegGeometry } from "../../services/tour/routing/routeLeg";
import { applyRoutedLeg } from "../../services/tour/routing/autoRouteLegs";
import {
  maybeAutoFetch,
  readAutoFetchUrl,
  shouldAutoFetch,
} from "../../services/tour/routing/autoFetch";
import {
  AutoFetchStatus,
  isRoutableMode,
  RouteFallbackDetail,
  RouteFallbackReason,
  RouteProvider,
} from "../../services/tour/routing/types";
import { findLegOrThrow, requireCoords } from "./tourLegs";
import { resolveRouteFromRequest, toDto, toLegDto, ROUTE_SELECT } from "./tourRoutes";
import logger from "../../utils/logger";

/**
 * Tour route provider-routing endpoints — split out of `tourLegs.ts` (task 6
 * of phase 3), which was already at 300+ lines against the 400-line "ideal"
 * ceiling before these two handlers existed. Mounted at the SAME `/trips`
 * prefix as `tourRoutes.ts`/`tourLegs.ts`, the same satellite-router pattern.
 *
 * Two capabilities live here:
 *  - `POST .../legs/:fromStopId/:toStopId/route` — route ONE leg through the
 *    configured provider.
 *  - `POST .../route-all` — route every routable leg of a section in one call.
 *
 * Both delegate the actual routing decision to `routeLegGeometry`
 * (`services/tour/routing/routeLeg.ts`, built in task 5 — NOT modified
 * here): that function already encodes the full fallback rule (unroutable
 * mode → chord, no provider → chord, provider failure or an untrustworthy
 * answer → chord). This module's own job is strictly the HTTP surface: load
 * the leg(s), decide up front whether the "no provider at all" case is a
 * hard 409 (single leg) or a per-leg skip that still returns 200 (route-all),
 * persist the result, and shape the response.
 */

const router = Router();

/**
 * `TripRouteLeg.mode` is a plain Prisma `String` column (see schema.prisma —
 * it is validated to a `LEG_MODES` member only at WRITE time, by
 * `createRouteSchema`/`updateRouteSchema`/the leg-override PUT), so reading
 * it back gives `string`, not the `LegMode` union `routeLegGeometry` and
 * `isRoutableMode` require. This backstop narrows it the same way
 * `requireCoords` (in `tourLegs.ts`) backstops a nullable coordinate: it
 * should never fire against data written through this codebase's own write
 * paths, and fails loudly (409, "instance not equipped to handle this data")
 * rather than smuggling an `as LegMode` cast past the `any`-forbidden rule.
 */
function requireLegMode(mode: string): LegMode {
  if ((LEG_MODES as readonly string[]).includes(mode)) {
    return mode as LegMode;
  }
  throw new AppError(`Leg has an unrecognised mode "${mode}"`, 409);
}

/** The section's vehicle, which lets a provider pick its profile (a bicycle rides). */
async function routeVehicle(routeId: string): Promise<string | null> {
  const route = await prisma.tripRoute.findUnique({
    where: { id: routeId },
    select: { vehicle: true },
  });
  return route?.vehicle ?? null;
}

/**
 * POST /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId/route
 *
 * Routes ONE leg through the configured provider and stores the result.
 *
 * No provider configured is a **409**, not a 400: the caller's request is
 * fine (it names a real leg), the INSTANCE is not equipped to answer it —
 * exactly the reasoning `requireCoords` already uses for a leg that lost its
 * stop coordinates. A provider that IS configured but fails, times out, or
 * returns an untrustworthy line is a different case entirely: that is
 * `routeLegGeometry`'s own straight-chord fallback, and it is not an error —
 * the leg is still updated (to `source: "straight"`, `confidence: "low"`)
 * and this endpoint answers 200 with that honest result, same as `route-all`
 * does for a per-leg provider failure inside a batch. `fallbackReason` says
 * why (null when the provider's line was kept): the leg alone reads the same
 * for "no road near the campsite" and "the key was refused", and a client
 * that cannot tell them apart can only say "nothing happened".
 * `fallbackDetail` carries the numbers behind an `untrustworthy` refusal
 * (how far the returned line sat from the stops, or its implausible
 * distance) so the client can say how far off the answer was — the owner's
 * Muscat roadtrip (2026-10-13) stayed straight for seven legs and the bare
 * "did not fit" read like the app rejecting a good route, when the provider
 * had actually snapped ~9,500 km away. When that refusal is a WRONG-REGION
 * one (an `anchors` detail whose smaller offset passes `AUTOFETCH_MIN_OFF_KM`
 * — `shouldAutoFetch`), the handler also asks the admin-configured
 * `osrm-autofetch` service (spec 2026-10-13) to fetch the missing map, and
 * carries its answer as `autofetch` beside the reason so the client can say a
 * download is running. With the setting off or the service silent the body is
 * byte-identical to before the feature — the field is absent, never null. A fallback
 * never replaces a leg that is not straight already: a hand-drawn line stays
 * as it was, and the answer carries it unchanged together with the reason.
 */
router.post(
  [
    "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId/route",
    "/tours/:routeId/legs/:fromStopId/:toStopId/route",
  ],
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRouteFromRequest(userId, req);

      const provider: RouteProvider | null = await resolveRouteProvider(userId);
      if (provider === null) {
        throw new AppError(
          "Routing is not configured for this instance — no provider is set up",
          409
        );
      }

      const leg = await findLegOrThrow(routeId, req.params.fromStopId, req.params.toStopId);
      const fromCoord = requireCoords(leg.fromStop, "from");
      const toCoord = requireCoords(leg.toStop, "to");
      const mode = requireLegMode(leg.mode);

      const vehicle = await routeVehicle(routeId);
      const routed = await routeLegGeometry(provider, {
        from: fromCoord,
        to: toCoord,
        mode,
        vehicle,
      });
      // A fallback replaces only a straight line. A drawn, adopted or earlier
      // routed line is closer to the road than the chord a failed attempt
      // would write over it, and nobody asked for it to go.
      if (routed.fallbackReason === null || leg.source === "straight") {
        await applyRoutedLeg(leg.id, routed);
      }

      const updated = await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } });

      // A wrong-region refusal (the provider snapped hundreds of km away)
      // gets ONE best-effort question to the auto-fetch service, whose answer
      // rides beside the reason on this same body. Off, silent, or after its
      // 2.5 s timeout, the response below is exactly today's — the field is
      // absent, never null.
      const autofetch = shouldAutoFetch(routed.fallbackDetail)
        ? await maybeAutoFetch(await readAutoFetchUrl(), fromCoord, toCoord)
        : null;

      logger.info({
        operation: "tour.leg.route",
        legId: updated.id,
        providerId: provider.id,
        source: updated.source,
        confidence: updated.confidence,
        fallbackReason: routed.fallbackReason,
        autofetchStatus: autofetch?.status ?? null,
      });
      res.json({
        leg: toLegDto(updated),
        fallbackReason: routed.fallbackReason,
        fallbackDetail: routed.fallbackDetail,
        ...(autofetch ? { autofetch } : {}),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /trips/:id/routes/:routeId/route-all
 *
 * Routes every routable leg of a section in one call. Unlike the single-leg
 * endpoint above, an unconfigured provider does NOT 409 here — a bulk
 * "route everything" action degrades to "every routable leg falls back to
 * its straight chord", which is exactly what `routeLegGeometry(null, …)`
 * already does deliberately (see its own doc comment). Failing the whole
 * batch because routing is not configured would be a worse outcome for a
 * multi-leg section than silently leaving every leg as an honest chord; the
 * response's `routedCount`/`skippedCount` make what happened legible either
 * way.
 *
 * - A leg whose mode `isRoutableMode` rejects (ferry, rail) is left
 *   completely untouched and counted in `skippedCount` — it is never even
 *   handed to `routeLegGeometry`, so a stray provider quirk can never turn a
 *   ferry crossing into a road detour.
 * - Every other leg is counted in `routedCount` when the provider's line
 *   was kept (`source: "routed"`), and in `fallbackCount` when it fell back
 *   to a straight chord (`source: "straight"`, `confidence: "low"`).
 *   `routedCount` used to count both, so a tour whose every leg failed
 *   reported "5 legs processed" and looked routed (2026-09-26).
 *   `fallbackReason` is the first fallback's cause, null when none fell back,
 *   with that same leg's `fallbackDetail` (the numbers behind an
 *   `untrustworthy` refusal, null for every other cause) beside it. When that
 *   first refusal is a WRONG-REGION one, the batch also asks the
 *   `osrm-autofetch` service once — with the FIRST fallback leg's own points —
 *   and carries its answer as `autofetch` beside those numbers, so the
 *   message and the download always describe one leg (spec 2026-10-13 §2.4).
 *
 * Each leg is routed and persisted sequentially rather than in one
 * transaction: a provider call is a network round trip, and holding a
 * database transaction open across several of those (a section can have
 * many legs) would tie up a connection for however long the slowest
 * provider call takes. A partial failure partway through must not roll back
 * the legs already routed — those results are real and worth keeping.
 */
router.post(
  ["/trips/:id/routes/:routeId/route-all", "/tours/:routeId/route-all"],
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRouteFromRequest(userId, req);

      const provider = await resolveRouteProvider(userId);

      const legs = await prisma.tripRouteLeg.findMany({
        where: { routeId },
        orderBy: { fromStop: { routeOrderIdx: "asc" } },
        include: {
          fromStop: { select: { lat: true, lon: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });

      const vehicle = await routeVehicle(routeId);
      let routedCount = 0;
      let skippedCount = 0;
      let fallbackCount = 0;
      let fallbackReason: RouteFallbackReason | null = null;
      let fallbackDetail: RouteFallbackDetail | null = null;
      let autofetch: AutoFetchStatus | null = null;

      for (const leg of legs) {
        const mode = requireLegMode(leg.mode);
        if (!isRoutableMode(mode)) {
          skippedCount++;
          continue;
        }

        const fromCoord = requireCoords(leg.fromStop, "from");
        const toCoord = requireCoords(leg.toStop, "to");
        const routed = await routeLegGeometry(provider, {
          from: fromCoord,
          to: toCoord,
          mode,
          vehicle,
        });
        await applyRoutedLeg(leg.id, routed);
        if (routed.fallbackReason === null) {
          routedCount++;
        } else {
          fallbackCount++;
          if (fallbackReason === null) {
            fallbackReason = routed.fallbackReason;
            // The detail belongs to the SAME leg as the first cause a client
            // is shown — never a later leg's numbers beside an earlier leg's
            // reason. The auto-fetch question follows the same rule: it is
            // asked for THAT leg's points only, so the batch's one answer and
            // its numbers always describe one leg.
            fallbackDetail = routed.fallbackDetail;
            autofetch = shouldAutoFetch(routed.fallbackDetail)
              ? await maybeAutoFetch(await readAutoFetchUrl(), fromCoord, toCoord)
              : null;
          }
        }
      }

      const [route, savedLegs] = await Promise.all([
        prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId }, include: ROUTE_SELECT }),
        prisma.tripRouteLeg.findMany({
          where: { routeId },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
      ]);

      logger.info({
        operation: "tour.route.routeAll",
        routeId,
        providerId: provider?.id ?? null,
        routedCount,
        skippedCount,
        fallbackCount,
        fallbackReason,
        autofetchStatus: autofetch?.status ?? null,
      });
      res.json({
        route: toDto(route),
        legs: savedLegs.map(toLegDto),
        routedCount,
        skippedCount,
        fallbackCount,
        fallbackReason,
        fallbackDetail,
        ...(autofetch ? { autofetch } : {}),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
