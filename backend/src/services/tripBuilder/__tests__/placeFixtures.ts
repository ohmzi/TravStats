import type { LocalMinute, PhotoFlags, PhotoPoint } from "../types";

/**
 * Synthetic places for the trip builder's tests (public repository: invented
 * names, no real itinerary). The coordinates sit in a quiet corner of the
 * South Island; the clock is NZST (UTC+12), which holds all of May to
 * September, so a fixture date in those months needs no daylight-saving rule.
 */
export const NORTHVALE = { lat: -45.05, lon: 168.7 };
/** About 53 km north-east of Northvale: a different city under the 30 km link. */
export const PORT_CARROW = { lat: -44.7, lon: 169.15 };
/** "Kelmore, Westshire": the invented home town, about 355 km from Northvale. */
export const KELMORE = { lat: -43.53, lon: 172.64 };

const NZST_OFFSET_MS = 12 * 3_600_000;
const FOUR_HOURS_MS = 4 * 3_600_000;

type Overrides = Partial<Omit<PhotoPoint, "flags">> & { flags?: Partial<PhotoFlags> };

/** The wall clock `YYYY-MM-DD HH:MM` read as if it were UTC, in epoch milliseconds. */
function wallClockMs(local: LocalMinute): number {
  return Date.parse(`${local.replace(" ", "T")}:00Z`);
}

/** One located photo taken at `local` (NZST); everything else is a plain iPhone JPEG. */
export function photo(
  id: string,
  local: LocalMinute,
  at: { lat: number | null; lon: number | null },
  overrides: Overrides = {}
): PhotoPoint {
  const { flags, ...rest } = overrides;
  return {
    id,
    type: "IMAGE",
    ownerId: "owner-1",
    visibility: "timeline",
    tMs: wallClockMs(local) - NZST_OFFSET_MS,
    zone: "Pacific/Auckland",
    local,
    day: local.slice(0, 10),
    nightDay: new Date(wallClockMs(local) - FOUR_HOURS_MS).toISOString().slice(0, 10),
    lat: at.lat,
    lon: at.lon,
    city: null,
    state: null,
    country: null,
    make: "Apple",
    model: "iPhone 14 Pro",
    originalFileName: `${id}.JPG`,
    isFavorite: false,
    duplicateId: null,
    flags: {
      clockCase: "A",
      zoneSource: "gps",
      dayGuessed: false,
      exifZoneOverridden: false,
      located: at.lat !== null && at.lon !== null,
      duplicate: false,
      misdated: null,
      atSea: false,
      inFlight: false,
      layover: false,
      ...flags,
    },
    ...rest,
  };
}
