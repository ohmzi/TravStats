/**
 * Creating a trip — one implementation for `POST /trips` and for the photo
 * trip builder's commit (spec 2026-10-09 §D1), which writes the trip in the
 * same transaction as the roadtrips and stops it files on it.
 *
 * Two halves for that reason:
 *  - `prepareTripCreate` does what reads, or has to happen, BEFORE the
 *    transaction: the palette colour, the companions and the status from the
 *    trip's own dates.
 *  - `insertTrip` writes the trip row and its companion links with the `tx`
 *    it is handed, so a rollback takes both.
 *
 * Companion rows are written by `prepareTripCreate`, outside any transaction,
 * and outlive a rollback. That is harmless: `resolveCompanions` is
 * find-or-create, so the next attempt reuses them instead of duplicating them.
 *
 * The caller has validated `body` with `createTripSchema`. What belongs to the
 * REQUEST — the cover-image check, the document links — stays in the route.
 */
import { prisma, type DbTransaction } from "../../db";
import type { Prisma, Trip } from "../../prisma";
import { TRIP_COLORS, type CreateTripInput } from "../../schemas/trip";
import { linkRowsFor, resolveCompanions } from "../companionService";
import { typedTripDays } from "../timeModel/tripColumns";
import { provenanceForWrite } from "../tripSummaryProvenance";
import { statusFromOwnDates } from "../trips/ownDatesStatus";

/** A trip ready to insert: its row, and the companions to link to it. */
export interface PreparedTripCreate {
  userId: string;
  data: Prisma.TripUncheckedCreateInput;
  /** Resolved companion ids in input order; `insertTrip` links them by position. */
  companionIds: string[];
}

export async function prepareTripCreate(
  userId: string,
  body: CreateTripInput
): Promise<PreparedTripCreate> {
  let color = body.color;
  if (!color) {
    const count = await prisma.trip.count({ where: { userId } });
    color = TRIP_COLORS[count % TRIP_COLORS.length];
  }

  const companions = await resolveCompanions(userId, body.companions ?? []);

  // Status derivation (spec 2026-07-17-status-from-dates) normally reads
  // linked flights/cruises, which cannot exist yet — a trip must exist before
  // anything can reference its id. Falling through to the column default
  // meant every hand-made trip was born "completed", including one starting
  // next week. So when no segments exist, derive from the trip's OWN bounds;
  // recomputeTripStatus() takes over the moment segments get linked.
  const status =
    body.status ?? (await statusFromOwnDates(userId, body.startDate, body.endDate)) ?? undefined;

  return {
    userId,
    companionIds: companions.map((c) => c.id),
    data: {
      userId,
      name: body.name,
      description: body.description,
      color,
      startDate: body.startDate,
      endDate: body.endDate,
      ...typedTripDays(body),
      status,
      category: body.category,
      tags: body.tags,
      // Dual write: resolved display names keep this legacy array in
      // agreement with `companionLinks` (trimmed, blanks dropped, newest
      // spelling wins) — the previous image still reads this column.
      companions: companions.map((c) => c.displayName),
      notes: body.notes,
      summary: body.summary,
      ...provenanceForWrite(body.summary, null),
      originLabel: body.originLabel,
      destinationLabel: body.destinationLabel,
      coverImageUrl: body.coverImageUrl,
      icon: body.icon,
      countries: body.countries,
    },
  };
}

/** Writes the prepared trip and its companion links with `tx`. */
export async function insertTrip(tx: DbTransaction, prepared: PreparedTripCreate): Promise<Trip> {
  const trip = await tx.trip.create({ data: prepared.data });
  if (prepared.companionIds.length > 0) {
    await tx.tripCompanion.createMany({
      data: linkRowsFor(prepared.companionIds).map((row) => ({ ...row, tripId: trip.id })),
      skipDuplicates: true,
    });
  }
  return trip;
}

/** `POST /trips`: prepare, then insert in a transaction of its own. */
export async function createTripRecord(userId: string, body: CreateTripInput): Promise<Trip> {
  const prepared = await prepareTripCreate(userId, body);
  return prisma.$transaction((tx) => insertTrip(tx, prepared));
}
