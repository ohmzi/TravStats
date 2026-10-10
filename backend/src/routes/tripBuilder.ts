/**
 * /api/v1/trip-builder: build a trip from the user's Immich photos (spec
 * 2026-10-09 §F). Bare response family (docs/adr/0001-api-response-shape.md):
 * every answer is the resource itself.
 *
 * Limiters. The scan and the commit start heavy work against someone else's
 * server, so they share the existing `immichImportLimiter` bucket with the
 * photo-journey scan and the album import. Capabilities and the thumbnails
 * stream Immich content, so they use `immichProxyLimiter`. Reading, discarding
 * and polling a draft are one in-memory lookup of the caller's own draft and
 * stay unlimited.
 *
 * `rejectDemoWrites`: the shared demo account has no Immich, and what it
 * could write here would be written to everyone's instance.
 */
import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { immichImportLimiter, immichProxyLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { draftIdParamSchema, scanBodySchema } from "../schemas/tripBuilder";
import { getImmichConnection } from "../services/immich/immichResolver";
import { startJob } from "../services/jobs/jobRegistry";
import { buildTripDraft, progressReporter } from "../services/tripBuilder/buildDraft";
import { builderCapabilities } from "../services/tripBuilder/capabilities";
import { deleteDraft, expiresAtOf, getDraft, putDraft } from "../services/tripBuilder/draftStore";
import type { ScanJobResult } from "../services/tripBuilder/types";
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

export default router;
