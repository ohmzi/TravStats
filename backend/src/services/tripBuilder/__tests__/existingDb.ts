/**
 * A synthetic existing trip for the re-sync tests (public repository: invented
 * places, shifted years). One roadtrip of four stations with routed legs, two
 * timeline stops, one linked album and one flight.
 *
 *   A Northvale     5/2–5/4  free night
 *   B Port Carrow   5/4–5/6  pass-through
 *   C Kelmore       5/6–5/7  free night
 *   S Tarnside      5/7–5/9  a stay
 *   legs A→B, B→C, C→S: routed, road
 */
import { prisma } from "../../../db";
import { toDbDate } from "../../../shared/time/localDate";
import { hashPassword } from "../../../utils/password";
import { stationTimeColumns } from "../../timeModel/tripColumns";

export const FX = {
  northvale: { lat: -45.05, lon: 168.7 },
  portCarrow: { lat: -44.7, lon: 169.15 },
  kelmore: { lat: -45.42, lon: 168.52 },
  tarnside: { lat: -45.2, lon: 169.4 },
  southbridge: { lat: -45.45, lon: 169.1 },
} as const;

export interface ExistingFixture {
  userId: string;
  tripId: string;
  roadtripId: string;
  station: { a: string; b: string; c: string; s: string };
  stayId: string;
  stop: { museum: string; harbour: string };
  linkId: string;
  flightId: string;
}

interface StationSeed {
  title: string;
  at: { lat: number; lon: number };
  startDay: string | null;
  endDay: string | null;
  overnight?: boolean;
  lodgingStayId?: string;
  placeId?: string;
  viaPoint?: boolean;
  notes?: string | null;
}

export async function addStation(
  routeId: string,
  index: number,
  seed: StationSeed
): Promise<string> {
  const startDate = seed.startDay ? toDbDate(seed.startDay) : null;
  const endDate = seed.endDay ? toDbDate(seed.endDay) : null;
  const row = await prisma.tripStop.create({
    data: {
      routeId,
      routeOrderIdx: index,
      tripId: null,
      domain: "roadtrip",
      title: seed.title,
      lat: seed.at.lat,
      lon: seed.at.lon,
      startDate,
      endDate,
      ...stationTimeColumns({ startDate, endDate, lat: seed.at.lat, lon: seed.at.lon }),
      notes: seed.notes ?? null,
      overnight: seed.overnight ?? false,
      viaPoint: seed.viaPoint ?? false,
      lodgingStayId: seed.lodgingStayId ?? null,
      placeId: seed.placeId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

export async function addRoutedLeg(
  routeId: string,
  fromStopId: string,
  toStopId: string,
  distanceKm: number
): Promise<void> {
  await prisma.tripRouteLeg.create({
    data: {
      routeId,
      fromStopId,
      toStopId,
      distanceKm,
      source: "routed",
      mode: "road",
      confidence: "high",
      waypoints: [
        [168.7, -45.05],
        [169.15, -44.7],
      ],
    },
  });
}

export async function createExistingFixture(username: string): Promise<ExistingFixture> {
  await dropFixtureUser(username);
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123") },
  });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Northvale loop",
      startDate: toDbDate("2031-05-02"),
      endDate: toDbDate("2031-05-09"),
      startDay: toDbDate("2031-05-02"),
      endDay: toDbDate("2031-05-09"),
      countries: ["NZ"],
    },
  });
  const lodging = await prisma.lodging.create({
    data: { userId: user.id, name: "Tarnside Lodge" },
  });
  const stay = await prisma.lodgingStay.create({
    data: { userId: user.id, lodgingId: lodging.id, tripId: trip.id },
  });
  const route = await prisma.tripRoute.create({
    data: {
      userId: user.id,
      tripId: trip.id,
      name: "Northvale loop",
      mode: "road",
      kind: "roadtrip",
      vehicle: "car",
    },
  });
  const a = await addStation(route.id, 0, {
    title: "Northvale",
    at: FX.northvale,
    startDay: "2031-05-02",
    endDay: "2031-05-04",
    overnight: true,
  });
  const b = await addStation(route.id, 1, {
    title: "Port Carrow",
    at: FX.portCarrow,
    startDay: "2031-05-04",
    endDay: "2031-05-06",
  });
  const c = await addStation(route.id, 2, {
    title: "Kelmore",
    at: FX.kelmore,
    startDay: "2031-05-06",
    endDay: "2031-05-07",
    overnight: true,
    notes: "Quiet street",
  });
  const s = await addStation(route.id, 3, {
    title: "Tarnside Lodge",
    at: FX.tarnside,
    startDay: "2031-05-07",
    endDay: "2031-05-09",
    overnight: true,
    lodgingStayId: stay.id,
  });
  await addRoutedLeg(route.id, a, b, 55.2);
  await addRoutedLeg(route.id, b, c, 80.4);
  await addRoutedLeg(route.id, c, s, 61.7);

  const stopData = (
    title: string,
    at: { lat: number; lon: number },
    startDay: string,
    endDay: string
  ) => {
    const startDate = toDbDate(startDay);
    const endDate = toDbDate(endDay);
    return {
      tripId: trip.id,
      title,
      lat: at.lat,
      lon: at.lon,
      startDate,
      endDate,
      ...stationTimeColumns({ startDate, endDate, lat: at.lat, lon: at.lon }),
    };
  };
  const museum = await prisma.tripStop.create({
    data: stopData("Kelmore Museum", FX.kelmore, "2031-05-06", "2031-05-06"),
    select: { id: true },
  });
  const harbour = await prisma.tripStop.create({
    data: stopData("Port Carrow Harbour", FX.portCarrow, "2031-05-04", "2031-05-04"),
    select: { id: true },
  });

  const link = await prisma.tripImmichAlbum.create({
    data: {
      tripId: trip.id,
      immichAlbumId: "9a1b2c3d-0000-4000-8000-000000000001",
      albumName: "Northvale loop",
      assetCount: 40,
      mode: "link",
      sortIdx: 0,
    },
  });
  const flight = await prisma.flight.create({
    data: {
      userId: user.id,
      tripId: trip.id,
      flightNumber: "ZZ101",
      depIata: "ZZA",
      arrIata: "ZZB",
      depLat: -41.3,
      depLon: 174.8,
      arrLat: -45.0,
      arrLon: 168.7,
    },
  });

  return {
    userId: user.id,
    tripId: trip.id,
    roadtripId: route.id,
    station: { a, b, c, s },
    stayId: stay.id,
    stop: { museum: museum.id, harbour: harbour.id },
    linkId: link.id,
    flightId: flight.id,
  };
}

export async function dropFixtureUser(username: string): Promise<void> {
  await prisma.user.deleteMany({ where: { username } });
}
