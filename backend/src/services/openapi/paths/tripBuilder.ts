/**
 * Trip builder endpoints (spec 2026-10-09 §F): build a trip from the user's
 * Immich photos. Bare response family. Days and local times are pattern
 * strings, not `format: date`, to satisfy the time-shape ratchet.
 */

import { z } from "zod";

import { registry } from "../registry";
import { scanBodySchema } from "../../../schemas/tripBuilder";
import { errorContent } from "./shared";

const tag = ["Trip builder"];
const scopes = z.array(z.string());

export const capabilitiesSchema = registry.register(
  "TripBuilderCapabilities",
  z
    .object({
      immich: z.object({
        configured: z.boolean(),
        source: z.enum(["user", "global", "env"]).nullable(),
        inspect: z.object({
          ok: z.boolean().nullable().describe("Null when the key's permissions could not be read"),
          missingScopes: scopes,
        }),
        album: z.object({
          canCreate: z.boolean().nullable(),
          reason: z
            .enum(["notConfigured", "sharedConnection", "missingScopes", "unverified"])
            .nullable(),
        }),
      }),
      roadtrips: z.boolean().describe("Roadtrips are visible for this user"),
      routing: z.object({ available: z.boolean(), canProbe: z.boolean() }),
      home: z.object({ known: z.boolean(), confirmed: z.boolean() }),
    })
    .openapi("TripBuilderCapabilities")
);

registry.registerPath({
  method: "get",
  path: "/trip-builder/capabilities",
  summary: "What the trip builder can do for this user",
  description:
    "Whether Immich is connected, whether the user's own key may inspect and create albums, " +
    "whether roadtrips are visible, whether the instance can route and probe, and whether a " +
    "home is known. Asks Immich with a four-second timeout; never cached. A shared connection " +
    "is not asked for its key.",
  tags: tag,
  responses: {
    200: {
      description: "Capabilities",
      content: { "application/json": { schema: capabilitiesSchema } },
    },
    401: { description: "Not signed in", content: errorContent },
  },
});

const jobStarted = z.object({ jobId: z.string().uuid() });

registry.registerPath({
  method: "post",
  path: "/trip-builder/scan",
  summary: "Scan the Immich library for a trip",
  description:
    "Starts a read-only scan job and answers 202 at once. The job result is `{draftId}`; " +
    "read the draft with `GET /trip-builder/drafts/{id}`. Nothing is written to TravStats " +
    "or Immich. The window is at most 62 days and at least one of `inspect` and " +
    "`createAlbum` must be on. Shares the import rate limit.",
  tags: tag,
  request: { body: { content: { "application/json": { schema: scanBodySchema } } } },
  responses: {
    202: { description: "The scan job", content: { "application/json": { schema: jobStarted } } },
    400: { description: "Invalid input", content: errorContent },
    404: { description: "The target trip is not the caller's", content: errorContent },
    409: { description: '`{error: "notConfigured"}`: no Immich connection', content: errorContent },
    429: { description: "Too many scans", content: errorContent },
  },
});
