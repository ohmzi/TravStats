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
 * roadtrip's own — synthetically, "Southbridge 2031 Road Trip (Eastport loop)"
 * showing "Eastport loop".
 *
 * The albums hang off the TRIP, so the stored names are the only tie back to
 * the section, and two naming pairs carry one:
 * - the stopover pair shares ONE name (spec 2026-10-11 stopover §1): the
 *   roadtrip and its album are both `<City> <Year> Road Trip`, so an album
 *   named exactly like the roadtrip is the roadtrip's own — the trip-named
 *   roadtrip resolves the journey's own album the same way;
 * - the pitstop writer names the roadtrip `<Trip Name> · <City>` (spec
 *   2026-10-09 §C.11; the album rule is the pitstop spec 2026-10-11 §6) and its album `<City> <Year> Road Trip
 *   (<Trip Name>)` (§6), so the roadtrip name's remainder after the trip's own
 *   name is the city to look for.
 * Both are matched as literal text, and any four-digit year matches, so a stay
 * whose pictures the writer dated across a year boundary still resolves. The
 * pitstop parenthetical is required: an album without it is a stopover's,
 * another section's, or a plain one, and none of those is THIS roadtrip's.
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

  const sameName = albums.find((album) => album.albumName === roadtripName);
  if (sameName !== undefined) return sameName;

  const prefix = `${journey.name}${SECTION_NAME_SEPARATOR}`;
  if (!roadtripName.startsWith(prefix)) return fallback;

  const city = roadtripName.slice(prefix.length);
  const pitstopAlbum = new RegExp(
    `^${escapeRegExp(city)} [0-9]{4} Road Trip \\(${escapeRegExp(journey.name)}\\)$`
  );
  return albums.find((album) => pitstopAlbum.test(album.albumName)) ?? fallback;
}
