/**
 * Request validation for `/api/v1/trip-builder` (spec 2026-10-09 §F).
 *
 * Shape and self-consistency only. What needs the stored draft — a night that
 * names a station the draft offered, the window the scan used, the flights it
 * listed — is checked by `services/tripBuilder/commitPlan.ts`, which answers
 * with its own 400/409 codes.
 *
 * Days are pattern strings, never `format: date`: the OpenAPI time-shape
 * ratchet refuses dated fields (§F).
 */
import { z } from "./zod";
import { createTripSchema } from "./trip";
import { daysBetween, isLocalDate } from "../shared/time/localDate";
import { ROADTRIP_VEHICLES } from "../shared/tour/roadtrip";
import { NIGHT_SPECIALS } from "../shared/tour/builderNightPlan";
import {
  MAX_AREAS,
  MAX_COMMIT_FLIGHTS,
  MAX_PHOTO_JOURNEYS,
  MAX_PREVIEWS,
  MAX_STATIONS_PER_AREA,
  MAX_WINDOW_DAYS,
} from "../services/tripBuilder/thresholds";
import {
  AREA_CHOICES,
  BUILDER_LEG_MODES,
  STATION_KINDS,
  type ScanInput,
} from "../services/tripBuilder/types";

const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const STATION_KEY_PATTERN = "^-?\\d+\\|-?\\d+\\|\\d{4}-\\d{2}-\\d{2}(?:~\\d+)?$";
const AREA_KEY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}#\\d+$";

const uuid = z.string().uuid();
const label = z.string().trim().min(1).max(200);
const countryCodes = z.array(z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2")).max(60);

/** A calendar day `YYYY-MM-DD` that exists (no 2031-02-30). */
export const builderDaySchema = z
  .string()
  .regex(new RegExp(DAY_PATTERN))
  .refine(isLocalDate, "Not a calendar day")
  .openapi({ example: "2031-05-02" });

/** `round(lat/0.05)|round(lon/0.05)|firstDay`, `~n` on a repeat (`stations.ts` `stationKeyOf`). */
export const stationKeySchema = z
  .string()
  .regex(new RegExp(STATION_KEY_PATTERN))
  .openapi({ example: "-901|3374|2031-05-02" });

/** `<startDay>#<n>` (`areas.ts` `areaKeyOf`). */
export const areaKeySchema = z
  .string()
  .regex(new RegExp(AREA_KEY_PATTERN))
  .openapi({ example: "2031-05-02#1" });

/** A night's answer: a station key, or `home` / `unknown` / `flight`. */
export const nightAssignSchema = z.union([z.enum(NIGHT_SPECIALS), stationKeySchema]);

/**
 * Why a window is not one, or null. Guarded on purpose: zod 4 runs a
 * refinement even after a field's own check failed, and `daysBetween` throws
 * on a string that is not a day.
 */
function windowIssue(startDay: string, endDay: string): string | null {
  if (!isLocalDate(startDay) || !isLocalDate(endDay)) return null;
  if (endDay < startDay) return "endDay must not precede startDay";
  if (daysBetween(startDay, endDay) + 1 > MAX_WINDOW_DAYS) {
    return `A scan covers at most ${MAX_WINDOW_DAYS} days`;
  }
  return null;
}

export const scanTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }).strict(),
  z.object({ kind: z.literal("existing"), tripId: uuid }).strict(),
]);

/** `POST /trip-builder/scan`. */
export const scanBodySchema = z
  .object({
    name: label,
    startDay: builderDaySchema,
    endDay: builderDaySchema,
    inspect: z.boolean(),
    createAlbum: z.boolean(),
    target: scanTargetSchema,
  })
  .strict()
  .superRefine((body, ctx) => {
    const issue = windowIssue(body.startDay, body.endDay);
    if (issue) ctx.addIssue({ code: "custom", path: ["endDay"], message: issue });
    if (!body.inspect && !body.createAlbum) {
      ctx.addIssue({
        code: "custom",
        path: ["inspect"],
        message: "Turn on inspect, createAlbum or both",
      });
    }
  });

export const commitStationSchema = z
  .object({
    key: stationKeySchema,
    title: label,
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    kind: z.enum(STATION_KINDS),
    firstDay: builderDaySchema,
    lastDay: builderDaySchema,
    notes: z.string().max(5000).nullish(),
  })
  .strict();

