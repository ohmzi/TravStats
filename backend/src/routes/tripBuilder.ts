/**
 * /api/v1/trip-builder: build a trip from the user's Immich photos (spec
 * 2026-10-09 §F). Bare response family (docs/adr/0001-api-response-shape.md):
 * every answer is the resource itself.
 *
 * Limiters. The scan, the commit and the album retry start heavy work against
 * someone else's server, so they share the existing `immichImportLimiter`
 * bucket with the photo-journey scan and the album import. Capabilities and
 * the thumbnails stream Immich content, so they use `immichProxyLimiter`.
 * Reading, discarding and polling a draft are one in-memory lookup of the
 * caller's own draft and stay unlimited.
 *
 * `rejectDemoWrites`: the shared demo account has no Immich, and what it
 * could write here would be written to everyone's instance.
 */
import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { immichImportLimiter, immichProxyLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { z } from "../schemas/zod";
import {
  albumRetryBodySchema,
  commitBodySchema,
  draftIdParamSchema,
  previewIndexParamSchema,
  previewSizeSchema,
  scanBodySchema,
} from "../schemas/tripBuilder";
import { sendPlaceholder, streamAsset } from "../services/immich/assetStream";
import { createImmichClient } from "../services/immich/immichClient";
import { ImmichError } from "../services/immich/types";
import logger from "../utils/logger";
import { getImmichConnection } from "../services/immich/immichResolver";
import { getJob, startJob } from "../services/jobs/jobRegistry";
import { buildTripDraft, progressReporter } from "../services/tripBuilder/buildDraft";
import { builderCapabilities } from "../services/tripBuilder/capabilities";
import { retryTripAlbum } from "../services/tripBuilder/albumWrite";
import { retryPitstopAlbum } from "../services/tripBuilder/stopoverAlbum";
import { runCommitJob } from "../services/tripBuilder/commit";
import { prepareCommit } from "../services/tripBuilder/commitPlan";
import {
  attachCommitJob,
  beginCommit,
  committedDraftForTrip,
  deleteDraft,
  expiresAtOf,
  getDraft,
  putDraft,
} from "../services/tripBuilder/draftStore";
import type { BeginCommit, ScanJobResult } from "../services/tripBuilder/types";
import { resolveTrip } from "./trips/resolveTrip";

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

router.get(
  "/capabilities",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await builderCapabilities(req.userId!));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Start a scan. Read-only against Immich; nothing is written anywhere. The
 * draft is built by the job and kept in memory; the job's result is its id.
 */
router.post(
  "/scan",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = scanBodySchema.parse(req.body);
      if (!(await getImmichConnection(userId))) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }
      if (body.target.kind === "existing") await resolveTrip(userId, body.target.tripId);

      const job = startJob("tripBuilder.scan", userId, async (reportProgress) => {
        const draft = await buildTripDraft(userId, body, progressReporter(reportProgress));
        putDraft(draft);
        const result: ScanJobResult = { draftId: draft.id };
        return result;
      });
      res.status(202).json({ jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
);

/** Gone, expired, or never the caller's: the three look the same from outside. */
const draftExpired = (): AppError =>
  new AppError("This draft has expired; scan again", 404, "DRAFT_EXPIRED");

router.get("/drafts/:id", (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const draft = getDraft(req.userId!, draftIdParamSchema.parse(req.params.id));
    if (!draft) throw draftExpired();
    res.json({ ...draft.dto, expiresAt: new Date(expiresAtOf(draft)).toISOString() });
  } catch (error) {
    next(error);
  }
});

router.delete("/drafts/:id", (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    deleteDraft(req.userId!, draftIdParamSchema.parse(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Stream one thumbnail of a draft. **The draft is the grant**: the caller owns
 * it, and the asset id comes from the draft's stored list at the requested
 * INDEX, never from the request, so owning a draft cannot be turned into
 * reading the library. Originals are not served here.
 */
router.get(
  "/drafts/:id/preview/:index/file",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const id = draftIdParamSchema.safeParse(req.params.id);
      const index = previewIndexParamSchema.safeParse(req.params.index);
      const size = previewSizeSchema.safeParse(req.query.size);
      if (!id.success || !index.success || !size.success) {
        throw new AppError("Invalid preview request", 400);
      }
      const draft = getDraft(userId, id.data);
      if (!draft) throw draftExpired();
      const assetId = draft.previewAssetIds[index.data];
      if (assetId === undefined) throw new AppError("notFound", 404);

      const etag = `"${assetId}-${size.data}"`;
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      const conn = await getImmichConnection(userId);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }
      await streamAsset(res, createImmichClient(conn), assetId, size.data, etag);
    } catch (error) {
      if (error instanceof ImmichError) {
        logger.warn({ message: "immich_proxy_upstream_failure", context: { kind: error.kind } });
        sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
        return;
      }
      next(error);
    }
  }
);

/** What `beginCommit` said, when it did not say "start": the same answer to every caller. */
function answerCommitState(res: Response, state: BeginCommit): void {
  switch (state.kind) {
    case "inProgress":
      res.status(202).json({ jobId: state.jobId });
      return;
    case "committed":
      throw new AppError("This draft was already committed", 409, "ALREADY_COMMITTED", undefined, {
        tripId: state.result.tripId,
      });
    case "busy":
      throw new AppError("Another commit is running on this draft", 409, "COMMIT_IN_PROGRESS");
    case "missing":
      throw draftExpired();
    default:
      throw new AppError(
        "The draft changed under the commit; try again",
        409,
        "COMMIT_IN_PROGRESS"
      );
  }
}

/**
 * Create the trip from a reviewed draft. The handler is database-only and
 * answers inside the browser's ten seconds; the job does the Immich and
 * routing work. One `commitKey` per review session makes a retry idempotent:
 * the same key meets the same job, another key meets 409, and once the trip is
 * written any key meets 409 ALREADY_COMMITTED with its id.
 */
router.post(
  "/drafts/:id/commit",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const id = draftIdParamSchema.parse(req.params.id);
      const body = commitBodySchema.parse(req.body);
      const draft = getDraft(userId, id);
      if (!draft) throw draftExpired();
      if (draft.status !== "ready") {
        answerCommitState(res, beginCommit(userId, id, body.commitKey));
        return;
      }

      const plan = await prepareCommit(userId, draft, body);
      const begun = beginCommit(userId, id, body.commitKey);
      if (begun.kind !== "start") {
        answerCommitState(res, begun);
        return;
      }
      const job = startJob("tripBuilder.commit", userId, () => runCommitJob(draft, plan));
      attachCommitJob(id, job.id);
      res.status(202).json({ jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
);

const tripIdParamSchema = z.string().uuid();

/**
 * The album job each (user, trip) has running. The retry finds its album by
 * name and then creates it, which is not atomic against Immich, so two jobs
 * for one trip could each find nothing and each create one. A press made while
 * a job runs therefore meets that job. Whether it still runs is asked of the
 * job registry, so nothing here needs clearing: a finished, failed or dropped
 * job simply stops answering "running".
 */
const runningAlbumJobs = new Map<string, string>();

/**
 * Retry a trip's album after it failed or was blocked. The asset list is
 * rebuilt from the trip's own days, so the retry needs no draft. Pressing it
 * again while it runs answers with the running job; its name is the one used.
 *
 * A `stopoverKey` retries that stopover's OWN album (spec 2026-10-11 §5.4):
 * the key resolves against the committed draft that wrote the trip, which
 * knows the stopovers it offered and holds the layover's picture ids — those
 * exist nowhere else. A `pitstopKey` retries a pitstop area's OWN album
 * (spec 2026-10-11-pitstop §4), resolved by its area key against the same
 * committed draft: the key, not the album's name, because two areas in one
 * city and year share that name, and a name-matched retry re-added the first
 * area's pictures while the second area's stayed missing (review round 2). A
 * target no held draft resolves is refused — 409 STOPOVER_EXPIRED or
 * 409 PITSTOP_EXPIRED — never answered by the trip's album. A bare `name` is
 * the trip's album, as always: it is never read as a stopover or a pitstop,
 * because the trip's album name may coincide with theirs. The one per-(user,
 * trip) job key still lets one album job run at a time.
 */
router.post(
  "/trips/:tripId/album",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = tripIdParamSchema.parse(req.params.tripId);
      const body = albumRetryBodySchema.parse(req.body ?? {});
      const trip = await resolveTrip(userId, tripId);
      const held = committedDraftForTrip(userId, tripId);
      const stopover =
        body.stopoverKey === undefined
          ? undefined
          : (held?.stopovers ?? []).find((candidate) => candidate.key === body.stopoverKey);
      if (body.stopoverKey !== undefined && (stopover === undefined || held === null)) {
        throw new AppError(
          "The scan that wrote this stopover's album is no longer held; scan the trip again",
          409,
          "STOPOVER_EXPIRED"
        );
      }
      // The pitstop's record holds the area's picture ids, and its key is what
      // the success panel's line is addressed by; the committed draft is the
      // only place the record exists, so a key nothing resolves is refused,
      // never repaired by another album (the S2 rule).
      const pitstop =
        body.pitstopKey === undefined
          ? undefined
          : (held?.pitstops ?? []).find((candidate) => candidate.key === body.pitstopKey);
      if (body.pitstopKey !== undefined && (pitstop === undefined || held === null)) {
        throw new AppError(
          "The scan that wrote this pitstop's album is no longer held; scan the trip again",
          409,
          "PITSTOP_EXPIRED"
        );
      }

      // No await from here to `set`, so two presses cannot both see "none running".
      const key = `${userId}:${tripId}`;
      const runningId = runningAlbumJobs.get(key);
      if (runningId && getJob(runningId, userId)?.status === "running") {
        res.status(202).json({ jobId: runningId });
        return;
      }
      const job = startJob("tripBuilder.album", userId, () => {
        if (held === null) {
          return retryTripAlbum(userId, tripId, body.name, body.removeOutside ?? false);
        }
        if (stopover !== undefined) {
          return retryPitstopAlbum({
            userId,
            tripId,
            tripName: trip.name,
            album: { name: stopover.title, day: stopover.day, assetIds: stopover.photoIds },
            expectedImmichUserId: held.immichUserId,
          });
        }
        if (pitstop !== undefined) {
          return retryPitstopAlbum({
            userId,
            tripId,
            tripName: trip.name,
            album: { name: pitstop.albumName, day: pitstop.day, assetIds: pitstop.assetIds },
            expectedImmichUserId: held.immichUserId,
          });
        }
        return retryTripAlbum(userId, tripId, body.name, body.removeOutside ?? false);
      });
      runningAlbumJobs.set(key, job.id);
      res.status(202).json({ jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
