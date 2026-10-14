import type { Achievement } from "../prisma";
import { prisma } from "../db";
import { now as clockNow } from "../shared/time/clock";
import { roadtripInsights } from "../services/stats/insights";
import { spanOf, STATION_SELECT } from "../services/roadtrip/roadtripSummary";
import { SKIP, type BadgeVerdict } from "./badgeSource";
import type { TourFacts } from "./tourInsights/tourFacts";
import type { RoadtripInsights } from "./roadtripInsights";

/**
 * The roadtrip badges (2.7, Part I; and the three of the statistics expansion,
 * Part K) — their measures and their check, in a module of their own. The
 * flight/place check and stats modules are frozen at their size by the
 * file-size ratchet; a new domain's badges belong beside them, not inside them.
 *
 * Every measure is read off the roadtrip insights (`utils/roadtripInsights`),
 * the same computation the statistics tab draws, through the one timeline rule
 * (`shared/tour/roadtripTimeline.ts`): a roadtrip that has not started counts
 * for nothing, and — since forgejo#260 — of one that HAS started only what has
 * happened counts. Until then the kilometres of next week's ferry reached the
 * badges on the first morning (the extension to #179). Nights come from
 * `countRoadtripNights` (a stay night is never counted twice), countries from
 * the one station-country rule.
 */
export interface RoadtripAchievementStats {
  roadtripsCount: number;
  roadtripKm: number;
  roadtripFreeNights: number;
  roadtripLongestKm: number;
  roadtripCountriesMax: number;
  roadtripBaseCamps: number;
  roadtripLandAndWater: number;
  roadtripTourStations: number;
}

export const EMPTY_ROADTRIP_STATS: RoadtripAchievementStats = {
  roadtripsCount: 0,
  roadtripKm: 0,
  roadtripFreeNights: 0,
  roadtripLongestKm: 0,
  roadtripCountriesMax: 0,
  roadtripBaseCamps: 0,
  roadtripLandAndWater: 0,
  roadtripTourStations: 0,
};

export async function calculateRoadtripAchievementStats(
  userId: string,
  now: Date = clockNow(),
  /** The tours a badge check already loaded — read once per check, not per builder. */
  tours?: TourFacts[]
): Promise<RoadtripAchievementStats> {
  // WHICH trips count is the fork's rule: a trip's OWN stored days place its
  // span (owner 2026-10-13), so a trip whose stored start is in the future is
  // planned whatever its stations say. WHAT they count is forgejo#260's,
  // read off the insights so a badge and the statistics tab cannot disagree:
  // of a trip that HAS started only what has happened counts, through the one
  // timeline rule (`shared/tour/roadtripTimeline.ts`). The fork's query is kept
  // for the stored days — the insights load their own rows.
  const [rows, { response, awards }] = await Promise.all([
    prisma.tripRoute.findMany({
      where: { userId, kind: "roadtrip" },
      select: {
        // The row's own days count here too (owner 2026-10-13): a trip whose
        // stored start is in the future is planned, whatever its stations say.
        // `id` keys the insight row the measures are read from.
        id: true,
        startDay: true,
        endDay: true,
        stops: { select: STATION_SELECT },
      },
    }),
    roadtripInsights(userId, now, { tours }),
  ]);
  const measured = new Map(response.roadtrips.map((r) => [r.id, r]));

  const stats = { ...EMPTY_ROADTRIP_STATS };
  for (const row of rows) {
    const { startDate } = spanOf(row.stops, row);
    if (startDate && Date.parse(startDate) > now.getTime()) continue;
    // Only what has happened: the insight row's `recorded` halves, never the
    // whole trip — a ferry still ahead is not kilometres already driven.
    const insight = measured.get(row.id);
    const km = insight?.km.recorded ?? 0;
    stats.roadtripsCount += 1;
    stats.roadtripKm += km;
    stats.roadtripFreeNights += insight?.nightsByStyle.pitch ?? 0;
    stats.roadtripLongestKm = Math.max(stats.roadtripLongestKm, km);
    stats.roadtripCountriesMax = Math.max(
      stats.roadtripCountriesMax,
      insight?.countries.recorded.length ?? 0
    );
  }

  // The three Part K measures have no fork logic — their one home is the
  // roadtrip insights, so upstream's expansion of the badge set counts here too.
  stats.roadtripBaseCamps = awards.baseCampStations;
  stats.roadtripLandAndWater = awards.landAndWaterTrips;
  stats.roadtripTourStations = awards.tourStations;
  return stats;
}

/** The badge measures off the roadtrip view's awards — the check's and the evidence's one home. */
export function roadtripBadgeStats(awards: RoadtripInsights["awards"]): RoadtripAchievementStats {
  return {
    roadtripsCount: awards.roadtripsCount,
    roadtripKm: awards.recordedKm,
    roadtripFreeNights: awards.recordedFreeNights,
    roadtripLongestKm: awards.longestRecordedKm,
    roadtripCountriesMax: awards.recordedCountriesMax,
    roadtripBaseCamps: awards.baseCampStations,
    roadtripLandAndWater: awards.landAndWaterTrips,
    roadtripTourStations: awards.tourStations,
  };
}

const MEASURE: Record<string, keyof RoadtripAchievementStats> = {
  roadtrip_count: "roadtripsCount",
  roadtrip_km: "roadtripKm",
  roadtrip_free_nights: "roadtripFreeNights",
  roadtrip_longest_km: "roadtripLongestKm",
  roadtrip_countries_single: "roadtripCountriesMax",
  roadtrip_base_camp: "roadtripBaseCamps",
  roadtrip_land_and_water: "roadtripLandAndWater",
  roadtrip_tour_stations: "roadtripTourStations",
};

/** The requirement types this module answers — the seeds and the badge evidence read it. */
export const ROADTRIP_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/**
 * The badge's progress, `null` when it is not a roadtrip badge, or `"skip"`
 * when it is one but its measures could not be computed this time (`stats`
 * null): then the stored row stays exactly as it is — a failed read is not a
 * fallen measure, and must not cost a badge.
 */
export function checkRoadtripAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: RoadtripAchievementStats | null
): BadgeVerdict | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  if (stats === null) return SKIP;
  const progress = Math.floor(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
