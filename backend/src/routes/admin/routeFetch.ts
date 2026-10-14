import { Router, Response, NextFunction } from "express";

import { AuthRequest } from "../../middleware/auth";
import { readAutoFetchStatus, readAutoFetchUrl } from "../../services/tour/routing/autoFetch";

/**
 * `GET /admin/route-fetch` — the admin progress panel's one read (owner
 * request 2026-10-14). Proxies the host's `osrm-autofetch` `GET /status`.
 *
 * Admin-only and deliberately NOT a new public endpoint (the controller's
 * ruling): the routing configuration lives here, the panel sits beside it,
 * and this mount is undocumented by design (`coverage.ts`'s
 * UNDOCUMENTED_MOUNTS), so it costs no OpenAPI work. A non-admin keeps
 * today's downloading sentence with no link.
 *
 * The service being off or down is never the client's error — the panel has
 * its own states for that, so the answer is always 200 with a flag:
 *   - `{ configured: false }`                — no `routingAutoFetchUrl` set.
 *   - `{ configured: true, reachable: false }` — the service did not answer.
 *   - `{ configured: true, reachable: true, ...snapshot }` — the proxy.
 */
const router = Router();

router.get("/route-fetch", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const url = await readAutoFetchUrl();
    if (!url) {
      res.json({ configured: false });
      return;
    }
    const status = await readAutoFetchStatus(url);
    if (!status) {
      res.json({ configured: true, reachable: false });
      return;
    }
    res.json({ configured: true, reachable: true, ...status });
  } catch (error) {
    next(error);
  }
});

export default router;
