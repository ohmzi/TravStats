/**
 * Pitstop roadtrips (spec
 * docs/superpowers/specs/2026-10-11-pitstop-roadtrips-design.md, §2 and §6):
 * which areas get their own album, and what that album is called.
 *
 * An area is a pitstop when it lies strictly between two same-airport flights
 * on different local days and is not the trip's principal destination — the
 * area with the most nights, ties going to the most photo-days and then to the
 * earliest first day. The album is named `<City> <Year> Road Trip (<Trip
 * Name>)` from the area's own roadtrip main city, the parenthetical dropped
 * when it and the trip share a name.
 *
 * Pure: the areas, the night plan, the flights and the photos come in as
 * values. `buildDraftWith` runs it once, after the nights are known.
 */
import { sharesAirport } from "./flightAnchors";
import type { AreaPlan, Day, FlightAnchor, NightEntry, PhotoPoint } from "./types";

/** A pitstop area's DTO piece (spec §2, §6): its album, server-computed, and what a re-sync holds of it (spec §5). */
export interface DraftPitstop {
  /**
   * `<City> <Year> Road Trip (<Trip Name>)`; the parenthetical is dropped when
   * the city is the trip's own name (spec §6).
   */
  albumName: string;
  /**
   * Re-sync only: set ⇔ the trip links a *user-owned* album of exactly
   * `albumName` — the link the album's own named write targets
   * (`pickLinkedAlbum`), so the review shows the album switch ON, locked,
   * marked *already synced*, with the stored count beside the current one
   * (spec §5). A partner's same-named link, or one the scan could not
   * describe, is not the write's album and stays unmarked (final review,
   * finding Q3-6). Only a matched area carries it: the annotation is the
   * match's to make.
   */
  stored?: StoredPitstopStatus;
}

/** Re-sync only: the pitstop album a matched area's scan already found on the trip (spec §5). */
export interface StoredPitstopStatus {
  /** The linked album's member count when the scan read it (the link row's `assetCount`). */
  albumAssetCount: number;
  /** The area's own member count now — its movement and at-sea photos, the list the album takes (`StoredPitstop.assetIds`); the review's "now" beside it. */
  photoCount: number;
}

/** The nights the plan assigns to the area's stations; the roadtrip rows count the same nights. */
function nightsOfArea(plan: AreaPlan, nights: Readonly<Record<Day, NightEntry>>): number {
  const keys = new Set(plan.stations.map((station) => station.key));
  let count = 0;
  for (const entry of Object.values(nights)) if (keys.has(entry.assign)) count++;
  return count;
}

/** The days the area's own photos were taken on (spec §2's first tie-break). */
function photoDaysOf(plan: AreaPlan, photosById: ReadonlyMap<string, PhotoPoint>): number {
  const days = new Set<Day>();
  for (const id of [...plan.area.photoIds, ...plan.area.seaPhotoIds]) {
    const photo = photosById.get(id);
    if (photo) days.add(photo.day);
  }
  return days.size;
}

/**
 * The trip's principal destination: the area with the most nights; ties go to
 * the most photo-days, then the earliest first day, then scan order — so
 * exactly one area is elected however the trip falls (spec §2).
 */
export function principalDestination(
  areas: readonly AreaPlan[],
  nights: Readonly<Record<Day, NightEntry>>,
  photosById: ReadonlyMap<string, PhotoPoint>
): AreaPlan | null {
  let winner: AreaPlan | null = null;
  let bestNights = -1;
  let bestPhotoDays = -1;
  for (const plan of areas) {
    const areaNights = nightsOfArea(plan, nights);
    const photoDays = photoDaysOf(plan, photosById);
    const better =
      winner === null ||
      areaNights > bestNights ||
      (areaNights === bestNights &&
        (photoDays > bestPhotoDays ||
          (photoDays === bestPhotoDays && plan.area.startDay < winner.area.startDay)));
    if (better) {
      winner = plan;
      bestNights = areaNights;
      bestPhotoDays = photoDays;
    }
  }
  return winner;
}

