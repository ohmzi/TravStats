/**
 * What an existing trip holds right now, for a re-sync (spec 2026-10-09 §K.2):
 * its roadtrips with their stations and legs, the timeline stops a re-sync may
 * touch, the flights already on it and the albums linked to it.
 *
 * Read twice per re-sync — when the scan builds the draft, and again when the
 * commit validates it — so the commit can refuse a draft the trip has moved
 * past (`TRIP_CHANGED`) instead of deleting rows the draft never saw.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { Prisma } from "../../prisma";
import { stationState } from "../../shared/tour/roadtrip";
import logger from "../../utils/logger";
import { stationTimes } from "../roadtrip/timesDto";
import { tripStopTimes, tripTimes } from "../trips/timesDto";
import type {
  ExistingAlbumLink,
  ExistingStation,
  ExistingStop,
  ExistingTripState,
} from "./existingTypes";

/** Is this album the user's own, and did TravStats write its description? null: Immich could not say. */
export type AlbumDescriber = (
  immichAlbumId: string
) => Promise<{ ownedByUser: boolean; travstatsMarker: boolean } | null>;

const STATION_FIELDS = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  startDate: true,
  endDate: true,
  startUtc: true,
  endUtc: true,
  stopZone: true,
  notes: true,
  overnight: true,
  viaPoint: true,
  lodgingStayId: true,
  placeId: true,
} satisfies Prisma.TripStopSelect;

const STOP_FIELDS = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  notes: true,
  startDate: true,
  endDate: true,
  startUtc: true,
  endUtc: true,
  stopZone: true,
  precision: true,
} satisfies Prisma.TripStopSelect;

type StationRow = Prisma.TripStopGetPayload<{ select: typeof STATION_FIELDS }>;
type StopRow = Prisma.TripStopGetPayload<{ select: typeof STOP_FIELDS }>;

/** Roadtrip stations always have coordinates (`recomputeLegs` refuses a route stop without one); this narrows the type. */
function toStation(row: StationRow): ExistingStation[] {
  if (row.lat === null || row.lon === null) return [];
  const times = stationTimes(row);
  return [
    {
      id: row.id,
      title: row.title,
      lat: row.lat,
      lon: row.lon,
      startDate: times.start?.date ?? null,
      endDate: times.end?.date ?? null,
      night: stationState(row),
      lodgingStayId: row.lodgingStayId,
      placeId: row.placeId,
      notes: row.notes,
    },
  ];
}

function toStop(row: StopRow): ExistingStop[] {
  if (row.lat === null || row.lon === null) return [];
  const times = tripStopTimes(row);
  return [
    {
      id: row.id,
      title: row.title,
      lat: row.lat,
      lon: row.lon,
      startDay: times.start?.local.slice(0, 10) ?? null,
      endDay: times.end?.local.slice(0, 10) ?? null,
      notes: row.notes,
    },
  ];
}

/**
 * The albums linked to the trip in `link` mode, in their stored order. A copied
 * (`import`) album is not a re-sync target: its photos are TravStats' own, and
 * `lastSyncedAt` on it means the last import.
 */
export async function loadAlbumLinks(
  userId: string,
  tripId: string,
  describe?: AlbumDescriber
): Promise<ExistingAlbumLink[]> {
  const rows = await prisma.tripImmichAlbum.findMany({
    where: { tripId, mode: "link", trip: { userId } },
    orderBy: { sortIdx: "asc" },
    select: { id: true, immichAlbumId: true, albumName: true, assetCount: true },
  });
  return Promise.all(
    rows.map(async (row): Promise<ExistingAlbumLink> => {
      const described = describe
        ? await describe(row.immichAlbumId).catch((error: unknown) => {
            logger.warn(
              {
                operation: "tripBuilder.existing.describeAlbum",
                albumId: row.immichAlbumId,
                error: error instanceof Error ? error.message : String(error),
              },
              "Could not read a linked Immich album; it is not offered as the re-sync target"
            );
            return null;
          })
        : null;
      return {
        linkId: row.id,
        immichAlbumId: row.immichAlbumId,
        albumName: row.albumName,
        assetCount: row.assetCount,
        ownedByUser: described?.ownedByUser ?? null,
        travstatsMarker: described?.travstatsMarker ?? null,
      };
    })
  );
}

/**
 * The timeline stops a re-sync may touch: no wrapped entry (`sourceId`), no domain
 * (a hotel, a hike), not in a roadtrip, not a route correction, and placed. Shared
 * with `commitExisting`, which re-runs it inside the write's transaction: a set
 * that moved since the scan must refuse (`TRIP_CHANGED`), not update blind.
 */
export function candidateStopsWhere(tripId: string): Prisma.TripStopWhereInput {
  return {
    tripId,
    routeId: null,
    domain: null,
    sourceId: null,
    viaPoint: false,
    lat: { not: null },
    lon: { not: null },
  };
}

export async function loadExistingState(
  userId: string,
  tripId: string,
  describe?: AlbumDescriber
): Promise<ExistingTripState> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: {
      id: true,
      name: true,
      countries: true,
      startDate: true,
      endDate: true,
      startDay: true,
      endDay: true,
      startZone: true,
      endZone: true,
      flights: { select: { id: true } },
      routes: {
        where: { kind: "roadtrip" },
        orderBy: { orderIdx: "asc" },
        select: {
          id: true,
          name: true,
          stops: { orderBy: { routeOrderIdx: "asc" }, select: STATION_FIELDS },
          legs: { select: { fromStopId: true, toStopId: true, mode: true, source: true } },
        },
      },
    },
  });
  if (!trip) throw new AppError("Trip not found", 404);

  // Stops that belong to other features are not candidates — see `candidateStopsWhere`.
  const [stops, albums] = await Promise.all([
    prisma.tripStop.findMany({
      where: candidateStopsWhere(tripId),
      orderBy: [{ orderIdx: "asc" }, { startDate: "asc" }],
      select: STOP_FIELDS,
    }),
    loadAlbumLinks(userId, tripId, describe),
  ]);

  const times = tripTimes(trip);
  return {
    tripId: trip.id,
    tripName: trip.name,
    startDay: times.start?.date ?? null,
    endDay: times.end?.date ?? null,
    countries: trip.countries,
    roadtrips: trip.routes.map((route) => ({
      id: route.id,
      name: route.name,
      stations: route.stops.flatMap(toStation),
      legs: route.legs,
    })),
    stops: stops.flatMap(toStop),
    flightIds: trip.flights.map((f) => f.id),
    albums,
  };
}
