import { z } from "zod";

import { tripStopTimesSchema } from "../../schemas/times";
import { registry } from "./registry";

/**
 * A roadtrip station on its trip's timeline, as `GET /trips/{id}` lists it in
 * `roadtripStations` (photo trip builder, spec 2026-10-09 §E).
 *
 * The time columns are the legacy mirror of `times`, exactly as on a timeline
 * stop (`TripStop`), so the time-shape ratchet lets them through.
 */
export const tripRoadtripStationResponse = registry.register(
  "TripRoadtripStation",
  z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      startDate: z
        .string()
        .datetime()
        .nullable()
        .describe("Legacy: the first night's day as UTC midnight. Read `times.start`."),
      endDate: z.string().datetime().nullable(),
      startUtc: z.string().datetime().nullable(),
      endUtc: z.string().datetime().nullable(),
      stopZone: z.string().nullable(),
      precision: z.string().nullable(),
      times: tripStopTimesSchema,
      notes: z.string().nullable(),
      routeId: z.string().uuid().describe("The roadtrip the station belongs to"),
      routeName: z.string(),
      routeOrderIdx: z.number().int().nullable(),
      state: z.enum(["stay", "free", "pass"]),
      nights: z
        .number()
        .int()
        .describe("This station's own nights (`countRoadtripNights`); 0 for a pass-through"),
    })
    .openapi("TripRoadtripStation")
);
