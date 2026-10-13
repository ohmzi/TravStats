export type ImmichMode = "link" | "import";

export type ImmichConnectionSource = "user" | "global" | "env";

export interface ImmichConnectionStatus {
  baseUrl: string | null;
  hasKey: boolean;
  defaultMode: ImmichMode;
  source: ImmichConnectionSource | null;
  isShared: boolean;
  hasAccess: boolean;
  /**
   * The Immich address a BROWSER can reach, for "Open in Immich" links —
   * `baseUrl` above is the connection's own address (often the internal
   * container one) and is deliberately never emitted into a link.
   *
   * Optional: the setting does not exist on the backend yet, so today's
   * `GET /settings/immich` never sends it and the link stays hidden. An owner
   * who wants the link needs this value configured (controller decision,
   * 2026-10-13).
   */
  webUrl?: string | null;
}

/**
 * What the tested key may do with trip albums, from `POST /settings/immich/test`
 * on success. `canCreateAlbums: null` means Immich could not say (not "denied").
 * `sharedConnection` marks an administrator's or environment key, which is never
 * asked: albums need the user's own key.
 */
export interface ImmichKeyCapabilities {
  canCreateAlbums: boolean | null;
  canView?: boolean | null;
  /** The album permissions the key lacks; empty when unanswered. */
  missingScopes?: string[];
  sharedConnection?: boolean;
}

export interface ImmichTestResult {
  success: boolean;
  /** English, for debugging only — the UI renders `errors.<kind>` instead. */
  message: string;
  /** Machine-readable failure classification, present only on failure. */
  kind?: ImmichFailureKind;
  details?: { version?: string; user?: string; capabilities?: ImmichKeyCapabilities };
}

export interface ImmichAlbumSummary {
  id: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  linked: boolean;
  linkId: string | null;
}

export interface LinkedAlbum {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  mode: ImmichMode;
  sortIdx: number;
  lastSyncedAt: string | null;
}

/**
 * One asset of a linked album as the gallery serves it. The first six fields
 * are the gallery's own (grid + day grouping); the rest is what the viewer's
 * Details panel can show, copied from Immich's EXIF block or null — the album
 * route serves them since 2026-10-13. An imported copy has no EXIF block, so
 * only its own row facts (file name, size, dates) come back filled.
 */
export interface ImmichGalleryAsset {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  make: string | null;
  model: string | null;
  lensModel: string | null;
  focalLength: number | null;
  fNumber: number | null;
  exposureTime: string | null;
  iso: number | null;
}

export interface ImportJob {
  status: "pending" | "running" | "completed" | "failed";
  totalAssets: number;
  processedAssets: number;
  failedAssets: number;
  error: string | null;
}

export interface ImportEstimate {
  assetCount: number;
  totalBytes: number;
}

/**
 * Why an Immich-backed request failed. `notConfigured` comes back as 409 from
 * our own API; `invalidUrl` is a rejected base URL (the user's typo); the rest
 * are upstream kinds surfaced as 502. `invalidUrl` and `protocol` are kept
 * distinct so a malformed URL is not misreported as a server-version mismatch.
 *
 * `keyRequired` is the one kind that is not a failure of the server being
 * addressed: the caller asked to test a DIFFERENT target while relying on a
 * key configured for the instance rather than by them. That key stays bound to
 * its own target, so a new one has to be supplied (AUD-087).
 */
export type ImmichFailureKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl" | "keyRequired";
