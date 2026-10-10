/**
 * Trip builder endpoints (spec 2026-10-09 §F): build a trip from the user's
 * Immich photos. Bare response family. Days and local times are pattern
 * strings, not `format: date`, to satisfy the time-shape ratchet.
 */

import { z } from "zod";

import { registry } from "../registry";
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
