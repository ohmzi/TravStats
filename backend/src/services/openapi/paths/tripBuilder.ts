/**
 * Trip builder endpoints (spec 2026-10-09 §F): build a trip from the user's
 * Immich photos. Bare response family. Days and local times are pattern
 * strings, not `format: date`, to satisfy the time-shape ratchet.
 */

import { z } from "zod";

import { registry } from "../registry";
import {
  albumRetryBodySchema,
  commitBodySchema,
  scanBodySchema,
} from "../../../schemas/tripBuilder";
import { BUILDER_LEG_MODES, STATION_KINDS } from "../../tripBuilder/types";
import {
  existingAlbumFields,
  existingAreaFields,
  existingDraftFields,
  existingOutcomeFields,
  existingPitstopFields,
  existingResultFields,
  existingRoadtripSummaryFields,
  existingStationFields,
  existingStopoverFields,
} from "../tripBuilderExistingSchemas";
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
const stationKey = z.string().openapi({
  example: "-901|3374|2031-05-02",
  description: "round(lat/0.05)|round(lon/0.05)|first photo day, `~n` on a repeat",
});

const draftStation = z
  .object({
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
  })
  .extend(existingStationFields);
const homeEnd = z.object({
  offered: z.boolean(),
  defaultOn: z.boolean(),
  station: draftStation.optional(),
});
/** One leg between two stations of a draft area or a stopover tour. */
const draftLeg = z.object({
  fromKey: stationKey,
  toKey: stationKey,
  chordKm: z.number(),
  routedKm: z.number().nullable(),
  mode: z
    .enum(BUILDER_LEG_MODES)
    .describe(
      "The mode the review shows and the commit writes; the stored leg's on a re-sync match"
    ),
  derivedMode: z
    .enum(BUILDER_LEG_MODES)
    .optional()
    .describe("Re-sync only: the mode the scan derived, on a leg that updates a stored one"),
  ferryEvidence: z.enum(["router", "seaPhotos", "chip"]).nullable(),
});
/** The album a pitstop area gets (spec 2026-10-11 pitstops §2, §6). */
const draftPitstop = z
  .object({
    albumName: z
      .string()
      .describe(
        "The area's roadtrip row name: the album carries the same string (owner ruling 2026-10-12)"
      ),
  })
  .extend(existingPitstopFields)
  .describe("Present when the area is a pitstop: a multi-day same-airport stay with its own album");
const draftArea = z
  .object({
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
    legs: z.array(draftLeg).describe("legs[i] joins stations[i] and stations[i + 1]"),
    pitstop: draftPitstop.optional(),
  })
  .extend(existingAreaFields(draftStation));
/** The stopover tour of one layover (spec 2026-10-11 §2.3). */
const draftStopover = z
  .object({
    key: z
      .string()
      .describe(
        "`<inFlightId>#<outFlightId>`, stable across scans; outside the area-key namespace"
      ),
    city: z.string(),
    title: z
      .string()
      .describe(
        "The trip's name (<Journey> · <City>, or the journey's name for a one-trip journey): the roadtrip and the album share it"
      ),
    day,
    airportIata: z.string().nullable(),
    photoCount: z.number().int().describe("The whole layover's photo set: the city album's list"),
    outingCount: z.number().int().describe("The photos beyond the threshold: the tour's own set"),
    stations: z.array(draftStation).describe("The tour's stops, the arrival airport first"),
    legs: z.array(draftLeg).describe("legs[i] joins stations[i] and stations[i + 1]"),
  })
  .extend(existingStopoverFields);
const noParams = z.object({});
const warning = z.discriminatedUnion("code", [
  z.object({ code: z.literal("truncated"), params: noParams }),
  z.object({
    code: z.literal("truncatedFlights"),
    params: z
      .object({ count: z.number().int() })
      .describe("Listed flights the commit's cap left out"),
  }),
  z.object({
    code: z.literal("truncatedAreas"),
    params: z.object({ count: z.number().int() }).describe("Areas the commit's cap left out"),
  }),
  z.object({
    code: z.literal("truncatedJourneys"),
    params: z
      .object({ count: z.number().int() })
      .describe("Photo findings the commit's cap left out"),
  }),
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
          locationCarried: z.number().int(),
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
      stopovers: z
        .array(draftStopover)
        .optional()
        .describe("The stopover roadtrips the scan offers; absent when none were found"),
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
        .extend(existingAlbumFields)
        .nullable(),
      warnings: z.array(warning),
    })
    .extend(existingDraftFields(draftStation))
    .openapi("TripBuilderDraft")
);