export interface PitstopAreasInput {
  /** The draft's areas, in scan order (`night.kept`). */
  areas: readonly AreaPlan[];
  /** The night plan the draft shows; `assign` is a station key or a NIGHT_* word. */
  nights: Readonly<Record<Day, NightEntry>>;
  /** Every flight of the window; the areas' bounding ids index it. */
  anchors: readonly FlightAnchor[];
  /** Every photo of the window, by id, for the photo-day tally. */
  photosById: ReadonlyMap<string, PhotoPoint>;
  /** Area key → the main city of the roadtrip name it would get (`mainCityOf`); null without one. */
  mainCities: ReadonlyMap<string, string | null>;
  tripName: string;
}

/**
 * The pitstop of every qualifying area (spec §2), keyed by the area key: the
 * area lies strictly between two adjacent flights — one landing before it,
 * one leaving after (branch (b)'s own edge test) — that share an airport and
 * fall on different local days, and it is not the principal destination. An
 * area that does not qualify is simply absent from the answer.
 */
export function pitstopAreas(input: PitstopAreasInput): Map<string, DraftPitstop> {
  const destination = principalDestination(input.areas, input.nights, input.photosById);
  const anchorsById = new Map(input.anchors.map((anchor) => [anchor.id, anchor] as const));
  const found = new Map<string, DraftPitstop>();
  for (const plan of input.areas) {
    if (plan === destination) continue;
    const arriving =
      plan.area.afterFlightId === null ? undefined : anchorsById.get(plan.area.afterFlightId);
    const departing =
      plan.area.beforeFlightId === null ? undefined : anchorsById.get(plan.area.beforeFlightId);
    if (arriving === undefined || departing === undefined) continue;
    if (!sharesAirport(arriving, departing)) continue;
    if (arriving.arrDay === departing.depDay) continue;
    found.set(plan.key, {
      albumName: pitstopAlbumName(
        input.mainCities.get(plan.key) ?? null,
        plan.area.startDay,
        input.tripName
      ),
    });
  }
  return found;
}

/**
 * `<City> <Year> Road Trip (<Trip Name>)` (spec §6): City is the area's own
 * main city — the string its roadtrip name would follow the `·` with, the
 * trip's own name when it has none — and the parenthetical is dropped when
 * the two are the same string. Year is the area's first day's year.
 */
export function pitstopAlbumName(mainCity: string | null, startDay: Day, tripName: string): string {
  const city = mainCity ?? tripName;
  const base = `${city} ${startDay.slice(0, 4)} Road Trip`;
  return city === tripName ? base : `${base} (${tripName})`;
}

/** A pitstop area's own album as the commit reads it (spec 2026-10-11 pitstops §4). SERVER-ONLY. */
export interface StoredPitstop {
  /** The area key (`<startDay>#<n>`), the same key the DTO area carries. */
  key: string;
  /** `<City> <Year> Road Trip (<Trip Name>)`: the name the review showed (§6). */
  albumName: string;
  /** The area's first day (`YYYY-MM-DD`, trip zone): the window the album stands for. */
  day: Day;
  /** The area's own photo set — the album's members. No request ever carries an id. */
  assetIds: string[];
}

/**
 * The pitstop areas' album records, as the commit reads them (spec §4): an
 * album takes the area's own photos — its movement and at-sea photos, the
 * branch-(b) stopover album's own set — and no DTO may carry an id, so the
 * scan keeps them beside the name. Only a qualifying area is listed, in scan
 * order.
 */
export function storedPitstops(
  areas: readonly AreaPlan[],
  found: ReadonlyMap<string, DraftPitstop>
): StoredPitstop[] {
  const stored: StoredPitstop[] = [];
  for (const plan of areas) {
    const pitstop = found.get(plan.key);
    if (pitstop === undefined) continue;
    stored.push({
      key: plan.key,
      albumName: pitstop.albumName,
      day: plan.area.startDay,
      assetIds: [...plan.area.photoIds, ...plan.area.seaPhotoIds],
    });
  }
  return stored;
}