export const commitAreaSchema = z
  .object({
    key: areaKeySchema,
    as: z.enum(AREA_CHOICES),
    name: label,
    vehicle: z.enum(ROADTRIP_VEHICLES).default("car"),
    homeStart: z.boolean(),
    homeEnd: z.boolean(),
    stations: z.array(commitStationSchema).max(MAX_STATIONS_PER_AREA),
    /** legModes[i] joins stations[i] and stations[i + 1]. */
    legModes: z.array(z.enum(BUILDER_LEG_MODES)).max(MAX_STATIONS_PER_AREA - 1),
  })
  .strict();

export const commitTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new"), trip: createTripSchema }).strict(),
  z
    .object({
      kind: z.literal("existing"),
      tripId: uuid,
      applyWindow: z.boolean(),
      countries: countryCodes.optional(),
    })
    .strict(),
]);

/** `POST /trip-builder/drafts/:id/commit`. Every area is sent, `skip` ones included. */
export const commitBodySchema = z
  .object({
    commitKey: uuid,
    window: z.object({ startDay: builderDaySchema, endDay: builderDaySchema }).strict(),
    target: commitTargetSchema,
    flightIds: z.array(uuid).max(MAX_COMMIT_FLIGHTS),
    nights: z.record(z.string().regex(new RegExp(DAY_PATTERN)), nightAssignSchema),
    areas: z.array(commitAreaSchema).max(MAX_AREAS),
    photoJourneyIds: z.array(uuid).max(MAX_PHOTO_JOURNEYS),
    album: z.object({ create: z.boolean(), name: label }).strict(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const flag = (path: Array<string | number>, message: string): void => {
      ctx.addIssue({ code: "custom", path, message });
    };
    const issue = windowIssue(body.window.startDay, body.window.endDay);
    if (issue) flag(["window", "endDay"], issue);
    if (Object.keys(body.nights).length > MAX_WINDOW_DAYS) {
      flag(["nights"], `At most ${MAX_WINDOW_DAYS} nights`);
    }
    const areaKeys = new Set<string>();
    const stationKeys = new Set<string>();
    body.areas.forEach((area, a) => {
      if (areaKeys.has(area.key)) flag(["areas", a, "key"], "An area key may appear once");
      areaKeys.add(area.key);
      if (area.legModes.length !== Math.max(0, area.stations.length - 1)) {
        flag(["areas", a, "legModes"], "One leg mode per consecutive pair of stations");
      }
      area.stations.forEach((station, s) => {
        if (stationKeys.has(station.key)) {
          flag(["areas", a, "stations", s, "key"], "A station key may appear once");
        }
        stationKeys.add(station.key);
        const dated = isLocalDate(station.firstDay) && isLocalDate(station.lastDay);
        if (dated && station.lastDay < station.firstDay) {
          flag(["areas", a, "stations", s, "lastDay"], "A station cannot end before it starts");
        }
      });
      if (area.as === "roadtrip") {
        const first = area.stations[0];
        const last = area.stations[area.stations.length - 1];
        if (area.homeStart !== (first?.kind === "home")) {
          flag(["areas", a, "homeStart"], "homeStart is on exactly when the first station is home");
        }
        if (area.homeEnd !== (last?.kind === "home")) {
          flag(["areas", a, "homeEnd"], "homeEnd is on exactly when the last station is home");
        }
      }
    });
  });

/** `:id` of every draft route; a draft id is a `randomUUID()`. */
export const draftIdParamSchema = z.string().uuid();
/** `:index` of the preview route; the asset id is `previewAssetIds[index]`, never the request's. */
export const previewIndexParamSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(MAX_PREVIEWS - 1);
/** `?size=` of the preview route; originals are not served here. */
export const previewSizeSchema = z.enum(["thumbnail", "preview"]).default("thumbnail");
/** `POST /trip-builder/trips/:tripId/album`. */
export const albumRetryBodySchema = z.object({ name: label.optional() }).strict();

export type ScanBody = z.infer<typeof scanBodySchema>;
export type CommitBody = z.infer<typeof commitBodySchema>;
export type CommitArea = CommitBody["areas"][number];
export type CommitStation = CommitArea["stations"][number];
export type AlbumRetryBody = z.infer<typeof albumRetryBodySchema>;

/** Compile-time only: what the scan route parses is exactly what the builder takes. */
const _scanBodyIsScanInput = (body: ScanBody): ScanInput => body;
