/**
 * Bringing a journey's stored trip rows and their albums to the naming
 * convention (owner instruction 2026-10-12: "after changes are deployed update
 * all the existing trip and album names through the new logic, try to run it
 * via code rather than modifying the data").
 *
 * The naming change (cac861fd7/90f9e2dac/2704c39b5) names FUTURE scans. For a
 * row that already exists this module rebuilds the one input the scan's naming
 * pass needs — the row's city — and then asks the pass itself what the row is
 * called now. Nothing here is re-stated:
 *
 * - `roadtripAreaNames` (`shared/tour/builderNightPlan.ts`) IS the rule: the
 *   "<Journey name> · <City>" form, the journey's own name for a one-trip
 *   journey, and the ` (d MMM)`/numbering clash suffixes all come from it.
 * - `SECTION_NAME_SEPARATOR` (`services/trip/renameTripSections.ts`) is the
 *   " · " the pass mints and this module reads back. (`builderNightPlan`'s own
 *   `AREA_NAME_SEPARATOR` is private; the two carry the same string.)
 * - `sharesAirport` (`flightAnchors.ts`) is the scan's same-airport test, and
 *   `pitstopCity` (`pitstops.ts`) its pitstop city chain: the shared airport's
 *   served city, a slash list counting as its first name, then the airport's
 *   display name.
 *
 * The city chain for a stored row, in the brief's order: the pitstop rule
 * first (the row lies strictly between two ADJACENT same-airport flights on
 * different local days), else the row's own name — the segment after the last
 * separator, else the leading city of one of the two legacy minted shapes —
 * else no city and the row is skipped.
 *
 * Pure: rows, flights and airports come in as values. The script
 * (`scripts/renameTripNames.ts`) reads them and applies the answers; the
 * album linkage below mirrors the trip page's resolver
 * (`frontend/src/lib/roadtrip/roadtripAlbum.ts`), which no backend module can
 * import, arm for arm.
 */
import { roadtripAreaNames } from "../../shared/tour/builderNightPlan";
import type { AirportData } from "../airportLookup";
import { SECTION_NAME_SEPARATOR } from "../trip/renameTripSections";
import { sharesAirport } from "./flightAnchors";
import { pitstopCity } from "./pitstops";
import type { FlightAnchor } from "./types";

/** Where a row's city came from; the report prints it, and it says WHY a skipped row was skipped. */
export type CitySource = "pitstop" | "separator" | "legacy" | "none";

/** A row's city as re-derived, with its source. */
export interface RowCity {
  city: string | null;
  source: CitySource;
}

/** The row's own span, from its stations (`YYYY-MM-DD` days). */
export interface RowSpan {
  startDay: string;
  endDay: string;
}

/**
 * `<City> <Year> Road Trip` and `<City> <Year> Road Trip (<Trip>)` — the two
 * shapes the pre-ruling scan minted (`pitstopAlbumName`, `stopoverTitle`).
 * Accepted as literal text, nothing else: a four-digit year, the exact words,
 * an optional parenthetical; a name of any other shape falls through to "no
 * city", never a guess.
 */
const LEGACY_ROAD_TRIP = /^(.+?) [0-9]{4} Road Trip(?: \(.+\))?$/;

/**
 * The city a row's own name carries:
 * - the segment after the LAST convention separator ("Karachi 2031 · Port
 *   Carrow (2 May)" keeps the suffix — it is what the row already says), or
 * - the leading `<City>` of one of the two legacy shapes.
 *
 * Anything else is null: a name not minted by the scan stays the user's.
 */
export function cityFromRowName(name: string): { city: string; source: CitySource } | null {
  const at = name.lastIndexOf(SECTION_NAME_SEPARATOR);
  if (at >= 0) {
    const city = name.slice(at + SECTION_NAME_SEPARATOR.length);
    if (city.trim() !== "") return { city, source: "separator" };
  }
  const legacy = LEGACY_ROAD_TRIP.exec(name);
  if (legacy) return { city: legacy[1], source: "legacy" };
  return null;
}

