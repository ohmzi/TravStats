/**
 * The re-sync fields of the trip builder's responses, as zod fragments
 * (spec 2026-10-09 §K). `paths/tripBuilder.ts` `.extend()`s them into the draft,
 * commit-result and album-outcome schemas, so the documented shapes cannot drift
 * from `types.ts`. Day strings are patterns, never `format: date` (time-shape ratchet).
 */
import { z } from "../../schemas/zod";
import { NOT_SEEN_REASONS, STATION_STATUSES } from "../tripBuilder/existingTypes";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const diff = z.object({
  updated: z.number().int(),
  unchanged: z.number().int(),
  added: z.number().int(),
  removed: z.number().int(),
  kept: z.number().int(),
});

/** Extends the draft station schema. */
export const existingStationFields = {
  status: z.enum(STATION_STATUSES).optional(),
  existingId: z.string().uuid().optional(),
  before: z
    .object({
      startDate: day.nullable(),
      endDate: day.nullable(),
      slept: z.boolean(),
      stay: z.boolean(),
    })
    .optional(),
  notSeen: z.object({ defaultKeep: z.boolean(), reason: z.enum(NOT_SEEN_REASONS) }).optional(),
};

/** Extends the draft area schema; pass the draft station schema. */
export const existingAreaFields = (station: z.ZodType) => ({
  roadtripId: z.string().uuid().optional(),
  notSeen: z.array(station).optional(),
  leftOut: z
    .array(
      z.object({
        key: z.string(),
        title: z.string(),
        firstDay: day,
        lastDay: day,
        routeId: z.string().uuid(),
        routeName: z.string(),
      })
    )
    .optional()
    .describe(
      "Route-scoped only: stops of the window's photos that also stand on another roadtrip of the journey. The scan leaves them out of the route and the review shows the skip"
    ),
});

/** Extends the draft stopover schema. */
export const existingStopoverFields = {
  stored: z
    .object({
      roadtripId: z.string().uuid(),
      name: z.string(),
      albumAssetCount: z
        .number()
        .int()
        .nullable()
        .describe("The linked city album's member count; null when none is linked or not read"),
    })
    .optional()
    .describe("Re-sync only: the stored roadtrip this stopover is already synced to"),
};

/** Extends the draft area's pitstop object. */
export const existingPitstopFields = {
  stored: z
    .object({
      albumAssetCount: z
        .number()
        .int()
        .describe("The linked album's member count when the scan read it"),
      photoCount: z
        .number()
        .int()
        .describe(
          "The area's own photo count now: its movement and at-sea photos, the list the album takes; the review shows it beside the synced count"
        ),
    })
    .optional()
    .describe(
      "Re-sync only: the user's own linked album of exactly this pitstop's name; when set, the review locks the album switch, marked as already synced"
    ),
};

/** Extends the draft album schema. */
export const existingAlbumFields = {
  sync: z
    .object({
      target: z.enum(["linked", "byName", "create"]),
      toAdd: z.number().int(),
      alreadyIn: z.number().int(),
      removable: z.object({
        count: z.number().int(),
        defaultOn: z.boolean(),
        allowed: z.boolean(),
        missingScope: z.string().optional(),
      }),
    })
    .optional(),
};

/** Extends the draft schema; pass the draft station schema. */
export const existingDraftFields = (station: z.ZodType) => ({
  notSeenStops: z.array(station).optional(),
});

/** Extends the album-outcome schema. */
export const existingOutcomeFields = {
  removed: z.number().int().optional(),
  removeSkipped: z.enum(["missingScope", "albumChanged", "failed"]).optional(),
};

/** Extends the per-roadtrip summary of the commit result. */
export const existingRoadtripSummaryFields = { diff: diff.optional() };

/** Extends the commit result. */
export const existingResultFields = { stops: diff.optional() };
