/**
 * Creating a roadtrip — one implementation for `POST /roadtrips` and for the
 * photo trip builder's commit (spec 2026-10-09 §D2), which files several
 * roadtrips on a trip inside the ONE transaction that also writes the trip.
 *
 * The caller has validated the fields (`createRoadtripSchema`) and resolved
 * `tripId` as the caller's own trip (`resolveTrip`), or created that trip in
 * the same `tx`.
 */
import type { DbTransaction } from "../../db";
import type { Prisma } from "../../prisma";
import type { CreateRoadtripInput } from "../../schemas/roadtrip";
import { ROUTE_SELECT } from "../../routes/trips/tourRoutes";

export type InsertRoadtripInput = Omit<CreateRoadtripInput, "tripId"> & { tripId: string | null };
export type RoadtripRow = Prisma.TripRouteGetPayload<{ include: typeof ROUTE_SELECT }>;

/** The new roadtrip goes after the last section of its trip, or of the standalone ones. */
export async function insertRoadtrip(
  tx: DbTransaction,
  userId: string,
  input: InsertRoadtripInput
): Promise<RoadtripRow> {
  const last = await tx.tripRoute.findFirst({
    where: { userId, tripId: input.tripId },
    orderBy: { orderIdx: "desc" },
    select: { orderIdx: true },
  });
  return tx.tripRoute.create({
    data: {
      userId,
      tripId: input.tripId,
      kind: "roadtrip",
      name: input.name,
      mode: input.mode,
      vehicle: input.vehicle ?? null,
      vehicleName: input.vehicleName ?? null,
      color: input.color,
      notes: input.notes,
      startOdometerKm: input.startOdometerKm,
      endOdometerKm: input.endOdometerKm,
      orderIdx: last ? last.orderIdx + 1 : 0,
    },
    include: ROUTE_SELECT,
  });
}