/**
 * The two ADJACENT flights of `flights` a pitstop row lies strictly between,
 * or null. The scan's own matcher (`pitstopAreas`, `pitstops.ts`): the landing
 * flight and the departing flight immediately after it in departure order,
 * `sharesAirport`, on different local days (the same day is a layover). This
 * side of it is the stored row's: its whole span must fall strictly inside the
 * gap — after the arrival day, before the departure day — because a row only
 * has days to go on where the scan had photo instants.
 */
export function pitstopFlights(
  flights: readonly FlightAnchor[],
  span: RowSpan
): { arriving: FlightAnchor; departing: FlightAnchor } | null {
  for (let i = 0; i + 1 < flights.length; i++) {
    const arriving = flights[i];
    const departing = flights[i + 1];
    if (!sharesAirport(arriving, departing)) continue;
    if (arriving.arrDay === departing.depDay) continue;
    if (arriving.arrDay < span.startDay && span.endDay < departing.depDay) {
      return { arriving, departing };
    }
  }
  return null;
}

/**
 * The row's city by the brief's chain: the pitstop rule first (the shared
 * airport's served city — `pitstopCity`, whose fallback is null here because
 * the photo-majority city the scan passed does not exist for a stored row),
 * else the row's own name. A matched pair whose airport the catalogue cannot
 * describe falls through to the name rather than inventing a city.
 */
export function rowCityOf(input: {
  name: string;
  span: RowSpan | null;
  /** The journey's flights, in departure order. */
  flights: readonly FlightAnchor[];
  airports: ReadonlyMap<string, AirportData>;
}): RowCity {
  if (input.span !== null) {
    const pair = pitstopFlights(input.flights, input.span);
    if (pair !== null) {
      const iata = pair.arriving.arrIata;
      const airport = iata === null ? null : (input.airports.get(iata.toUpperCase()) ?? null);
      const city = pitstopCity(airport, null);
      if (city !== null) return { city, source: "pitstop" };
    }
  }
  const named = cityFromRowName(input.name);
  return named === null ? { city: null, source: "none" } : named;
}

/** One album a journey links, as the roadtrip detail hands it to the page's resolver. */
export interface LinkedAlbumRef {
  /** `trip_immich_albums.id` — the linkage row the script updates with the album. */
  linkId: string;
  immichAlbumId: string;
  albumName: string;
}

/**
 * Which album the trip page resolves for `rowName` (`albumForRoadtrip`,
 * mirrored because no backend imports a frontend lib):
 * - `own`/`name`: an album named exactly like the row — the ruling's one pair.
 * - `own`/`legacy`: the stored pitstop pair, row "<Trip> · <City>" against
 *   album "<City> <Year> Road Trip (<Trip>)".
 * - `journey`: the page's fallback, the journey's first linked album — the row
 *   has no album of its own. Read and reported, never renamed: it is the
 *   journey's album (the main album keeps the journey's name).
 * - `none`: the journey links no album at all.
 */
export type AlbumTarget =
  | { kind: "own"; via: "name" | "legacy"; album: LinkedAlbumRef }
  | { kind: "journey"; album: LinkedAlbumRef }
  | { kind: "none" };

function legacyPitstopAlbum(
  journeyName: string,
  albums: readonly LinkedAlbumRef[],
  rowName: string
): LinkedAlbumRef | null {
  const prefix = `${journeyName}${SECTION_NAME_SEPARATOR}`;
  if (!rowName.startsWith(prefix)) return null;
  const city = rowName.slice(prefix.length);
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trip = journeyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pitstop = new RegExp(`^${escaped} [0-9]{4} Road Trip \\(${trip}\\)$`);
  return albums.find((candidate) => pitstop.test(candidate.albumName)) ?? null;
}

