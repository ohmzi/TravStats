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
import { immichProxyLimiter } from "../middleware/rateLimit";
import { builderCapabilities } from "../services/tripBuilder/capabilities";

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

export default router;
