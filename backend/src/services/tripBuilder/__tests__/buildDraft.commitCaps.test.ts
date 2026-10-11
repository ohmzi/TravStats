/**
 * The scan cannot offer more than the commit accepts (final review, finding
 * B4-1). The commit caps its body — `MAX_COMMIT_FLIGHTS` flights, `MAX_AREAS`
 * areas, `MAX_PHOTO_JOURNEYS` photo findings (`schemas/tripBuilder.ts`) — and
 * the review page ticks and sends everything a draft offered, so a scan that
 * offered more left the user with a `VALIDATION_FAILED` they could not act on
 * (and, past the areas cap, no action at all). The scan therefore bounds the
 * three lists itself, keeps the earliest, and says in a warning what it left
 * out.
 */
import { commitBodySchema } from "../../../schemas/tripBuilder";
import { buildDraftWith } from "../buildDraft";
import { MAX_AREAS, MAX_COMMIT_FLIGHTS, MAX_PHOTO_JOURNEYS } from "../thresholds";
import type { CommitArea, CommitBody } from "../../../schemas/tripBuilder";
import type { DraftPhotoJourney, ScanInput, TripBuilderDraft } from "../types";
import { NORTHVALE, builderDeps, photosAt, preciseFlight, type Place } from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";

/** Around -45.05, 168.70: about 1045 km from Northvale, a two-and-a-half-hour jump. */
const EASTPORT: Place = { lat: -38.0, lon: 177.0, city: "Eastport", state: "Eastshire" };

/**
 * What the review page would send for `dto`: every area it was shown, every
 * flight and photo finding it ticked by default. Parsed against the commit's
 * own schema, so a refusal here is exactly the one a user would meet.
 */
function reviewBody(dto: TripBuilderDraft): CommitBody {
  const areas: CommitArea[] = dto.areas.map((area) => ({
    key: area.key,
    as: area.defaultAs,
    name: area.suggestedName,
    vehicle: "car",
    homeStart: area.stations[0]?.kind === "home",
    homeEnd: area.stations[area.stations.length - 1]?.kind === "home",
    stations: area.stations.map((station) => ({
      key: station.key,
      title: station.title,
      lat: station.lat,
      lon: station.lon,
      kind: station.kind,
      firstDay: station.firstDay,
      lastDay: station.lastDay,
      notes: station.notes,
    })),
    legModes: area.legs.map((leg) => leg.mode),
    album: area.pitstop !== undefined,
  }));
  return {
    commitKey: COMMIT_KEY,
    window: { startDay: dto.window.startDay, endDay: dto.window.endDay },
    target: { kind: "new", trip: { name: dto.tripName } },
    flightIds: dto.flights.filter((f) => !f.locked && f.defaultAssign).map((f) => f.id),
    nights: Object.fromEntries(
      Object.entries(dto.nights).map(([day, entry]) => [day, entry.assign])
    ),
    areas,
    photoJourneyIds: dto.photoJourneys.filter((j) => j.defaultTick).map((j) => j.id),
    album: { create: false, name: dto.tripName },
  };
}

/** A uuid for the nth synthetic flight or finding. */
const madeId = (n: number): string => `f1a2b3c4-d5e6-4f70-8a9b-${String(n).padStart(12, "0")}`;

/** `2031-05-02` + n days, by the calendar the fixtures use. */
function dayAfter(n: number): string {
  const day = new Date(Date.parse("2031-05-02T00:00:00Z") + n * 86_400_000);
  return day.toISOString().slice(0, 10);
}

