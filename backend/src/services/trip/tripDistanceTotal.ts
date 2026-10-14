import { prisma } from "../../db";
import { loadVisibleDomainSet, type VisibleDomains } from "../domainVisibility";
import { distanceKm } from "../stats/records";
import { drivenKm } from "../tour/tourDistance";

/**
 * "Total logged km" (owner request 2026-10-14): every roadtrip, flight and
 * cruise kilometre the logbook holds, summed once. The journeys page shows
 * three superlatives beside each other (longest, most expensive, most
 * countries); this is the fourth tile the owner asked for, and it is a
 * lifetime figure rather than a winner — no trip, no navigation.
 *
 * Computed HERE, on the server, and UNCAPPED. The obvious cheap version — fold
 * it in the browser over the trips the page already has — would be silently
 * wrong twice over: `GET /trips` is capped at 500 trips (200 nested rows per
 * domain), so a trip beyond the cap would vanish from the total, and the rows
 * of a domain the user logs but never attaches to a trip would never enter it
 * at all. It rides the existing `includeInsights` envelope beside
 * `mostExpensiveTrip`, so there is no new endpoint and no schema change.
 *
 * # The three terms, each under the app's own rule
 *
 *  - FLIGHTS are `distanceKm` (`services/stats/records.ts`): the stamped
 *    `routeDistance` where there is one, else the great-circle chord between
 *    the two airports. The app never stores the path flown, so the chord IS
 *    the flight distance — no path is invented here either.
 *  - CRUISE LEGS are the sea router's own `distanceKm`, summed. A cruise whose
 *    legs were never routed has none and contributes 0: the honest number
 *    available, never an estimate.
 *  - ROAD LEGS are `drivenKm`'s allow-list (`services/tour/tourDistance.ts`),
 *    filtered to sections of `kind === "roadtrip"`. A ferry or rail leg in the
 *    same section is carried, not driven, and must not reach the odometer
 *    figure — the same reason the per-trip `drivenKm` on the list is NOT used
 *    here: it sums every section, tours included, and would inflate the total.
 *
 * Flights, cruise legs and road legs are disjoint rows, so nothing is counted
 * twice.
 *
 * # What is left out, and why
 *
 * A PLANNED trip contributes nothing — it has not flown, sailed or driven yet.
 * This mirrors `computeTripInsights`'s `status !== "planned"` filter and the
 * cost superlative's, so the tile and the tiles beside it agree about which
 * trips are even eligible. A row not attached to any trip counts: the whole
 * logbook is what the owner asked to total.
 *
 * A domain the user does not see is excluded through the same visibility helper
 * the cost superlative uses (`domainVisibility.loadVisibleDomainSet`) — a
 * hidden beta domain's kilometres must not reach a figure on screen. Flights
 * pass the gate whatever the setting says, exactly as they do for cost: every
 * trip surface lists a trip's flights ungated.
 */

/**
 * The lifetime kilometres, rounded once at the end (`longest`'s own
 * presentation: `${nf.format(Math.round(km))} km`).
 */
export async function totalLoggedKm(userId: string, visible: VisibleDomains): Promise<number> {
  // The trips still on the drawing board — their rows are named by id below so
  // a single pass per domain can leave them out without a join per row.
  const plannedTrips = await prisma.trip.findMany({
    where: { userId, status: "planned" },
    select: { id: true },
  });
  const planned = new Set(plannedTrips.map((trip) => trip.id));

  const [flights, cruiseLegs, roadLegs] = await Promise.all([
    // Flights: the domain gate lets them through whatever the setting says
    // (`domainVisibility.rowsIfVisible`), so this one is unconditional.
    prisma.flight.findMany({
      where: { userId },
      select: {
        tripId: true,
        routeDistance: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
      },
    }),
    visible.has("cruise")
      ? prisma.cruiseLeg.findMany({
          where: { cruise: { userId } },
          select: { distanceKm: true, cruise: { select: { tripId: true } } },
        })
      : Promise.resolve([]),
    visible.has("roadtrip")
      ? prisma.tripRouteLeg.findMany({
          where: { route: { userId, kind: "roadtrip" } },
          select: { distanceKm: true, mode: true, route: { select: { tripId: true } } },
        })
      : Promise.resolve([]),
  ]);

  let km = 0;
  for (const flight of flights) {
    if (flight.tripId !== null && planned.has(flight.tripId)) continue;
    km += distanceKm(flight) ?? 0;
  }
  for (const leg of cruiseLegs) {
    if (leg.cruise.tripId !== null && planned.has(leg.cruise.tripId)) continue;
    km += leg.distanceKm;
  }
  // `drivenKm` drops ferry/rail/foot/bike here (its allow-list), and the filter
  // drops only the rows of a planned trip.
  km += drivenKm(
    roadLegs.filter((leg) => leg.route.tripId === null || !planned.has(leg.route.tripId))
  );

  return Math.round(km);
}

/** `totalLoggedKm` behind the user's own domain gate — what the trips page is served. */
export async function tripsPageTotalLoggedKm(userId: string): Promise<number> {
  return totalLoggedKm(userId, await loadVisibleDomainSet(userId));
}
