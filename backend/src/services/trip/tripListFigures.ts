import { prisma } from "../../db";

/**
 * Adds two figures to each listed trip that the trip row itself does not carry:
 * `_count.roadtrips` (its sections of kind `roadtrip`, which the trip page
 * lists as entries — forgejo#169) and `drivenKm` (the summed distance of ALL
 * its route sections, tours included).
 *
 * Prisma's `_count` names a relation and cannot alias a filtered count, and
 * `_count.routes` already means EVERY section (forgejo#90), tours included —
 * so this is one grouped query over the whole page, not one per trip.
 *
 * `drivenKm` exists because the trip card's own estimate
 * (`estimateTripDistanceKm`) can only see flights and cruises: a trip whose
 * content is route sections therefore showed a blank distance on its card
 * while its sections showed the real one on the trip page. The list endpoint
 * does not include `routes`, so the sum has to be computed here.
 *
 * Legs, not sections: a section's own distance is the sum of its legs
 * (`TripRouteLeg.distanceKm`), which is the same number the section list
 * renders. A section whose legs were never computed contributes nothing.
 */
export async function withTripListFigures<T extends { id: string; _count: object }>(
  trips: T[]
): Promise<
  Array<T & { _count: T["_count"] & { roadtrips: number }; drivenKm: number }>
> {
  if (trips.length === 0) {
    return [];
  }

  const ids = trips.map((t) => t.id);

  const countRows = await prisma.tripRoute.groupBy({
    by: ["tripId"],
    where: { tripId: { in: ids }, kind: "roadtrip" },
    _count: { _all: true },
  });
  const roadtripsByTrip = new Map(countRows.map((r) => [r.tripId, r._count._all]));

  // Two queries for the whole page: the sections, then their legs grouped by
  // section. No `include` on the sections — that would pull every leg's
  // waypoints JSON with it.
  const sections = await prisma.tripRoute.findMany({
    where: { tripId: { in: ids } },
    select: { id: true, tripId: true },
  });
  const tripOfSection = new Map(sections.map((s) => [s.id, s.tripId]));
  const kmByTrip = new Map<string, number>();

  if (sections.length > 0) {
    const legRows = await prisma.tripRouteLeg.groupBy({
      by: ["routeId"],
      where: { routeId: { in: sections.map((s) => s.id) } },
      _sum: { distanceKm: true },
    });
    for (const row of legRows) {
      const tripId = tripOfSection.get(row.routeId);
      if (!tripId) continue;
      kmByTrip.set(tripId, (kmByTrip.get(tripId) ?? 0) + (row._sum.distanceKm ?? 0));
    }
  }

  return trips.map((t) => ({
    ...t,
    _count: { ...t._count, roadtrips: roadtripsByTrip.get(t.id) ?? 0 },
    drivenKm: Math.round(kmByTrip.get(t.id) ?? 0),
  }));
}