/** `AlbumOutcome`: phase D's answer and the album-retry job's result. */
const albumOutcome = registry.register(
  "TripBuilderAlbumOutcome",
  z
    .object({
      status: z.enum(["linked", "skipped", "failed", "blocked"]),
      skipReason: z.enum(["notRequested", "noAssets"]).optional(),
      immichAlbumId: z.string().optional(),
      albumName: z.string().optional(),
      reused: z.boolean().optional(),
      added: z.number().int().optional(),
      alreadyIn: z.number().int().optional(),
      refused: z.number().int().optional(),
      error: z
        .object({
          kind: z.enum([
            "unreachable",
            "auth",
            "notFound",
            "protocol",
            "invalidUrl",
            "notConfigured",
            "internal",
          ]),
          missingScope: z.string().optional(),
        })
        .optional(),
      missingScopes: scopes.optional(),
    })
    .extend(existingOutcomeFields)
    .openapi("TripBuilderAlbumOutcome")
);

const commitRoadtripSummary = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    stations: z.number().int(),
    nights: z.number().int(),
  })
  .extend(existingRoadtripSummaryFields);

/** The `tripBuilder.commit` job's result when it wrote (`blocked` is the other answer). */
registry.register(
  "TripBuilderCommitResult",
  z
    .object({
      status: z.literal("committed"),
      tripId: z.string().uuid(),
      created: z.boolean().describe("False for the `existing` target"),
      roadtrips: z.array(commitRoadtripSummary),
      stopIds: z.array(z.string().uuid()),
      flightsAssigned: z.number().int(),
      flightsMovedFrom: z.array(z.object({ tripId: z.string().uuid(), name: z.string() })),
      routing: z.object({
        routed: z.number().int(),
        straight: z.number().int(),
        ferry: z.number().int(),
        providerAvailable: z.boolean(),
      }),
      photoJourneysResolved: z.number().int(),
      unknownNights: z.number().int(),
      album: albumOutcome,
      /** Spec 2026-10-11 §5.4: present when the commit was asked for a stopover's own album. */
      stopoverAlbums: z
        .array(
          z.object({
            key: z.string().describe("The stopover's key, `<inFlightId>#<outFlightId>`"),
            name: z
              .string()
              .describe("The album's name; its retry posts the entry's `key` back (`stopoverKey`)"),
            album: albumOutcome,
          })
        )
        .optional(),
      /** Spec 2026-10-11 pitstops §4: present when the commit was asked for a pitstop area's own album. */
      pitstopAlbums: z
        .array(
          z.object({
            key: z.string().describe("The area's key, `<startDay>#<n>`"),
            name: z
              .string()
              .describe("The album's name; its retry posts the entry's `key` back (`pitstopKey`)"),
            album: albumOutcome,
          })
        )
        .optional(),
    })
    .extend(existingResultFields)
    .openapi("TripBuilderCommitResult")
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

registry.registerPath({
  method: "get",
  path: "/trip-builder/drafts/{id}/preview/{index}/file",
  summary: "Stream one thumbnail of a draft",
  description:
    "The draft is the grant: the caller owns it, and the asset id comes from the draft's " +
    "stored list at the given INDEX (0 to 399), never from the request. Thumbnail or " +
    "preview only. Same private immutable caching and 1x1 placeholder on an upstream " +
    "failure as the other Immich proxies.",
  tags: tag,
  request: {
    params: z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0).max(399) }),
    query: z.object({ size: z.enum(["thumbnail", "preview"]).optional() }),
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    400: { description: "Invalid index, size or id", content: errorContent },
    404: { description: "Draft expired or index past the list", content: errorContent },
    409: { description: '`{error: "notConfigured"}`: no Immich connection', content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trip-builder/drafts/{id}/commit",
  summary: "Create the trip from a reviewed draft",
  description:
    "Validates against the draft without calling Immich, then starts a commit job and " +
    'answers 202. The job result is a `TripBuilderCommitResult` (`status: "committed"`) ' +
    'or `{status:"blocked", reason, missingScopes}`, which wrote nothing. Idempotent ' +
    "per `commitKey`: the same key meets the running job, another key meets 409 " +
    "COMMIT_IN_PROGRESS, and a written trip meets 409 ALREADY_COMMITTED with `tripId`. " +
    "Only flights, findings, areas and stations the draft offered are accepted. For an " +
    "`existing` target, `existingId`, `roadtripId`, `keepNotSeen`/`removeNotSeen`, `stops` and " +
    "`album.removeOutside` update the trip in place; each must name a row the draft offered, " +
    "and no request field carries an Immich asset id.",
  tags: tag,
  request: {
    params: draftParams,
    body: { content: { "application/json": { schema: commitBodySchema } } },
  },
  responses: {
    202: { description: "The commit job", content: { "application/json": { schema: jobStarted } } },
    400: {
      description:
        "`code` VALIDATION_FAILED, NIGHT_PLAN_INVALID (with `reason`, `stationKey`, `day`), " +
        "STATIONS_INVALID or DRAFT_MISMATCH (with `field`)",
      content: errorContent,
    },
    404: expired,
    409: {
      description:
        "`code` WINDOW_CHANGED, ALREADY_COMMITTED (with `tripId`), COMMIT_IN_PROGRESS, " +
        "ROADTRIPS_HIDDEN or TRIP_CHANGED (a station or stop was added, moved or removed since the scan)",
      content: errorContent,
    },
    429: { description: "Too many requests", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trip-builder/trips/{tripId}/album",
  summary: "Retry a trip's Immich album",
  description:
    "Rebuilds the asset list from the trip's own days and links the album. A trip that already " +
    "links an album the user owns re-syncs it (spec §K.3): the linked album is updated — never " +
    "a second one found or made by the posted name — with the outside members recomputed " +
    "server-side and `removeOutside` honoured, so a retry cannot duplicate the album or drop " +
    "the review's removal. Without a linked album the album is found again by its exact owned " +
    "name. While a retry for the trip is still running, another press answers 202 with that " +
    "running job's `jobId` and starts nothing (the running job keeps its name), so a double " +
    "press or a second tab cannot create a second album. A posted `stopoverKey` retries that " +
    "stopover's own album instead (spec 2026-10-11 §5.4): resolved by key against the committed " +
    "draft that wrote the trip, found by its exact owned name, add-only, never the trip's " +
    "album. A key no held committed draft resolves meets 409 STOPOVER_EXPIRED — the layover's " +
    "picture ids exist only in that draft, so the caller scans again; a bare `name` is always " +
    "the trip's album. A posted `pitstopKey` retries a pitstop area's own album instead (spec 2026-10-11 " +
    "pitstops §4): resolved by its area key against the same committed draft — the key, not " +
    "the album's name, because two areas in one city and year share it (review round 2) — " +
    "found by its exact owned name, add-only, never the trip's album; a key no held draft " +
    "resolves meets 409 PITSTOP_EXPIRED. A bare `name` is always the trip's album. " +
    "The job result is a `TripBuilderAlbumOutcome`. Only the user's own " +
    "Immich key may write.",
  tags: tag,
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: { content: { "application/json": { schema: albumRetryBodySchema } } },
  },
  responses: {
    202: { description: "The album job", content: { "application/json": { schema: jobStarted } } },
    400: { description: "Invalid input", content: errorContent },
    404: { description: "Not the caller's trip", content: errorContent },
    409: {
      description:
        "`code` STOPOVER_EXPIRED: a stopover retry whose key no held committed draft " +
        "resolves; PITSTOP_EXPIRED: a pitstop retry whose key none resolves",
      content: errorContent,
    },
    429: { description: "Too many requests", content: errorContent },
  },
});
