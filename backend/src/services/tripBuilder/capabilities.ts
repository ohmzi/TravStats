/**
 * What the caller can do with the trip builder (spec 2026-10-09 §F,
 * `GET /trip-builder/capabilities`). Not cached; Immich is asked with a
 * four-second client because the browser gives up after ten.
 *
 * A shared (admin or ENV) connection is never asked for its key: the answer
 * would hand a normal user the operator's permissions, and an album may only be
 * written with the user's own key.
 */
import { currentPeriod } from "../../utils/homeAirport";
import { loadVisibleDomains } from "../domainVisibility";
import { loadHomePeriods } from "../home/homeStore";
import {
  ALBUM_SCOPES,
  CAPABILITY_TIMEOUT_MS,
  INSPECT_SCOPES,
  scopesMissing,
} from "../immich/immichCapabilities";
import { createImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";
import type { ImmichConnection } from "../immich/types";
import { resolveRoadProbes } from "./probe";
import type { CapabilitiesDto } from "./types";

const UNKNOWN_INSPECT = { ok: null, missingScopes: [] as string[] };

async function readPermissions(conn: ImmichConnection): Promise<string[] | null> {
  try {
    const key = await createImmichClient(conn, { timeoutMs: CAPABILITY_TIMEOUT_MS }).getMyApiKey();
    return key ? key.permissions : null;
  } catch {
    return null;
  }
}

async function immichCapabilities(
  conn: ImmichConnection | null
): Promise<CapabilitiesDto["immich"]> {
  if (!conn) {
    return {
      configured: false,
      source: null,
      inspect: UNKNOWN_INSPECT,
      album: { canCreate: false, reason: "notConfigured" },
    };
  }
  if (conn.source !== "user") {
    return {
      configured: true,
      source: conn.source,
      inspect: UNKNOWN_INSPECT,
      album: { canCreate: false, reason: "sharedConnection" },
    };
  }
  const permissions = await readPermissions(conn);
  if (permissions === null) {
    return {
      configured: true,
      source: "user",
      inspect: UNKNOWN_INSPECT,
      album: { canCreate: null, reason: "unverified" },
    };
  }
  const inspectMissing = scopesMissing(permissions, INSPECT_SCOPES);
  const albumMissing = scopesMissing(permissions, ALBUM_SCOPES);
  return {
    configured: true,
    source: "user",
    inspect: { ok: inspectMissing.length === 0, missingScopes: inspectMissing },
    album:
      albumMissing.length === 0
        ? { canCreate: true, reason: null }
        : { canCreate: false, reason: "missingScopes" },
  };
}

export async function builderCapabilities(userId: string): Promise<CapabilitiesDto> {
  const [conn, domains, roads, periods] = await Promise.all([
    getImmichConnection(userId),
    loadVisibleDomains(userId),
    resolveRoadProbes(userId),
    loadHomePeriods(userId),
  ]);
  const home = currentPeriod(periods);
  const known = home?.residence != null;
  return {
    immich: await immichCapabilities(conn),
    roadtrips: domains.includes("roadtrip"),
    routing: { available: roads.available, canProbe: roads.canProbe },
    home: { known, confirmed: known && home?.residenceConfirmed === true },
  };
}