describe("buildDraftWith: a window with more flights than one save can assign", () => {
  const WINDOW: ScanInput = {
    name: "Long haul",
    startDay: "2031-05-02",
    endDay: "2031-07-02",
    inspect: true,
    createAlbum: false,
    target: { kind: "new" },
  };
  /** Two a day for 55 days: ten more listed flights than a commit can assign. */
  const FLIGHTS = Array.from({ length: MAX_COMMIT_FLIGHTS + 10 }, (_, i) =>
    preciseFlight({
      id: madeId(i),
      label: `ZZ${100 + i} ZNV→ZEP`,
      depIata: "ZNV",
      arrIata: "ZEP",
      dep: NORTHVALE,
      arr: EASTPORT,
      depLocal: `${dayAfter(Math.floor(i / 2))}T${i % 2 === 0 ? "08:00" : "20:00"}`,
      arrLocal: `${dayAfter(Math.floor(i / 2))}T${i % 2 === 0 ? "09:00" : "21:00"}`,
    })
  );

  const build = () =>
    buildDraftWith(
      builderDeps([], { loadFlights: async () => FLIGHTS }),
      USER,
      WINDOW,
      () => undefined
    );

  it("lists the earliest MAX_COMMIT_FLIGHTS and warns how many were left out", async () => {
    const { dto } = await build();

    expect(dto.flights).toHaveLength(MAX_COMMIT_FLIGHTS);
    expect(dto.flights[0].id).toBe(FLIGHTS[0].id);
    expect(dto.flights[MAX_COMMIT_FLIGHTS - 1].id).toBe(FLIGHTS[MAX_COMMIT_FLIGHTS - 1].id);
    expect(dto.warnings).toContainEqual({ code: "truncatedFlights", params: { count: 10 } });
  });

  it("offers only those flights to the commit, so a review-shaped body parses", async () => {
    const draft = await build();

    expect(draft.flightIds.size).toBe(MAX_COMMIT_FLIGHTS);
    const parsed = commitBodySchema.safeParse(reviewBody(draft.dto));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});

describe("buildDraftWith: a window with more areas than one trip can hold", () => {
  /** 22 stays, each 1.5 h, jumping 1045 km every 3 h: an unrecorded flight between each pair. */
  const STAYS = 22;
  const STAY_MS = 4.5 * 3_600_000;
  const assets = Array.from({ length: STAYS }, (_, i) => {
    const start = new Date(Date.parse("2031-05-02T08:00:00Z") + i * STAY_MS).toISOString();
    const end = new Date(
      Date.parse("2031-05-02T08:00:00Z") + i * STAY_MS + 1.5 * 3_600_000
    ).toISOString();
    return photosAt(`${i % 2 === 0 ? "nv" : "ep"}${i}`, i % 2 === 0 ? NORTHVALE : EASTPORT, [
      start.slice(0, 16),
      end.slice(0, 16),
    ]);
  }).flat();
  const WINDOW: ScanInput = {
    name: "Many stays",
    startDay: "2031-05-02",
    endDay: "2031-05-07",
    inspect: true,
    createAlbum: false,
    target: { kind: "new" },
  };

  const build = () => buildDraftWith(builderDeps(assets), USER, WINDOW, () => undefined);

  it("is one area per unrecorded flight before the cap", async () => {
    const { dto } = await build();
    // The fixture is only meaningful while it outruns the cap; a fixture that
    // silently stopped splitting would pass the cap test for the wrong reason.
    expect(dto.warnings.filter((w) => w.code === "possibleUnrecordedFlight").length).toBe(
      STAYS - 1
    );
  });

  it("keeps the earliest MAX_AREAS, warns about the rest, and leaves no night pointing at a dropped area", async () => {
    const { dto } = await build();

    expect(dto.areas).toHaveLength(MAX_AREAS);
    expect(dto.areas[0].startDay).toBe(WINDOW.startDay);
    expect(dto.warnings).toContainEqual({ code: "truncatedAreas", params: { count: 2 } });

    const shown = new Set(dto.areas.flatMap((area) => area.stations.map((s) => s.key)));
    for (const entry of Object.values(dto.nights)) {
      if (entry.assign === "home" || entry.assign === "unknown" || entry.assign === "flight") {
        continue;
      }
      expect(shown.has(entry.assign)).toBe(true);
    }
  });

  it("offers only those areas to the commit, so a review-shaped body parses", async () => {
    const draft = await build();

    const parsed = commitBodySchema.safeParse(reviewBody(draft.dto));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});

describe("buildDraftWith: a window with more photo findings than one save can mark", () => {
  const WINDOW: ScanInput = {
    name: "Many findings",
    startDay: "2031-05-02",
    endDay: "2031-05-22",
    inspect: true,
    createAlbum: false,
    target: { kind: "new" },
  };
  const JOURNEYS: DraftPhotoJourney[] = Array.from({ length: MAX_PHOTO_JOURNEYS + 5 }, (_, i) => ({
    id: madeId(1000 + i),
    startDay: dayAfter(i),
    endDay: dayAfter(i),
    defaultTick: true as const,
  }));

  const build = () =>
    buildDraftWith(
      builderDeps([], { pendingPhotoJourneys: async () => JOURNEYS }),
      USER,
      WINDOW,
      () => undefined
    );

  it("shows the earliest MAX_PHOTO_JOURNEYS and warns how many were left out", async () => {
    const { dto } = await build();

    expect(dto.photoJourneys).toHaveLength(MAX_PHOTO_JOURNEYS);
    expect(dto.photoJourneys[0].id).toBe(JOURNEYS[0].id);
    expect(dto.photoJourneys[MAX_PHOTO_JOURNEYS - 1].id).toBe(JOURNEYS[MAX_PHOTO_JOURNEYS - 1].id);
    expect(dto.warnings).toContainEqual({ code: "truncatedJourneys", params: { count: 5 } });
  });

  it("offers only those findings to the commit, so a review-shaped body parses", async () => {
    const draft = await build();

    const parsed = commitBodySchema.safeParse(reviewBody(draft.dto));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});
