import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import {
  ROADTRIP_BRIEF_INCLUDE,
  briefFromRoadtrip,
  compactBrief,
  routeLine,
  summariseRoadtrip,
  type GenerateFn,
} from "../tripSummaryService";

/**
 * The roadtrip's own AI summary (spec 2026-10-12 §6): the journey's machinery
 * one level down — same provider, same prompt shape, covering the roadtrip's
 * span and stations. The model call is a seam (`generate`), so none of this
 * needs an Ollama.
 *
 * Synthetic fixtures only (public repository): Fernhollow, Dunmere, Skyvale,
 * Skarnes.
 */
const USERS = ["summary-roadtrip-owner", "summary-roadtrip-other"];
const FAKE = { url: "http://fake:11434", model: "fake-model" };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("the roadtrip summary", () => {
  let userId: string;
  let routeId: string;
  let futureRouteId: string;
  let spanningRouteId: string;
  let undatedRouteId: string;

  const read = (id: string) =>
    prisma.tripRoute.findFirstOrThrow({ where: { id }, include: ROADTRIP_BRIEF_INCLUDE });

  beforeAll(async () => {
    // The clock decides the tense, so it is pinned (ADR 0002 D6).
    setClockForTests("2031-06-01T12:00:00Z");
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const user = await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } });
    userId = user.id;

    // A finished trip: two stays, three nights, 2–5 May 2031.
    const route = await prisma.tripRoute.create({
      data: {
        userId,
        name: "Northvale loop",
        mode: "road",
        kind: "roadtrip",
        notes: "Der Pass war noch gesperrt; wir sind unten herum gefahren.",
      },
    });
    routeId = route.id;
    const cabins = await prisma.lodging.create({
      data: {
        userId,
        name: "Lakeview Cabins",
        type: "campsite",
        city: "Fernhollow",
        country: "Nordland",
      },
    });
    const pitch = await prisma.lodging.create({
      data: {
        userId,
        name: "Dunmere Pitch",
        type: "campsite",
        city: "Dunmere",
        country: "Nordland",
      },
    });
    const cabinStay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: cabins.id, checkIn: d("2031-05-02"), checkOut: d("2031-05-04") },
    });
    const pitchStay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: pitch.id, checkIn: d("2031-05-04"), checkOut: d("2031-05-05") },
    });
    await prisma.tripStop.createMany({
      data: [
        {
          routeId,
          routeOrderIdx: 0,
          title: "Fernhollow",
          lat: 61.1,
          lon: 8.5,
          startDate: d("2031-05-02"),
          endDate: d("2031-05-04"),
          overnight: true,
          lodgingStayId: cabinStay.id,
        },
        {
          routeId,
          routeOrderIdx: 1,
          title: "Dunmere",
          lat: 61.4,
          lon: 9.1,
          startDate: d("2031-05-04"),
          endDate: d("2031-05-05"),
          overnight: true,
          lodgingStayId: pitchStay.id,
        },
      ],
    });

    // A trip whose days have not begun at the pinned clock.
    const future = await prisma.tripRoute.create({
      data: { userId, name: "Skyvale loop", mode: "road", kind: "roadtrip" },
    });
    futureRouteId = future.id;
    await prisma.tripStop.create({
      data: {
        routeId: futureRouteId,
        routeOrderIdx: 0,
        title: "Skyvale",
        lat: 62.0,
        lon: 9.4,
        startDate: d("2032-08-01"),
        endDate: d("2032-08-03"),
        overnight: true,
      },
    });

    // A trip under way at the pinned clock.
    const spanning = await prisma.tripRoute.create({
      data: { userId, name: "Fern pass", mode: "road", kind: "roadtrip" },
    });
    spanningRouteId = spanning.id;
    await prisma.tripStop.create({
      data: {
        routeId: spanningRouteId,
        routeOrderIdx: 0,
        title: "Skarnes",
        lat: 60.2,
        lon: 8.0,
        startDate: d("2031-05-30"),
        endDate: d("2031-06-03"),
        overnight: true,
      },
    });

    // One free night nobody dated: its length is unknown.
    const undated = await prisma.tripRoute.create({
      data: { userId, name: "Unplaced", mode: "road", kind: "roadtrip" },
    });
    undatedRouteId = undated.id;
    await prisma.tripStop.create({
      data: {
        routeId: undatedRouteId,
        routeOrderIdx: 0,
        title: "Fernhollow",
        lat: 61.1,
        lon: 8.5,
        overnight: true,
      },
    });
  });

  afterAll(async () => {
    setClockForTests(null);
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  describe("briefFromRoadtrip", () => {
    it("carries the span, the stations and the stays — and nothing invented", async () => {
      const brief = briefFromRoadtrip(await read(routeId), "completed");
      expect(brief).toMatchObject({
        name: "Northvale loop",
        status: "completed",
        nights: 3,
        startDate: "2031-05-02",
        endDate: "2031-05-05",
        perspective: "I",
      });
      expect(brief.stays).toEqual([
        expect.objectContaining({
          lodging: "Lakeview Cabins",
          nights: 2,
          city: "Fernhollow",
          checkIn: "2031-05-02",
          checkOut: "2031-05-04",
        }),
        expect.objectContaining({
          lodging: "Dunmere Pitch",
          nights: 1,
          city: "Dunmere",
          checkIn: "2031-05-04",
          checkOut: "2031-05-05",
        }),
      ]);
      expect(brief.stops).toEqual([
        { title: "Fernhollow", domain: null, start: "2031-05-02" },
        { title: "Dunmere", domain: null, start: "2031-05-04" },
      ]);
      // The compactor drops everything empty, so the prompt cannot name a
      // field this roadtrip does not have.
      expect(Object.keys(compactBrief(brief)).sort()).toEqual(
        [
          "endDate",
          "name",
          "nights",
          "notes",
          "perspective",
          "startDate",
          "status",
          "stays",
          "stops",
        ].sort()
      );
    });

    it("leaves a route correction out of the stations it retells", async () => {
      const via = await prisma.tripStop.create({
        data: { routeId, routeOrderIdx: 2, title: "", lat: 61.55, lon: 9.4, viaPoint: true },
      });
      try {
        const brief = briefFromRoadtrip(await read(routeId), "completed");
        expect(brief.stops.map((s) => s.title)).toEqual(["Fernhollow", "Dunmere"]);
      } finally {
        await prisma.tripStop.delete({ where: { id: via.id } });
      }
    });

    it("says no nights when a station's length is unknown, and no route line then", async () => {
      const brief = briefFromRoadtrip(await read(undatedRouteId), "planned");
      expect(brief.nights).toBeNull();
      expect(brief.startDate).toBeNull();
      expect(routeLine(brief, "de")).toBe("");
    });
  });

  describe("summariseRoadtrip", () => {
    it("sends the roadtrip's own brief and stores the cleaned answer with its provenance", async () => {
      let sent = "";
      const generate: GenerateFn = async (_target, { system, prompt }) => {
        sent = `${system}\n${prompt}`;
        return '<think>…</think>"Zwei Seen, ein Pass und drei Nächte am Wasser."';
      };
      const result = await summariseRoadtrip(routeId, userId, {
        language: "de",
        target: FAKE,
        generate,
      });

      expect(sent).toMatch(/Lakeview Cabins/);
      expect(sent).toMatch(/Dunmere Pitch/);
      expect(sent).toMatch(/"status": "completed"/);
      expect(sent).toMatch(/Deutsch/);
      // Only the kinds the brief carries are named to the model (rule 3). The
      // fixture's notes make this brief one with a voice, so the list is
      // followed by ", und \"notes\"" rather than the voiceless rule's period.
      expect(sent).toMatch(/— Hotels, Stopps, und "notes"/);
      expect(sent).not.toMatch(/Flüge|Kreuzfahrten/);

      expect(result.summary).toBe(
        "Zwei Seen, ein Pass und drei Nächte am Wasser.\n\nRoute: Fernhollow – Dunmere. 3 Nächte."
      );
      expect(result).toMatchObject({ model: "fake-model", language: "de", summarySource: "llm" });
      // Stored on the roadtrip's own row, stamped with the clock this test pinned.
      expect(result.summaryGeneratedAt).toBe("2031-06-01T12:00:00.000Z");
      const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
      expect(stored.summary).toBe(result.summary);
      expect(stored.summarySource).toBe("llm");
      expect(stored.summaryGeneratedAt?.toISOString()).toBe("2031-06-01T12:00:00.000Z");
    });

    it("reads each roadtrip's tense off its own span at the pinned clock", async () => {
      const prompts: string[] = [];
      const capture: GenerateFn = async (_target, { prompt }) => {
        prompts.push(prompt);
        return "Eine Zusammenfassung.";
      };
      await summariseRoadtrip(routeId, userId, { language: "de", target: FAKE, generate: capture });
      await summariseRoadtrip(futureRouteId, userId, {
        language: "de",
        target: FAKE,
        generate: capture,
      });
      await summariseRoadtrip(spanningRouteId, userId, {
        language: "de",
        target: FAKE,
        generate: capture,
      });
      expect(prompts[0]).toMatch(/"status": "completed"/);
      expect(prompts[1]).toMatch(/"status": "planned"/);
      expect(prompts[2]).toMatch(/"status": "in_progress"/);
    });

    it("refuses a roadtrip someone else owns, and a tour's id", async () => {
      const other = await prisma.user.create({
        data: { username: USERS[1], passwordHash: "x" },
      });
      const tour = await prisma.tripRoute.create({
        data: { userId, name: "Day walk", mode: "foot", kind: "tour" },
      });
      try {
        const generate = jest.fn(async () => "never");
        await expect(
          summariseRoadtrip(routeId, other.id, { language: "de", target: FAKE, generate })
        ).rejects.toThrow("Roadtrip not found");
        await expect(
          summariseRoadtrip(tour.id, userId, { language: "de", target: FAKE, generate })
        ).rejects.toThrow("Roadtrip not found");
        expect(generate).not.toHaveBeenCalled();
      } finally {
        await prisma.user.delete({ where: { id: other.id } });
      }
    });

    it("an empty answer is a failure, not an empty summary written over the old one", async () => {
      await prisma.tripRoute.update({ where: { id: routeId }, data: { summary: "Bestand" } });
      await expect(
        summariseRoadtrip(routeId, userId, {
          language: "de",
          target: FAKE,
          generate: async () => '""',
        })
      ).rejects.toThrow("empty summary");
      const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
      expect(stored.summary).toBe("Bestand");
    });
  });
});
