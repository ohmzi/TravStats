/**
 * The small database lookups a scan and a commit share (spec 2026-10-09 §C.12,
 * §D): the target trip, trips that overlap the window, pending photo-journey
 * findings, an album linked elsewhere, and the album gate.
 *
 * Every query is scoped by `userId` in the WHERE clause: a foreign key proves a
 * row exists, not whose it is.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { addDays } from "../../shared/tour/builderNightPlan";
import { localDay } from "../../shared/time/instant";
import { fromDbDate, toDbDate } from "../../shared/time/localDate";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import { ALBUM_SCOPES, scopesMissing } from "../immich/immichCapabilities";
import type { ImmichClient } from "../immich/immichClient";
import type { ImmichConnection } from "../immich/types";
import { PHOTO_JOURNEY_PAD_DAYS } from "./thresholds";
import type { Day, DraftAlbum, DraftPhotoJourney, ScanWindow } from "./types";

type DayWindow = Pick<ScanWindow, "startDay" | "endDay">;

export interface TargetTrip {
  id: string;
  name: string;
  countries: string[];
  roadtripNames: string[];
}

export interface OverlapRow {
  id: string;
  name: string;
  startDay: Day;
  endDay: Day;
}

/** The trip an `existing` scan adds to, or null for a new trip; 404 when it is not the caller's. */
export async function loadTargetTrip(
  userId: string,
  tripId: string | null
): Promise<TargetTrip | null> {
  if (tripId === null) return null;
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: {
      id: true,
      name: true,
      countries: true,
      routes: { where: { kind: "roadtrip" }, select: { name: true } },
    },
  });
  if (!trip) throw new AppError("Trip not found", 404);
  return {
    id: trip.id,
    name: trip.name,
    countries: trip.countries,
    roadtripNames: trip.routes.map((route) => route.name),
  };
}

/** The caller's trips whose days overlap the window, `excludeTripId` left out. */
export async function overlappingTripsOf(
  userId: string,
  window: DayWindow,
  excludeTripId: string | null
): Promise<OverlapRow[]> {
  const rows = await prisma.trip.findMany({
    where: {
      userId,
      ...(excludeTripId !== null && { id: { not: excludeTripId } }),
      startDay: { lte: toDbDate(window.endDay) },
      endDay: { gte: toDbDate(window.startDay) },
    },
    orderBy: { startDay: "asc" },
    select: { id: true, name: true, startDay: true, endDay: true },
  });
  return rows.flatMap((row) =>
    row.startDay && row.endDay
      ? [
          {
            id: row.id,
            name: row.name,
            startDay: fromDbDate(row.startDay),
            endDay: fromDbDate(row.endDay),
          },
        ]
      : []
  );
}

/**
 * The instants a finding must lie within to count as overlapping: from the
 * start of S − 1 to the end of E + 1, on UTC day boundaries. A finding's own
 * days are then read in its zone for display.
 */
export function journeyBounds(window: DayWindow): { from: Date; to: Date } {
  return {
    from: toDbDate(addDays(window.startDay, -PHOTO_JOURNEY_PAD_DAYS)),
    to: toDbDate(addDays(window.endDay, PHOTO_JOURNEY_PAD_DAYS + 1)),
  };
}

function findingZone(lat: number, lon: number): string {
  try {
    return zoneOfCoordinates(lat, lon) ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** Pending `trip` findings of the photo scan that lie within [S − 1, E + 1], ticked by default. */
export async function pendingJourneysOf(
  userId: string,
  window: DayWindow
): Promise<DraftPhotoJourney[]> {
  const { from, to } = journeyBounds(window);
  const rows = await prisma.photoJourney.findMany({
    where: {
      userId,
      status: "pending",
      kind: "trip",
      startDate: { gte: from },
      endDate: { lt: to },
    },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true, endDate: true, lat: true, lon: true },
  });
  return rows.map((row) => {
    const zone = findingZone(row.lat, row.lon);
    return {
      id: row.id,
      startDay: localDay(row.startDate, zone),
      endDay: localDay(row.endDate, zone),
      defaultTick: true as const,
    };
  });
}

/** The name of ANOTHER trip of the caller's that already links this Immich album, or null. */
export async function linkedTripNameOf(
  userId: string,
  immichAlbumId: string,
  excludeTripId: string | null
): Promise<string | null> {
  const link = await prisma.tripImmichAlbum.findFirst({
    where: {
      immichAlbumId,
      trip: { userId, ...(excludeTripId !== null && { id: { not: excludeTripId } }) },
    },
    select: { trip: { select: { name: true } } },
  });
  return link?.trip.name ?? null;
}

/**
 * Whether an album may be created with this connection. Only the user's own
 * key may write: a shared (admin or ENV) key would put the album in the
 * operator's account. An unverifiable key is allowed and flagged, because the
 * commit's preflight checks again before anything is written.
 */
export async function albumGateOf(
  conn: ImmichConnection,
  client: Pick<ImmichClient, "getMyApiKey">
): Promise<Pick<DraftAlbum, "allowed" | "blockedReason" | "missingScopes">> {
  if (conn.source !== "user") {
    return { allowed: false, blockedReason: "sharedConnection", missingScopes: [] };
  }
  let key: Awaited<ReturnType<ImmichClient["getMyApiKey"]>>;
  try {
    key = await client.getMyApiKey();
  } catch {
    key = null;
  }
  if (key === null) return { allowed: true, blockedReason: "unverified", missingScopes: [] };
  const missing = scopesMissing(key.permissions, ALBUM_SCOPES);
  return missing.length === 0
    ? { allowed: true, missingScopes: [] }
    : { allowed: false, blockedReason: "missingScopes", missingScopes: missing };
}
