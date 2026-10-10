/**
 * Trip builder endpoints (spec 2026-10-09 §F): build a trip from the user's
 * Immich photos. Bare response family. Days and local times are pattern
 * strings, not `format: date`, to satisfy the time-shape ratchet.
 */

import { z } from "zod";

import { registry } from "../registry";
import { scanBodySchema } from "../../../schemas/tripBuilder";
import { BUILDER_LEG_MODES, STATION_KINDS } from "../../tripBuilder/types";
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

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: "2031-05-02" });
const localMinute = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  .openapi({ example: "2031-05-02 10:15" });
const stationKey = z
  .string()
  .openapi({
    example: "-901|3374|2031-05-02",
    description: "round(lat/0.05)|round(lon/0.05)|first photo day, `~n` on a repeat",
  });

const draftStation = z.object({
  key: stationKey,
  title: z.string(),
  titleSource: z.enum(["existing", "immich", "geocode", "coords", "airport", "home"]),
  kind: z.enum(STATION_KINDS),
  excursionOf: stationKey.optional(),
  lat: z.number(),
  lon: z.number(),
  snappedKm: z.number().nullable(),
  firstDay: day,
  lastDay: day,
  firstLocal: localMinute.nullable(),
  lastLocal: localMinute.nullable(),
  photoCount: z.number().int(),
  previewIdx: z
    .array(z.number().int())
    .describe("Indexes for `GET /drafts/{id}/preview/{index}/file`; never an asset id"),
  notes: z.string().nullable(),
});
const homeEnd = z.object({
  offered: z.boolean(),
  defaultOn: z.boolean(),
  station: draftStation.optional(),
});
const draftArea = z.object({
  key: z.string().regex(/^\d{4}-\d{2}-\d{2}#\d+$/),
  defaultAs: z.enum(["roadtrip", "stops"]),
  suggestedName: z.string(),
  mainCity: z.string().nullable(),
  startDay: day,
  endDay: day,
  afterFlightId: z.string().uuid().optional(),
  beforeFlightId: z.string().uuid().optional(),
  home: z.object({ start: homeEnd, end: homeEnd, unconfirmed: z.boolean() }),
  stations: z.array(draftStation),
  legs: z
    .array(
      z.object({
        fromKey: stationKey,
        toKey: stationKey,
        chordKm: z.number(),
        routedKm: z.number().nullable(),
        mode: z.enum(BUILDER_LEG_MODES),
        ferryEvidence: z.enum(["router", "seaPhotos", "chip"]).nullable(),
      })
    )
    .describe("legs[i] joins stations[i] and stations[i + 1]"),
});
const noParams = z.object({});
const warning = z.discriminatedUnion("code", [
  z.object({ code: z.literal("truncated"), params: noParams }),
  z.object({
    code: z.literal("possibleUnrecordedFlight"),
    params: z.object({
      fromDay: day,
      toDay: day,
      nearestAirports: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
    }),
  }),
  z.object({ code: z.literal("noRouting"), params: noParams }),
  z.object({ code: z.literal("cannotSnap"), params: noParams }),
  z.object({ code: z.literal("noRoadData"), params: z.object({ stations: z.array(stationKey) }) }),
  z.object({ code: z.literal("roadtripsHidden"), params: noParams }),
  z.object({
    code: z.literal("overlappingTrip"),
    params: z.object({
      name: z.string(),
      startDay: day,
      endDay: day,
      suspiciouslyLong: z.boolean(),
    }),
  }),
  z.object({
    code: z.literal("flightOutsideDates"),
    params: z.object({
      flightId: z.string().uuid(),
      suggestStartDay: day.optional(),
      suggestEndDay: day.optional(),
    }),
  }),
  z.object({ code: z.literal("movementOutsideDates"), params: z.object({ day, km: z.number() }) }),
  z.object({
    code: z.literal("pendingPhotoJourneys"),
    params: z.object({ ids: z.array(z.string().uuid()) }),
  }),
  z.object({ code: z.literal("albumLinkedElsewhere"), params: z.object({ tripName: z.string() }) }),
  z.object({ code: z.literal("homeUnconfirmed"), params: noParams }),
  z.object({
    code: z.literal("emptyWindow"),
    params: z.object({
      checkedFrom: day,
      checkedTo: day,
      partner: z.number().int(),
      trashedNote: z.boolean(),
    }),
  }),
  z.object({ code: z.literal("noLocatedPhotos"), params: noParams }),
]);

export const draftSchema = registry.register(
  "TripBuilderDraft",
  z
    .object({
      id: z.string().uuid(),
      expiresAt: z
        .string()
        .describe(
          "ISO instant; the earlier of two hours after the last read and six hours after the scan"
        ),
      window: z.object({ startDay: day, endDay: day, checkedFrom: day, checkedTo: day }),
      options: z.object({ inspect: z.boolean(), createAlbum: z.boolean() }),
      target: z.union([
        z.object({ kind: z.literal("new") }),
        z.object({ kind: z.literal("existing"), tripId: z.string().uuid(), tripName: z.string() }),
      ]),
      tripName: z.string(),
      countries: z.array(z.string()),
      originLabel: z.string().nullable(),
      destinationLabel: z.string().nullable(),
      stats: z.object({
        assets: z.number().int(),
        images: z.number().int(),
        videos: z.number().int(),
        located: z.number().int(),
        excluded: z.object({
          partner: z.number().int(),
          hiddenLivePart: z.number().int(),
          misdated: z.number().int(),
          inFlight: z.number().int(),
          atSea: z.number().int(),
          unlocated: z.number().int(),
          dayGuessed: z.number().int(),
        }),
        truncated: z.boolean(),
      }),
      flights: z.array(
        z.object({
          id: z.string().uuid(),
          label: z.string(),
          depIata: z.string().nullable(),
          arrIata: z.string().nullable(),
          depLocal: z.string(),
          arrLocal: z.string(),
          precise: z.boolean(),
          currentTrip: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
          defaultAssign: z.boolean(),
          locked: z.boolean(),
          layover: z
            .object({ photoCount: z.number().int(), airportIata: z.string().nullable() })
            .optional(),
        })
      ),
      days: z.array(
        z.object({
          day,
          photos: z.number().int(),
          located: z.number().int(),
          stationKeys: z.array(stationKey),
          flightIds: z.array(z.string().uuid()),
          passedThrough: z.array(
            z.object({ title: z.string(), firstLocal: localMinute, photoCount: z.number().int() })
          ),
        })
      ),
      nights: z.record(
        day,
        z.object({
          assign: z.string().describe("A station key, or `home`, `unknown` or `flight`"),
          reason: z.enum([
            "flight",
            "afterLanding",
            "unknown",
            "ferry",
            "home",
            "nightDrive",
            "lastPhoto",
          ]),
          suggestedStationKeys: z.array(stationKey),
        })
      ),
      areas: z.array(draftArea),
      photoJourneys: z.array(
        z.object({
          id: z.string().uuid(),
          startDay: day,
          endDay: day,
          defaultTick: z.literal(true),
        })
      ),
      album: z
        .object({
          name: z.string(),
          existing: z
            .object({
              immichAlbumId: z.string(),
              assetCount: z.number().int(),
              linkedTripName: z.string().optional(),
            })
            .nullable(),
          assetCount: z.number().int(),
          images: z.number().int(),
          videos: z.number().int(),
          allowed: z.boolean(),
          blockedReason: z
            .enum(["notConfigured", "sharedConnection", "missingScopes", "unverified"])
            .optional(),
          missingScopes: scopes,
        })
        .nullable(),
      warnings: z.array(warning),
    })
    .openapi("TripBuilderDraft")
);

const draftParams = z.object({ id: z.string().uuid() });
const expired = {
  description: "`code` DRAFT_EXPIRED: gone, expired or not the caller's",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/trip-builder/drafts/{id}",
  summary: "Read a scan's draft",
  description:
    "The review page's whole input. No field carries an Immich asset id: a thumbnail is " +
    "`GET /trip-builder/drafts/{id}/preview/{index}/file` with an index from `previewIdx`. " +
    "A read slides the idle expiry.",
  tags: tag,
  request: { params: draftParams },
  responses: {
    200: { description: "The draft", content: { "application/json": { schema: draftSchema } } },
    404: expired,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trip-builder/drafts/{id}",
  summary: "Discard a draft",
  description: "Idempotent. A draft whose commit is running is left to finish.",
  tags: tag,
  request: { params: draftParams },
  responses: { 204: { description: "Discarded (or never there)" } },
});
