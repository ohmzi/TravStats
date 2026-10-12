import type { RoadtripDetail } from "../../types/roadtrip";

/** The journey half of a roadtrip's detail: the albums hang off it, not off the section. */
export type RoadtripJourney = NonNullable<RoadtripDetail["trip"]>;

/** One album the journey links, as the roadtrip detail returns it. */
export type RoadtripJourneyAlbum = NonNullable<RoadtripJourney["immichAlbums"]>[number];

/**
 * What the photo trip builder puts between a trip's name and a roadtrip's city
 * (spec 2026-10-09 §C.11). Mirrors the backend's `SECTION_NAME_SEPARATOR`
 * (`services/trip/renameTripSections.ts`), which understands the same pair.
 */
const SECTION_NAME_SEPARATOR = " · ";

/** Text taken literally inside a `RegExp` built from a name. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The album a roadtrip's band points at (owner-reported, 2026-10-12): every
 * roadtrip of a journey showed the journey's first linked album instead of the
 * roadtrip's own. The naming ruling (owner, 2026-10-12) settled the pairing
 * with ONE rule — a trip and its album share one name, the string the scan's
 * one naming pass mints (`roadtripAreaNames`): "<Journey name> · <City>", or
 * the journey's own name when the journey holds exactly one trip — so an album
 * named exactly like the roadtrip IS the roadtrip's own, clash suffixes
 * included.
 *
 * LEGACY (stored rows only): rows minted before that ruling still carry their
 * old pairs, and no re-sync renames the albums a journey already links — a
 * stopover's roadtrip and album shared "<City> <Year> Road Trip" (which the
 * exact-name arm above still matches), and a pitstop's roadtrip was
 * "<Trip Name> · <City>" against album "<City> <Year> Road Trip (<Trip
 * Name>)" (the regex below, kept for exactly those stored rows). The legacy
 * pair is matched as literal text, and any four-digit year matches, so a stay
 * whose pictures the writer dated across a year boundary still resolves.
 *
 * A name that matches no pair is a section named by hand; it keeps today's
 * answer, the journey's first album. A journey with no linked albums has no
 * cell value (null), as before.
 */
export function albumForRoadtrip(
  journey: RoadtripJourney,
  roadtripName: string
): RoadtripJourneyAlbum | null {
  const albums = journey.immichAlbums ?? [];
  const fallback = albums[0] ?? null;

  // The one rule: the album's name is the trip's name (owner ruling 2026-10-12).
  const sameName = albums.find((album) => album.albumName === roadtripName);
  if (sameName !== undefined) return sameName;

  // LEGACY: a stored pitstop row's "<Trip Name> · <City>" against its album
  // "<City> <Year> Road Trip (<Trip Name>)"; new rows take the arm above.
  const prefix = `${journey.name}${SECTION_NAME_SEPARATOR}`;
  if (!roadtripName.startsWith(prefix)) return fallback;

  const city = roadtripName.slice(prefix.length);
  const pitstopAlbum = new RegExp(
    `^${escapeRegExp(city)} [0-9]{4} Road Trip \\(${escapeRegExp(journey.name)}\\)$`
  );
  return albums.find((album) => pitstopAlbum.test(album.albumName)) ?? fallback;
}
