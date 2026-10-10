import { prisma } from "../../../db";
import { loadExistingTitles } from "../nameClusters";

/**
 * The query behind the title chain's first rule: only the caller's own
 * roadtrip stations, inside the box, and not a route-correction point.
 */

const USERNAME = "tbexistingtitles";
const OTHER_USERNAME = "tbexistingtitlesother";
const BOX = { minLat: -45.2, maxLat: -44.6, minLon: 168.5, maxLon: 169.3 };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("loadExistingTitles", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, OTHER_USERNAME] } } });
    userId = (await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } })).id;
    const otherId = (
      await prisma.user.create({ data: { username: OTHER_USERNAME, passwordHash: "x" } })
    ).id;

    const roadtrip = await prisma.tripRoute.create({
      data: { userId, name: "Seed loop", mode: "road", kind: "roadtrip" },
    });
    const tour = await prisma.tripRoute.create({
      data: { userId, name: "Ridge walk", mode: "foot", kind: "tour" },
    });
    const foreign = await prisma.tripRoute.create({
      data: { userId: otherId, name: "Not mine", mode: "road", kind: "roadtrip" },
    });

    const stations = [
      { routeId: roadtrip.id, title: "Northvale, Westshire", lat: -45.05, lon: 168.7 },
      { routeId: roadtrip.id, title: "  Port Carrow, Westshire  ", lat: -44.7, lon: 169.15 },
      { routeId: roadtrip.id, title: "Far Away", lat: -30.0, lon: 150.0 },
      { routeId: roadtrip.id, title: "Bend in the road", lat: -45.04, lon: 168.71, viaPoint: true },
      { routeId: tour.id, title: "Ridge hut", lat: -45.03, lon: 168.72 },
      { routeId: foreign.id, title: "Somebody else's", lat: -45.06, lon: 168.69 },
    ];
    for (const [index, station] of stations.entries()) {
      await prisma.tripStop.create({
        data: {
          ...station,
          startDate: d("2031-05-02"),
          endDate: d("2031-05-03"),
          routeOrderIdx: index,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, OTHER_USERNAME] } } });
    await prisma.$disconnect();
  });

  it("returns the caller's own roadtrip stations inside the box, trimmed", async () => {
    const titles = await loadExistingTitles(userId, BOX);
    expect(titles.sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: "Northvale, Westshire", lat: -45.05, lon: 168.7 },
      { title: "Port Carrow, Westshire", lat: -44.7, lon: 169.15 },
    ]);
  });

  it("returns nothing for an empty box without asking the database", async () => {
    expect(
      await loadExistingTitles(userId, { minLat: 1, maxLat: -1, minLon: 1, maxLon: -1 })
    ).toEqual([]);
  });
});
