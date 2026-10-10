/**
 * What an Immich API key may do, read from `GET /api-keys/me` (spec 2026-10-09 §B).
 *
 * The key is asked once, with a short timeout, and the answer is compared with
 * the permissions a feature needs. Never an exception: `true` or `false` when
 * Immich answered, `null` when it could not say (a credential that is not an API
 * key, an Immich too old for the endpoint, a network failure). Callers read
 * `null` as "could not verify", not as "denied": refusing album creation on a
 * hiccup would be as wrong as promising it.
 *
 * `testImmichConnection` is deliberately NOT extended with this: its callers and
 * their tests pass it exactly `(baseUrl, apiKey)`, and the settings route decides
 * whose key may be asked (see `routes/settings/immich.ts`).
 */
import logger from "../../utils/logger";
import { createImmichClient, ImmichClient } from "./immichClient";
import { ImmichError } from "./types";

/** Creating a trip album: find it, create it, fill it. */
export const ALBUM_SCOPES = ["album.read", "album.create", "albumAsset.create"] as const;
/** Reading a library for the builder: search it, learn who owns what, show thumbnails. */
export const INSPECT_SCOPES = ["asset.read", "user.read", "asset.view"] as const;
/** The settings test and the capabilities endpoint answer inside a browser request. */
export const CAPABILITY_TIMEOUT_MS = 4_000;

export interface AlbumCapability {
  /** `ALBUM_SCOPES` all granted; null when Immich could not say. */
  canCreateAlbums: boolean | null;
  /** `INSPECT_SCOPES` all granted; null when Immich could not say. */
  canView: boolean | null;
  /** The `ALBUM_SCOPES` the key lacks, in that order; empty when unanswered. */
  missingScopes: string[];
}

/**
 * What the settings test reports for a key. A key the caller does not own (the
 * administrator's, or the environment's) is never asked: it answers
 * `sharedConnection`, so one user is never handed another account's permissions.
 */
export type ImmichKeyCapabilities =
  AlbumCapability | { canCreateAlbums: false; sharedConnection: true };

/** The `required` scopes `granted` lacks, in the order required. `"all"` lacks none. */
export function scopesMissing(granted: readonly string[], required: readonly string[]): string[] {
  if (granted.includes("all")) return [];
  return required.filter((scope) => !granted.includes(scope));
}

/** The permissions of the key, or null when Immich cannot say. Never throws. */
export async function readKeyScopes(baseUrl: string, apiKey: string): Promise<string[] | null> {
  try {
    const client = createImmichClient(
      { baseUrl, apiKey, source: "user" },
      { timeoutMs: CAPABILITY_TIMEOUT_MS }
    );
    const key = await client.getMyApiKey();
    return key === null ? null : key.permissions;
  } catch (error) {
    logger.warn({
      message: "immich_capability_check_failed",
      context: { kind: error instanceof ImmichError ? error.kind : "unexpected" },
    });
    return null;
  }
}

/** Whether the key can create trip albums and read a library. Never throws. */
export async function albumCapability(baseUrl: string, apiKey: string): Promise<AlbumCapability> {
  const granted = await readKeyScopes(baseUrl, apiKey);
  if (granted === null) return { canCreateAlbums: null, canView: null, missingScopes: [] };

  const missingAlbum = scopesMissing(granted, ALBUM_SCOPES);
  return {
    canCreateAlbums: missingAlbum.length === 0,
    canView: scopesMissing(granted, INSPECT_SCOPES).length === 0,
    missingScopes: missingAlbum,
  };
}

/**
 * Scopes that make an album feature better but are not needed to have albums.
 * `albumAsset.delete` lets a re-sync take photos out of an album once the trip's
 * dates shrink; without it the removal switch is disabled, never an error.
 */
export const ALBUM_REMOVE_SCOPE = "albumAsset.delete";
export const ALBUM_OPTIONAL_SCOPES = [ALBUM_REMOVE_SCOPE] as const;

export interface AlbumRemovalCapability {
  /** null: `/api-keys/me` could not answer, so the key's scopes are unknown. */
  allowed: boolean | null;
  missingScope?: string;
}

/**
 * Whether the key may remove assets from an album, asked at the moment it is
 * needed (the scan, and again at the commit — a key can change in between). A
 * failed or refused read is "unknown", never "allowed".
 */
export async function albumRemovalCapability(
  client: Pick<ImmichClient, "getMyApiKey">
): Promise<AlbumRemovalCapability> {
  let key: Awaited<ReturnType<ImmichClient["getMyApiKey"]>>;
  try {
    key = await client.getMyApiKey();
  } catch {
    return { allowed: null };
  }
  if (key === null) return { allowed: null };
  const missing = scopesMissing(key.permissions, ALBUM_OPTIONAL_SCOPES);
  return missing.length === 0 ? { allowed: true } : { allowed: false, missingScope: missing[0] };
}
