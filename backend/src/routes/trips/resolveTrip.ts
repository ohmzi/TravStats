import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";

/** Resolve and authorise a trip by id from the URL — used for every
 *  stop / journal sub-route. Throws 404 if the user doesn't own it.
 *
 *  `name` comes back with the id because a section created on the trip with
 *  no name of its own takes the trip's — see POST /trips/:id/routes. */
export async function resolveTrip(
  userId: string,
  tripId: string
): Promise<{ id: string; name: string }> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true, name: true },
  });
  if (!trip) throw new AppError("Trip not found", 404);
  return trip;
}