export function rowAlbumOf(
  journeyName: string,
  albums: readonly LinkedAlbumRef[],
  rowName: string
): AlbumTarget {
  const fallback = albums[0] ?? null;
  const sameName = albums.find((candidate) => candidate.albumName === rowName);
  if (sameName !== undefined) return { kind: "own", via: "name", album: sameName };
  const legacy = legacyPitstopAlbum(journeyName, albums, rowName);
  if (legacy !== null) return { kind: "own", via: "legacy", album: legacy };
  return fallback === null ? { kind: "none" } : { kind: "journey", album: fallback };
}

/** One stored roadtrip row with the city already re-derived for it. */
export interface RenameRowInput {
  id: string;
  name: string;
  /** The row's own span from its stations, null without one. */
  startDay: string | null;
  endDay: string | null;
  city: string | null;
  citySource: CitySource;
}

/** What the plan decided for one row. */
export interface RowPlan {
  rowId: string;
  oldName: string;
  /** What the scan's naming pass calls the row now; the stored name when nothing moves. */
  newName: string;
  changed: boolean;
  /** Why the row keeps its name, when it does so for want of a city (or a day). */
  skipped: string | null;
}

export const SKIP_NO_CITY =
  'no city: not between two same-airport flights, no " · " in the name, not a legacy shape';
export const SKIP_NO_DATES = "no dates: neither the row nor the journey has days";
export const SKIP_HAND_NAMED =
  "no city in the name and the journey holds one trip of another name — left by hand?";

/**
 * What every roadtrip row of one journey is called under the naming
 * convention, from the pass itself (`roadtripAreaNames`). The rows are named
 * in travel order; a row whose city (or, for the one-trip journey, whose name)
 * cannot be trusted is skipped and its stored name joins the pass's
 * `takenNames`, so no renamed row can land on a name nobody moves.
 *
 * - One row: the journey's own name — the pass's single-trip exception — so
 *   nothing is skipped for want of a city unless the name is a hand's (then it
 *   stays) or already IS the journey's name (then it is unchanged).
 * - Several: `"<journey> · <city>"` with the pass's clash suffixes, over the
 *   rows whose city was re-derived and that have a day to be placed by.
 *
 * Every row of the journey goes INTO the pass, even one that is skipped: the
 * single-trip exception counts the journey's trips, and a skipped row holds
 * its stored name, so it must count and it must sit in the clash pool. Only
 * the renameable rows' answers are read.
 */
export function planJourneyRename(
  journeyName: string,
  journeyStartDay: string | null,
  rows: readonly RenameRowInput[]
): RowPlan[] {
  const place = (row: RenameRowInput): string | null => row.startDay ?? journeyStartDay;
  const single = rows.length === 1;
  const planned = (row: RenameRowInput): boolean =>
    single
      ? row.city !== null || row.name === journeyName
      : row.city !== null && place(row) !== null;

  const taken = new Set(rows.filter((row) => !planned(row)).map((row) => row.name));
  // The pass's own order — a stable sort by start day, as the scan feeds it —
  // so the numbering suffix two rows of one day share lands the same way.
  const LAST_DAY = "9999-12-31";
  const inTravelOrder = [...rows].sort((a, b) => {
    const dayA = place(a) ?? LAST_DAY;
    const dayB = place(b) ?? LAST_DAY;
    return dayA < dayB ? -1 : dayA > dayB ? 1 : 0;
  });
  const names = roadtripAreaNames(
    inTravelOrder.map((row) => ({ key: row.id, mainCity: row.city, startDay: place(row) ?? "" })),
    journeyName,
    taken
  );

  const skipReason = (row: RenameRowInput): string => {
    if (single) return SKIP_HAND_NAMED;
    return row.city === null ? SKIP_NO_CITY : SKIP_NO_DATES;
  };

  return rows.map((row) => {
    if (planned(row)) {
      const newName = names[row.id] ?? row.name;
      return {
        rowId: row.id,
        oldName: row.name,
        newName,
        changed: newName !== row.name,
        skipped: null,
      };
    }
    return {
      rowId: row.id,
      oldName: row.name,
      newName: row.name,
      changed: false,
      skipped: skipReason(row),
    };
  });
}
