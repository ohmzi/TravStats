/**
 * The real dependencies of a scan (spec 2026-10-09 §C.12): the user's Immich
 * connection and identity, home, country data, routing, flights and the
 * database lookups, bound to one user and one request. `buildDraftWith`
 * never learns where any of it came from.
 */
import { randomUUID } from "crypto";

import { now } from "../../shared/time/clock";
import { findNearestAirport } from "../airportLookup";
import { getCachedAirports } from "../airportCache";
import { loadVisibleDomains } from "../domainVisibility";
import { reverseGeocode } from "../geo/nominatim";
import { getCountryResolver } from "../geo/countryFromCoordinates";
import { loadHomePeriods } from "../home/homeStore";
import { CAPABILITY_TIMEOUT_MS } from "../immich/immichCapabilities";
import { createImmichClient } from "../immich/immichClient";
import type { ImmichConnection } from "../immich/types";
import type { AlbumDeps, BuilderDeps } from "./buildDraft";
import {
  albumGateOf,
  linkedTripNameOf,
  loadTargetTrip,
  overlappingTripsOf,
  pendingJourneysOf,
} from "./builderQueries";
import { loadFlights } from "./loadFlights";
import { loadExistingTitles } from "./nameClusters";
import { resolveRoadProbes } from "./probe";
import { AIRPORT_NEAR_KM } from "./thresholds";
import type { ScanInput } from "./types";

async function albumDepsOf(
  conn: ImmichConnection,
  immichUserId: string,
  targetTripId: string | null,
  userId: string
): Promise<AlbumDeps> {
  const client = createImmichClient(conn);
  const gate = await albumGateOf(
    conn,
    createImmichClient(conn, { timeoutMs: CAPABILITY_TIMEOUT_MS })
  );
  return {
    gate,
    findOwned: async (name) => {
      const album = await client.findOwnedAlbumByName(name, immichUserId);
      return album ? { immichAlbumId: album.id, assetCount: album.assetCount } : null;
    },
    linkedTripName: (immichAlbumId) => linkedTripNameOf(userId, immichAlbumId, targetTripId),
  };
}

export async function resolveBuilderDeps(
  userId: string,
  input: ScanInput,
  conn: ImmichConnection
): Promise<BuilderDeps> {
  const client = createImmichClient(conn);
  const targetTripId = input.target.kind === "existing" ? input.target.tripId : null;
  const [me, homePeriods, countries, roads, domains, targetTrip] = await Promise.all([
    client.whoami(),
    loadHomePeriods(userId),
    getCountryResolver(),
    resolveRoadProbes(userId),
    loadVisibleDomains(userId),
    loadTargetTrip(userId, targetTripId),
  ]);
  const album = input.createAlbum ? await albumDepsOf(conn, me.id, targetTripId, userId) : null;

  return {
    immich: client,
    loadFlights: (window, target) => loadFlights(userId, window, target),
    homePeriods,
    immichUserId: me.id,
    connSource: conn.source,
    countryAt: (lat, lon) => countries.countryAt(lat, lon),
    existingTitles: (bbox) => loadExistingTitles(userId, bbox),
    reverseGeocode,
    airports: (codes) => getCachedAirports([...codes]),
    nearestAirportIata: async (c) =>
      (await findNearestAirport(c.lat, c.lon, AIRPORT_NEAR_KM))?.iata ?? null,
    roads,
    roadtripsVisible: domains.includes("roadtrip"),
    overlappingTrips: (window, exclude) => overlappingTripsOf(userId, window, exclude),
    pendingPhotoJourneys: (window) => pendingJourneysOf(userId, window),
    targetTrip,
    album,
    newId: randomUUID,
    nowMs: () => now().getTime(),
  };
}
