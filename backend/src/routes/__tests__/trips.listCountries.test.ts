import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** A synthetic catalogue airport, upserted so no test depends on the seed. */
function uatAirport(iata: string, country: string) {
  return prisma.airport.upsert({
    where: { airports_iata_is_closed_key: { iata, isClosed: false } },
    update: { country },
    create: {
      iata,
      name: `UAT ${iata}`,
      country,
      timezone: "UTC",
      lat: 0,
      lon: 0,
      isClosed: false,
    },
  });
}

/**
 * `trips.countries` is a stored column nobody derives, so 2.5.0 taught
 * GET /trips/:id to fall back to the countries of the trip's flights. The trip
 * LIST endpoint was left alone — and the list is what feeds the trip cards on
 * the Reisen overview, so every card read "?" for a trip whose detail page
 * showed five countries. Same defect, one surface fixed.
 *
 * These pin both surfaces on the same derivation.
 */
describe("trip countries are derived on the list, not only on the detail", () => {
  let authCookie: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripListCountries" } });
    const user = await prisma.user.create({
      data: {
        username: "tripListCountries",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    // Airports the derivation resolves through. Upserted so the test does not
    // depend on the catalogue seed having run.
    for (const a of [
      { iata: "XQA", name: "Test A", country: "Germany", timezone: "Europe/Berlin" },
      { iata: "XQB", name: "Test B", country: "Spain", timezone: "Europe/Madrid" },
      { iata: "XQC", name: "Test C", country: "Germany", timezone: "Europe/Berlin" },
    ]) {
      // The unique key is (iata, isClosed), not iata alone.
      await prisma.airport.upsert({
        where: { airports_iata_is_closed_key: { iata: a.iata, isClosed: false } },
        update: { country: a.country, timezone: a.timezone },
        create: {
          iata: a.iata,
          name: a.name,
          country: a.country,
          timezone: a.timezone,
          lat: 0,
          lon: 0,
          isClosed: false,
        },
      });
    }

    const trip = await prisma.trip.create({
      data: { userId, name: "Countries derivation", status: "completed" },
    });
    tripId = trip.id;

    await prisma.flight.createMany({
      data: [
        {
          userId,
          tripId,
          depIata: "XQA",
          arrIata: "XQB",
          departureTime: new Date("2026-03-01T08:00:00.000Z"),
          status: "flown",
          depLat: 0,
          depLon: 0,
          arrLat: 0,
          arrLon: 0,
        },
        {
          userId,
          tripId,
          depIata: "XQB",
          arrIata: "XQC",
          departureTime: new Date("2026-03-08T08:00:00.000Z"),
          status: "flown",
          depLat: 0,
          depLon: 0,
          arrLat: 0,
          arrLon: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.airport.deleteMany({ where: { iata: { in: ["XQA", "XQB", "XQC"] } } });
  });

  it("derives the countries of the trip's flights on the LIST endpoint", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);

    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    expect(trip).toBeDefined();
    // Deduplicated (Germany appears at both ends), folded to ISO, sorted.
    expect(trip.countries).toEqual(["DE", "ES"]);
  });

  it("agrees with the detail endpoint — the bug was the two disagreeing", async () => {
    const [list, detail] = await Promise.all([
      request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200),
      request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", authCookie).expect(200),
    ]);
    const fromList = list.body.trips.find((t: { id: string }) => t.id === tripId).countries;
    expect(fromList).toEqual(detail.body.trip.countries);
  });

  it("prefers a stored country list over the derivation", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { countries: ["Japan"] },
    });
    try {
      const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
      const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
      expect(trip.countries).toEqual(["Japan"]);
    } finally {
      await prisma.trip.update({ where: { id: tripId }, data: { countries: [] } });
    }
  });

  it("derives countries for a CRUISE-ONLY trip from the ports it called at", async () => {
    // A cruise-only trip carries no flights at all, so a flight-only
    // derivation left it reading "?" for a voyage that plainly visited
    // several countries — measured on the RC against production data.
    const ports = await Promise.all(
      [
        { name: "UAT Port IT", country: "Italy", unlocode: "ZZUA1" },
        { name: "UAT Port GR", country: "Greece", unlocode: "ZZUA2" },
        { name: "UAT Port HR", country: "Croatia", unlocode: "ZZUA3" },
      ].map((p) =>
        prisma.port.upsert({
          where: { unlocode: p.unlocode },
          update: { country: p.country },
          create: { ...p, lat: 0, lon: 0 },
          select: { id: true },
        })
      )
    );

    const trip = await prisma.trip.create({
      data: { userId, name: "Cruise only", status: "completed" },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        startDate: new Date("2026-05-01"),
        endDate: new Date("2026-05-08"),
        departurePortId: ports[0].id,
        arrivalPortId: ports[0].id,
      },
    });
    await prisma.cruiseStop.createMany({
      data: [
        { cruiseId: cruise.id, portId: ports[1].id, dayNumber: 1, isAtSea: false },
        { cruiseId: cruise.id, portId: ports[2].id, dayNumber: 2, isAtSea: false },
        { cruiseId: cruise.id, portId: null, dayNumber: 3, isAtSea: true },
      ],
    });

    try {
      const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
      const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
      // Departure/arrival port + both calls, folded to ISO, deduplicated and
      // sorted. The sea day contributes nothing, as it should.
      expect(listed.countries).toEqual(["GR", "HR", "IT"]);

      const detail = await request(app)
        .get(`/api/v1/trips/${trip.id}`)
        .set("Cookie", authCookie)
        .expect(200);
      expect(detail.body.trip.countries).toEqual(listed.countries);
    } finally {
      await prisma.cruiseStop.deleteMany({ where: { cruiseId: cruise.id } });
      await prisma.cruise.delete({ where: { id: cruise.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.port.deleteMany({ where: { unlocode: { in: ["ZZUA1", "ZZUA2", "ZZUA3"] } } });
    }
  });

  it("derives countries for a LODGING-ONLY trip from linked stays", async () => {
    // The current RC exposed that a trip can have real lodging evidence without
    // any flight or cruise segment. That should still show a country on both
    // trip surfaces.
    const trip = await prisma.trip.create({
      data: { userId, name: "Lodging only", status: "completed" },
    });
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "UAT Hotel CH",
        type: "hotel",
        country: "Schweiz",
        isoCountryCode: "CH",
      },
    });
    // A cancelled booking in another country is not evidence of anything.
    const cancelledLodging = await prisma.lodging.create({
      data: {
        userId,
        name: "UAT Hotel AT (cancelled)",
        type: "hotel",
        country: "Österreich",
        isoCountryCode: "AT",
      },
    });
    const stays = await Promise.all([
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          tripId: trip.id,
          checkIn: new Date("2026-05-01T00:00:00.000Z"),
          checkOut: new Date("2026-05-03T00:00:00.000Z"),
          status: "completed",
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: cancelledLodging.id,
          tripId: trip.id,
          checkIn: new Date("2026-05-03T00:00:00.000Z"),
          checkOut: new Date("2026-05-04T00:00:00.000Z"),
          status: "cancelled",
        },
      }),
    ]);

    try {
      const [list, detail] = await Promise.all([
        request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200),
        request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", authCookie).expect(200),
      ]);
      const listed = list.body.trips.find((t: { id: string }) => t.id === trip.id);

      expect(listed.countries).toEqual(["CH"]);
      expect(detail.body.trip.countries).toEqual(["CH"]);
    } finally {
      await prisma.lodgingStay.deleteMany({ where: { id: { in: stays.map((s) => s.id) } } });
      await prisma.lodging.deleteMany({ where: { id: { in: [lodging.id, cancelledLodging.id] } } });
      await prisma.trip.deleteMany({ where: { id: trip.id } });
    }
  });

  it("counts a country once when a flight AND a cruise both reach it", async () => {
    // The catalogues speak different languages: the airport says "DE", the port
    // says "Germany". Without folding, this trip would carry both and report
    // one country too many — the same defect the cross-domain stats KPI had.
    const port = await prisma.port.upsert({
      where: { unlocode: "ZZUA4" },
      update: { country: "Germany" },
      create: { name: "UAT Port DE", country: "Germany", unlocode: "ZZUA4", lat: 0, lon: 0 },
      select: { id: true },
    });

    const trip = await prisma.trip.create({
      data: { userId, name: "Flight and cruise", status: "completed" },
    });
    const flight = await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        depIata: "XQA", // Germany
        arrIata: "XQB", // Spain
        departureTime: new Date("2026-06-01T08:00:00.000Z"),
        status: "flown",
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
      select: { id: true },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        startDate: new Date("2026-06-05"),
        endDate: new Date("2026-06-12"),
        departurePortId: port.id, // Germany again, spelled the other way
        arrivalPortId: port.id,
      },
      select: { id: true },
    });

    try {
      const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
      const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
      // DE once, not "DE" plus "Germany".
      expect(listed.countries).toEqual(["DE", "ES"]);
    } finally {
      await prisma.cruise.delete({ where: { id: cruise.id } });
      await prisma.flight.delete({ where: { id: flight.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.port.deleteMany({ where: { unlocode: "ZZUA4" } });
    }
  });

  it("keeps a country the catalogues do not recognise instead of dropping it", async () => {
    const port = await prisma.port.upsert({
      where: { unlocode: "ZZUA5" },
      update: { country: "Freedonia" },
      create: { name: "UAT Port XX", country: "Freedonia", unlocode: "ZZUA5", lat: 0, lon: 0 },
      select: { id: true },
    });
    const trip = await prisma.trip.create({
      data: { userId, name: "Unknown country", status: "completed" },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        startDate: new Date("2026-07-01"),
        endDate: new Date("2026-07-08"),
        departurePortId: port.id,
        arrivalPortId: port.id,
      },
      select: { id: true },
    });
    try {
      const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
      const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
      expect(listed.countries).toEqual(["Freedonia"]);
    } finally {
      await prisma.cruise.delete({ where: { id: cruise.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.port.deleteMany({ where: { unlocode: "ZZUA5" } });
    }
  });

  it("returns an empty list for a trip with no flights rather than failing", async () => {
    const empty = await prisma.trip.create({
      data: { userId, name: "No segments", status: "planned" },
    });
    try {
      const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
      const trip = res.body.trips.find((t: { id: string }) => t.id === empty.id);
      expect(trip.countries).toEqual([]);
    } finally {
      await prisma.trip.delete({ where: { id: empty.id } });
    }
  });

  /**
   * The band's flags (`destinationCountries`, owner ruling 2026-10-13) are a
   * SECOND list beside `countries`: the places the journey went, in travel
   * order, the last arrival (home) dropped, deduped keeping first occurrence.
   * `countries` stays the counted set; this one orders the card's flags.
   */
  describe("the journey band's destinations (owner ruling 2026-10-13)", () => {
    /** A flight leg, both ends on the catalogue, dated by whole days from a base. */
    const base = Date.UTC(2031, 0, 1, 8);
    const at = (days: number): Date => new Date(base + days * 86_400_000);
    // `TripRoute.startDay` is a `@db.Date`, so a car leg placed by it sits at
    // midnight. A flight departing at midnight is the only way the two land on
    // the SAME instant, which is what an exact same-day tie needs.
    const midnight = (days: number): Date => new Date(Date.UTC(2031, 0, 1 + days));
    const leg = (depIata: string, arrIata: string, days: number) => ({
      userId,
      depIata,
      arrIata,
      departureTime: at(days),
      status: "flown",
      depLat: 0,
      depLon: 0,
      arrLat: 0,
      arrLon: 0,
    });

    /**
     * A car leg whose every station stands in ONE country, dated by its own
     * first day. No station carries a point, so the country comes from the
     * linked stay's ISO code — exactly the `stationCountries` rule every
     * roadtrip read uses.
     */
    async function carLeg(tripId: string, iso: string, startDay: Date) {
      const lodging = await prisma.lodging.create({
        data: {
          userId,
          name: `UAT drive ${iso}`,
          type: "hotel",
          country: iso,
          isoCountryCode: iso,
        },
      });
      const stay = await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          tripId,
          checkIn: startDay,
          checkOut: startDay,
          status: "completed",
        },
      });
      const route = await prisma.tripRoute.create({
        data: { userId, tripId, name: `UAT drive ${iso}`, mode: "car", kind: "roadtrip", startDay },
      });
      await prisma.tripStop.create({
        data: {
          tripId,
          routeId: route.id,
          routeOrderIdx: 0,
          title: `UAT drive ${iso}`,
          startDate: startDay,
          endDate: startDay,
          lat: null,
          lon: null,
          lodgingStayId: stay.id,
        },
      });
      return { lodgingId: lodging.id, stayId: stay.id, routeId: route.id };
    }

    /** Removes what `carLeg` wrote, so no case leaks into the next. */
    async function dropCarLeg(ids: { lodgingId: string; stayId: string; routeId: string }) {
      await prisma.tripStop.deleteMany({ where: { routeId: ids.routeId } });
      await prisma.tripRoute.delete({ where: { id: ids.routeId } });
      await prisma.lodgingStay.delete({ where: { id: ids.stayId } });
      await prisma.lodging.delete({ where: { id: ids.lodgingId } });
    }

    /** The band's list for one trip, read off the LIST endpoint the card uses. */
    async function destinationsOf(tripId: string): Promise<string[]> {
      const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
      return res.body.trips.find((t: { id: string }) => t.id === tripId).destinationCountries;
    }

    it("reads the destinations in travel order, the last arrival dropped (Karachi 2025)", async () => {
      const codes: Record<string, string> = {
        TR: "XQT",
        PK: "XKP",
        AE: "XAU",
        OM: "XOM",
        CA: "XCA",
      };
      for (const [country, iata] of Object.entries(codes)) await uatAirport(iata, country);

      const trip = await prisma.trip.create({
        data: { userId, name: "UAT band journey", status: "completed" },
      });
      // Arrivals: TR, PK, AE, OM, AE, TR, CA (the last is home).
      await prisma.flight.createMany({
        data: [
          leg("XCA", "XQT", 0),
          leg("XQT", "XKP", 1),
          leg("XKP", "XAU", 2),
          leg("XAU", "XOM", 3),
          leg("XOM", "XAU", 4),
          leg("XAU", "XQT", 5),
          leg("XQT", "XCA", 6),
        ].map((l) => ({ ...l, tripId: trip.id })),
      });
      // A car leg in Karachi (PK), dated between the second and third flights:
      // it merges into the travel order and folds away (PK is already there).
      const lodging = await prisma.lodging.create({
        data: {
          userId,
          name: "UAT Karachi stay",
          type: "hotel",
          country: "Pakistan",
          isoCountryCode: "PK",
        },
      });
      const stay = await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          tripId: trip.id,
          checkIn: at(2),
          checkOut: at(3),
          status: "completed",
        },
      });
      const route = await prisma.tripRoute.create({
        data: {
          userId,
          tripId: trip.id,
          name: "UAT Karachi",
          mode: "car",
          kind: "roadtrip",
          startDay: new Date(Date.UTC(2031, 0, 3)),
        },
      });
      await prisma.tripStop.create({
        data: {
          tripId: trip.id,
          routeId: route.id,
          routeOrderIdx: 0,
          title: "UAT Karachi",
          startDate: at(2),
          endDate: at(3),
          lat: null,
          lon: null,
          lodgingStayId: stay.id,
        },
      });

      try {
        const [list, detail] = await Promise.all([
          request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200),
          request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", authCookie).expect(200),
        ]);
        const listed = list.body.trips.find((t: { id: string }) => t.id === trip.id);
        // CA (home) dropped, first occurrence of each kept.
        expect(listed.destinationCountries).toEqual(["TR", "PK", "AE", "OM"]);
        // The detail serves the same list the card did.
        expect(detail.body.trip.destinationCountries).toEqual(["TR", "PK", "AE", "OM"]);
      } finally {
        await prisma.tripStop.deleteMany({ where: { routeId: route.id } });
        await prisma.tripRoute.delete({ where: { id: route.id } });
        await prisma.lodgingStay.delete({ where: { id: stay.id } });
        await prisma.lodging.delete({ where: { id: lodging.id } });
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: Object.values(codes) } } });
      }
    });

    it("reads a simple round trip as its one destination (home dropped)", async () => {
      await uatAirport("XCA", "CA");
      await uatAirport("XMX", "Mexico");
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT round trip", status: "completed" },
      });
      await prisma.flight.createMany({
        data: [leg("XCA", "XMX", 0), leg("XMX", "XCA", 9)].map((l) => ({ ...l, tripId: trip.id })),
      });
      try {
        const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
        const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
        expect(listed.destinationCountries).toEqual(["MX"]);
      } finally {
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: ["XCA", "XMX"] } } });
      }
    });

    it("reads a car-only journey as no destinations (its one leg is the whole list)", async () => {
      const lodging = await prisma.lodging.create({
        data: {
          userId,
          name: "UAT Home stay",
          type: "hotel",
          country: "Canada",
          isoCountryCode: "CA",
        },
      });
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT car only", status: "completed" },
      });
      const stay = await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          tripId: trip.id,
          checkIn: at(0),
          checkOut: at(2),
          status: "completed",
        },
      });
      const route = await prisma.tripRoute.create({
        data: {
          userId,
          tripId: trip.id,
          name: "UAT drive",
          mode: "car",
          kind: "roadtrip",
          startDay: new Date(Date.UTC(2031, 0, 1)),
        },
      });
      await prisma.tripStop.create({
        data: {
          tripId: trip.id,
          routeId: route.id,
          routeOrderIdx: 0,
          title: "UAT drive",
          startDate: at(0),
          endDate: at(1),
          lat: null,
          lon: null,
          lodgingStayId: stay.id,
        },
      });
      try {
        const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
        const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
        expect(listed.destinationCountries).toEqual([]);
      } finally {
        await prisma.tripStop.deleteMany({ where: { routeId: route.id } });
        await prisma.tripRoute.delete({ where: { id: route.id } });
        await prisma.lodgingStay.delete({ where: { id: stay.id } });
        await prisma.lodging.delete({ where: { id: lodging.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
      }
    });

    it("reads no destinations for a trip with no legs", async () => {
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT nothing", status: "planned" },
      });
      try {
        const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200);
        const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
        expect(listed.destinationCountries).toEqual([]);
      } finally {
        await prisma.trip.delete({ where: { id: trip.id } });
      }
    });

    /**
     * Home never shows by RULE, not by ordering luck (owner report 2026-10-14).
     * Dropping the final raw element removes home only while home happens to
     * sort last — a car leg that begins at or after the final flight leaves the
     * home arrival in the sequence. These pin the country of the first flight's
     * DEPARTURE airport being excluded wherever it sits.
     */
    it("keeps home out when a car leg's first day is the final flight's day", async () => {
      await uatAirport("XCA", "CA");
      await uatAirport("XNZ", "NZ");
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT late car leg", status: "completed" },
      });
      await prisma.flight.createMany({
        // The final flight departs at midnight so it ties the car leg exactly,
        // and the sort's stability leaves the car leg as the final raw element.
        data: [leg("XCA", "XNZ", 0), { ...leg("XNZ", "XCA", 10), departureTime: midnight(10) }].map(
          (l) => ({ ...l, tripId: trip.id })
        ),
      });
      // The car leg begins on the SAME day as the final flight, so the
      // final-element drop takes the car leg and leaves the CA home arrival.
      const car = await carLeg(trip.id, "NZ", midnight(10));
      try {
        expect(await destinationsOf(trip.id)).toEqual(["NZ"]);
      } finally {
        await dropCarLeg(car);
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: ["XCA", "XNZ"] } } });
      }
    });

    it("keeps home out for a US roadtrip after a CA round trip (Smokey shape)", async () => {
      await uatAirport("XCA", "CA");
      await uatAirport("XUS", "US");
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT smokey", status: "completed" },
      });
      await prisma.flight.createMany({
        data: [leg("XCA", "XUS", 0), leg("XUS", "XCA", 9)].map((l) => ({ ...l, tripId: trip.id })),
      });
      // The car leg starts AFTER the final flight, so the final-element drop
      // would take the car leg and leave the CA home arrival behind.
      const car = await carLeg(trip.id, "US", at(10));
      try {
        expect(await destinationsOf(trip.id)).toEqual(["US"]);
      } finally {
        await dropCarLeg(car);
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: ["XCA", "XUS"] } } });
      }
    });

    it("keeps home out when the US roadtrip begins on the final flight's day", async () => {
      await uatAirport("XCA", "CA");
      await uatAirport("XUS", "US");
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT smokey same day", status: "completed" },
      });
      await prisma.flight.createMany({
        data: [leg("XCA", "XUS", 0), { ...leg("XUS", "XCA", 9), departureTime: midnight(9) }].map(
          (l) => ({ ...l, tripId: trip.id })
        ),
      });
      // Same instant as the final flight's departure: the sort is stable and
      // the flight is pushed first, so the car leg is the final raw element.
      const car = await carLeg(trip.id, "US", midnight(9));
      try {
        expect(await destinationsOf(trip.id)).toEqual(["US"]);
      } finally {
        await dropCarLeg(car);
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: ["XCA", "XUS"] } } });
      }
    });

    it("keeps home out for a Mexico roadtrip after a Mexico round trip", async () => {
      await uatAirport("XCA", "CA");
      await uatAirport("XMX", "Mexico");
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT mexico", status: "completed" },
      });
      await prisma.flight.createMany({
        data: [leg("XCA", "XMX", 0), leg("XMX", "XCA", 9)].map((l) => ({ ...l, tripId: trip.id })),
      });
      const car = await carLeg(trip.id, "MX", at(10));
      try {
        expect(await destinationsOf(trip.id)).toEqual(["MX"]);
      } finally {
        await dropCarLeg(car);
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: ["XCA", "XMX"] } } });
      }
    });

    it("excludes nothing when the first departure's country is unknown", async () => {
      // XQQ has no catalogue row, so no home can be inferred: the only rule
      // that applies is the unchanged drop of the final raw element.
      await uatAirport("XSV", "SE");
      await uatAirport("XNW", "NO");
      const trip = await prisma.trip.create({
        data: { userId, name: "UAT unknown home", status: "completed" },
      });
      await prisma.flight.createMany({
        data: [leg("XQQ", "XSV", 0), leg("XSV", "XNW", 1)].map((l) => ({ ...l, tripId: trip.id })),
      });
      try {
        // Arrivals SE, NO → final element dropped → SE.
        expect(await destinationsOf(trip.id)).toEqual(["SE"]);
      } finally {
        await prisma.flight.deleteMany({ where: { tripId: trip.id } });
        await prisma.trip.delete({ where: { id: trip.id } });
        await prisma.airport.deleteMany({ where: { iata: { in: ["XSV", "XNW"] } } });
      }
    });
  });
});
