/**
 * The point list of a tour that belongs to no trip (and of a day tour that
 * joined a trip and kept points of its own — acceptance D5) — documented
 * apart from the rest of the tour section endpoints for the reason
 * `./tourIndex.ts` already records: `./tours.ts` sat at its 800-line ceiling,
 * and the router side is split the same way (`routes/trips/tourPoints.ts` is
 * its own router beside `routes/trips/tourRoutes.ts`).
 *
 * The one endpoint here answers under both spellings, so the paths are
 * registered from a list rather than through `registerSectionPath`, whose
 * trip-less twin only drops the `id` param.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { tourPointsSchema } from "../../../schemas/tour";
import { tourLeg, tourRoute, tourStop } from "./tours";

const tourPointsInput = registry.register(
  "TourPointsInput",
  tourPointsSchema.openapi("TourPointsInput", {
    example: {
      points: [
        { title: "Gjendesheim", lat: 61.4948, lon: 8.8054 },
        { title: "Besseggen", lat: 61.5024, lon: 8.7311 },
      ],
    },
  })
);

const tourPointsPaths = [
  { path: "/tours/{routeId}/points", params: z.object({ routeId: z.string().uuid() }) },
  {
    path: "/trips/{id}/routes/{routeId}/points",
    params: z.object({ id: z.string().uuid(), routeId: z.string().uuid() }),
  },
] as const;

for (const { path, params } of tourPointsPaths) registerTourPoints(path, params);

function registerTourPoints(path: string, params: z.ZodObject<z.ZodRawShape>): void {
  registry.registerPath({
    method: "put",
    path,
    summary: "Replace a tour's own points",
    description:
      "The complete, ordered point list, written in one go: added, moved, " +
      "removed and renumbered together. A section built from a TRIP's timeline " +
      "stops is assigned instead (`PUT /trips/{id}/routes/{routeId}/stops`) and " +
      "this endpoint refuses it with 409 `TOUR_POINTS_FROM_TRIP`. A day tour that " +
      "joined a trip keeps points of its own and stays editable here, also as " +
      "`PUT /trips/{id}/routes/{routeId}/points`.",
    tags: ["Tours"],
    request: {
      params,
      body: { content: { "application/json": { schema: tourPointsInput } } },
    },
    responses: {
      200: {
        description: "The tour, its points in order, and the recomputed legs",
        content: {
          "application/json": {
            schema: z.object({
              route: tourRoute,
              stops: z.array(tourStop),
              legs: z.array(tourLeg),
            }),
          },
        },
      },
      400: { description: "Validation failed", content: errorContent },
      404: { description: "Tour not found", content: errorContent },
      409: {
        description: "The tour is built from its trip's stops (code TOUR_POINTS_FROM_TRIP)",
        content: errorContent,
      },
    },
  });
}
