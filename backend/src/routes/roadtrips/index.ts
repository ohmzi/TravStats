import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { createRoadtripSchema } from "../../schemas/roadtrip";
import { travelledKm } from "../../services/tour/tourDistance";
import { describeRoutingAvailability } from "../../services/tour/routing/resolveProvider";
import {
  STATION_DTO_SELECT,
  nightsOf,
  spanOf,
  stationCountries,
  toStationDto,
} from "../../services/roadtrip/roadtripSummary";
import { resolveTrip } from "../trips/resolveTrip";
import { toDto, toLegDto, ROUTE_SELECT } from "../trips/tourRoutes";
import logger from "../../utils/logger";
import { getCountryResolver } from "../../services/geo/countryFromCoordinates";
import stationRoutes from "./stations";
import companionRoutes from "./companion";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";
import { insertRoadtrip } from "../../services/roadtrip/createRoadtrip";
import { EXPENSE_ORDER, EXPENSE_SELECT, toExpenseDto } from "../../services/expenses/expenseDto";
import { roadtripCosts } from "../../services/expenses/roadtripCosts";
import { getBaseCurrency } from "../../services/fx/snapshot";
import { roadtripProgress } from "../../utils/roadtripInsights/progress";
import { loadRoadtripSummaries } from "../../services/roadtrip/roadtripList";

import { z } from "zod";

import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { emailParseLimiter } from "../../middleware/rateLimit";
import { assertLlmCloudConsent, assertLlmEnabled } from "../../services/llm/llmGate";
import {
  checkOllamaAvailable,
  resolveOllamaTarget,
  summariseRoadtrip,
} from "../../services/tripSummaryService";

/**
 * Roadtrips (design 2026-09-24). A roadtrip is a `TripRoute` with
 * `kind = "roadtrip"`: this router owns only what is new — the list, the
 * detail with stations and their stays, creation, and the station list
 * (`./stations.ts`). Everything a roadtrip shares with a tour — legs,
 * routing, tracks, geometry, rename, delete — is served by the kind-agnostic
 * `/tours/:routeId/*` family, which is the point of one engine.
 *
 * Middleware is PER ROUTE, never `router.use()`: a router-level
 * `authenticate` mounted at `/api/v1` would swallow every later mount's
 * requests (the phase-1 bug that 401'd the public pairing endpoints).
 */
const router = Router();
// The phone's routes first: `/roadtrips/active` must not reach `/roadtrips/:id`.
router.use(companionRoutes);

/**
 * A figure summed over a tour's recordings, or null unless EVERY recording
 * carries it: two watches on one hike, one without a barometer, climbed more
 * than the one that measured — a partial sum passes a part off as the whole.
 */
function sumOverEvery(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((sum, v) => sum + v, 0);
}

