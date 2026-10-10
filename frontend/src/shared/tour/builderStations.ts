/**
 * What the scan and the review page agree on about a station card (spec
 * 2026-10-09 §C.9, §G): the note a scan pre-fills, how many thumbnails a card
 * holds, and how close counts as the same place.
 *
 * Mirror of `backend/src/shared/tour/builderStations.ts` — change both
 * together. The review page tells a note the user typed from one the scan wrote
 * by comparing it with what `defaultStationNotes` writes, so the wording must be
 * one piece of code: a changed word on one side would make every pre-filled note
 * look hand-written and a merge would stop writing the note again. Pure and
 * import-free, so both trees hold the same file.
 */

/** Thumbnails per station card. The server's `PREVIEWS_PER_STATION`, held equal by its thresholds test. */
export const MAX_STATION_PREVIEWS = 6;

/** The return from an excursion is the same place within this many km. The server's `CITY_LINK_KM`, held equal by its thresholds test. */
export const SAME_PLACE_KM = 30;

/** What a station's pre-filled note is written from. */
export interface StationNoteFacts {
  firstLocal: string | null;
  lastLocal: string | null;
  photoCount: number;
}

/** "First photo 16:00 · last 08:00 · 3 photos", or null for a station with no photos of its own. */
export function defaultStationNotes(station: StationNoteFacts): string | null {
  if (!station.firstLocal || !station.lastLocal) return null;
  const photos = station.photoCount === 1 ? "1 photo" : `${station.photoCount} photos`;
  return `First photo ${station.firstLocal.slice(11, 16)} · last ${station.lastLocal.slice(11, 16)} · ${photos}`;
}