/** GET /roadtrips — newest first by the span the stations cover. */
router.get(
  "/roadtrips",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roadtrips = await loadRoadtripSummaries(req.userId!);
      res.json({ roadtrips });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /roadtrips — optionally inside a trip the caller owns. */
router.post(
  "/roadtrips",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { tripId, ...body } = createRoadtripSchema.parse(req.body);
      if (tripId != null) await resolveTrip(userId, tripId);

      // A transaction of its own: the photo trip builder calls `insertRoadtrip`
      // inside the one transaction that also writes the trip.
      const route = await prisma.$transaction((tx) =>
        insertRoadtrip(tx, userId, { ...body, tripId: tripId ?? null })
      );
      logger.info({ operation: "roadtrip.create", routeId: route.id, tripId: tripId ?? null });
      res.status(201).json({ roadtrip: toDto(route) });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /roadtrips/:id — the roadtrip, its stations with their stays, legs, day tours and costs. */
router.get(
  "/roadtrips/:id",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const id = await resolveRoadtrip(userId, req.params.id);

      const [route, stations, legs, tours, routing, expenseRows, base] = await Promise.all([
        prisma.tripRoute.findUniqueOrThrow({
          where: { id },
          include: {
            ...ROUTE_SELECT,
            trip: {
              select: {
                id: true,
                name: true,
                // The journey's Immich albums, so the roadtrip page can offer
                // an entry point to them. The album belongs to the TRIP, not to
                // this section — a roadtrip can move between trips — so it is
                // read through the trip rather than linked here.
                immichAlbums: {
                  // Every field the journey's `LinkedAlbum` carries (template
                  // spec §3, Gallery): the trip's Gallery tab resolves the
                  // trip's own album from these rows and renders it through
                  // `ImmichAlbumSection`, which reads `mode`,
                  // `thumbnailAssetId`, `sortIdx` and `lastSyncedAt` besides
                  // the names. A four-field copy would badge an imported album
                  // as "linked" and offer no resync.
                  select: {
                    id: true,
                    immichAlbumId: true,
                    albumName: true,
                    assetCount: true,
                    thumbnailAssetId: true,
                    mode: true,
                    sortIdx: true,
                    lastSyncedAt: true,
                  },
                  orderBy: { sortIdx: "asc" },
                },
              },
            },
          },
        }),
        prisma.tripStop.findMany({
          where: { routeId: id },
          orderBy: { routeOrderIdx: "asc" },
          select: STATION_DTO_SELECT,
        }),
        prisma.tripRouteLeg.findMany({
          where: { routeId: id },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
        prisma.tripRoute.findMany({
          where: { userId, kind: "tour", anchorStop: { routeId: id } },
          select: {
            id: true,
            name: true,
            activity: true,
            anchorStopId: true,
            legs: { select: { distanceKm: true } },
            tracks: {
              select: {
                distanceKm: true,
                ascentM: true,
                movingSeconds: true,
                startedAt: true,
                source: true,
              },
              orderBy: { startedAt: "asc" },
            },
          },
        }),
        describeRoutingAvailability(userId),
        prisma.tripExpense.findMany({
          where: { userId, routeId: id },
          select: EXPENSE_SELECT,
          orderBy: EXPENSE_ORDER,
        }),
        getBaseCurrency(userId),
      ]);
      const expenses = expenseRows.map(toExpenseDto);

      const nights = nightsOf(stations);
      const resolver = await getCountryResolver();
      res.json({
        countries: stationCountries(stations, resolver),
        roadtrip: toDto(route),
        trip: route.trip,
        // `route` carries every scalar (the include adds relations only), so
        // its own days are the span's other input (owner 2026-10-13).
        ...spanOf(stations, route),
        nights,
        stations: stations.map(toStationDto),
        legs: legs.map(toLegDto),
        tours: tours.map((t) => ({
          id: t.id,
          name: t.name,
          activity: t.activity,
          anchorStopId: t.anchorStopId,
          // A day tour is measured by its recording; legs only when it has none.
          distanceKm:
            t.tracks.length > 0
              ? t.tracks.reduce((sum, tr) => sum + tr.distanceKm, 0)
              : travelledKm(t.legs),
          ascentM: sumOverEvery(t.tracks.map((tr) => tr.ascentM)),
          movingSeconds: sumOverEvery(t.tracks.map((tr) => tr.movingSeconds)),
          startedAt: t.tracks[0]?.startedAt ?? null,
          source: t.tracks[0]?.source ?? null,
        })),
        routingAvailable: routing.configured,
        // Driven against planned, by the statistics' own timeline rule, and
        // what the kilometres were measured on (forgejo#179).
        progress: roadtripProgress(stations, legs, new Date()),
        // Money spent on the way (forgejo#140): the list, and its sums per
        // station, per station-to-station leg and in total — per currency.
        expenses,
        costs: roadtripCosts(stations, expenses, base),
        // The roadtrip's own AI summary (spec 2026-10-12 §6): the columns the
        // regenerate route writes, read straight off the row. The page shows
        // them below its map, with Regenerate.
        summary: route.summary,
        summarySource: route.summarySource,
        summaryGeneratedAt: route.summaryGeneratedAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ─────────── LLM summary (spec 2026-10-12 §6) ─────────── */

/**
 * The reader's language travels with the request, exactly as on the journey's
 * own route (`trips.ts`): the server keeps no per-user language.
 */
const summarizeBodySchema = z.object({
  language: z.enum(["de", "en"]).optional(),
});

/**
 * POST /roadtrips/:id/summarize — generate + persist the roadtrip's own
 * summary, the journey's route one level down (spec 2026-10-12 §6).
 *
 * Refused for the SHARED demo account for the same reason as there: the target
 * below is the OPERATOR's Ollama, lent to every account on the instance. A
 * tour's id is "not found" (`resolveRoadtrip`), never a summary of a page that
 * has none — and the answer carries no `summaryEntryCount`, because
 * `trip_routes` has the three columns of spec §6 and no entry-count column.
 */
router.post(
  "/roadtrips/:id/summarize",
  authenticate,
  rejectDemo,
  requireWriteScope,
  emailParseLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveRoadtrip(userId, req.params.id);

      const parsed = summarizeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const language = parsed.data.language ?? "de";

      // Switched off by the admin: refused as LLM_DISABLED before any probe,
      // so the client can tell "turned off" from "unreachable" below.
      await assertLlmEnabled();
      // The admin's provider (parser settings), then the environment — the
      // same resolution the parsers and the journey's summary use.
      const target = await resolveOllamaTarget();
      // A cloud provider without the admin's consent is refused before the
      // probe, with its own code — the brief is personal travel data.
      await assertLlmCloudConsent(target);
      const ollamaUp = await checkOllamaAvailable(target);
      if (!ollamaUp) {
        throw new AppError(
          "LLM service unavailable. Configure the AI provider under Admin → Parser and ensure the model is available.",
          503
        );
      }

      const result = await summariseRoadtrip(req.params.id, userId, { language, target });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.use(stationRoutes);

export default router;
