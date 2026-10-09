/**
 * Typed wrapper around the Immich REST API.
 *
 * Pinned to Immich OpenAPI **3.0.1**. This is the ONLY file that knows Immich's
 * paths and payload shapes — when Immich shifts its API again (it has before:
 * `/api/asset` -> `/api/assets`), this file is the entire blast radius.
 *
 * Two shapes worth remembering:
 *  - `AlbumResponseDto` carries NO asset array. Album contents come from
 *    `POST /search/metadata` with `albumIds`, which is paginated.
 *  - `size=original` on `/assets/:id/thumbnail` is deprecated in v3; the
 *    original has its own endpoint.
 */
import axios, { AxiosRequestConfig } from "axios";
import logger from "../../utils/logger";
import {
  ImmichAlbum,
  ImmichAsset,
  ImmichAssetDetail,
  ImmichAssetSize,
  ImmichConnection,
  ImmichError,
  ImmichVisibility,
} from "./types";

/** Immich caps `size` at 1000. */
const PAGE_SIZE = 1000;
/** Hard stop so a misbehaving server can never spin us forever. */
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15_000;
/** Streaming a full-size original over a slow LAN needs more headroom. */
const STREAM_TIMEOUT_MS = 60_000;

export interface ImmichAssetStream {
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number | null;
}

export interface ImmichIdentity {
  id: string;
  email: string;
  name: string;
}

export interface ImmichClientOptions {
  /**
   * Per-request timeout of the JSON calls; default `REQUEST_TIMEOUT_MS`. The
   * capability check and the commit preflight pass 4 s so a slow Immich cannot
   * outlast the browser request that asked. Downloads keep their own timeout.
   */
  timeoutMs?: number;
}

/** A usable timeout is a positive finite number; anything else (0 means "none" to axios) is the default. */
function requestTimeout(options: ImmichClientOptions): number {
  const { timeoutMs } = options;
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : REQUEST_TIMEOUT_MS;
}

export interface ImmichClient {
  getServerVersion(): Promise<string>;
  whoami(): Promise<ImmichIdentity>;
  listAlbums(): Promise<ImmichAlbum[]>;
  listAlbumAssets(albumId: string): Promise<ImmichAsset[]>;
  /**
   * Every image in a date range, across the whole library.
   *
   * The album search above answers "what is in this album"; the journey
   * scan needs "what was taken while nothing was recorded", which no
   * album expresses. Same endpoint, no `albumIds`, plus Immich's own
   * `takenAfter` / `takenBefore` so the range is filtered server-side
   * rather than by pulling the library and discarding most of it.
   */
  searchAssetsByDate(range: ImmichDateRange): Promise<ImmichAssetPage>;
  fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream>;
  /**
   * The id of the library asset whose content has this checksum, or null.
   *
   * `checksum` is SHA-1, base64 — the encoding Immich keeps in
   * `asset.checksum`. An exact match on the bytes, so a photo uploaded here as
   * a copy can be recognised in the library without guessing from its name
   * (forgejo#21).
   */
  findAssetIdByChecksum(checksum: string): Promise<string | null>;
  /**
   * Every photo and video taken inside a window, oldest first, with the facts the
   * trip builder reads (`ImmichAssetDetail`).
   *
   * The legacy flat body, because this client is pinned to the 3.0.1 API and the
   * structured `filter` body exists only from v3.2: no `type` (so images and
   * videos both come back), `withExif` (an inner join, so an asset with no EXIF
   * row is absent), `order: "asc"`. Immich leaves trashed and locked assets out
   * on its own; hidden Live Photo halves and partners' assets DO come back and
   * are the caller's to drop (`ownerId`, `visibility`).
   *
   * The range is on `fileCreatedAt`, a UTC instant, so a caller that wants whole
   * local days pads it and trims by local day afterwards. Pages are offset based
   * and shift if an upload lands mid-scan, so ids are de-duplicated (first sight
   * wins). `onPage` hears `(page, collected so far)` after every page.
   */
  searchWindowAssets(
    range: ImmichDateRange,
    onPage?: (page: number, collected: number) => void
  ): Promise<ImmichWindowPage>;
  /**
   * Assets whose original file name contains `fragment`, taken inside `range`.
   *
   * One page only (at most 1000): this is a probe for the misdated-batch check,
   * not a listing. Immich matches with ILIKE, so `_` and `%` in the fragment act
   * as wildcards; callers compare the full names they get back. A blank fragment
   * returns nothing without a request, because it would match every file.
   */
  searchByFileName(fragment: string, range: ImmichDateRange): Promise<ImmichAssetDetail[]>;
}

/** Inclusive on both ends, as Immich treats them. */
export interface ImmichDateRange {
  takenAfter: Date;
  takenBefore: Date;
}

export interface ImmichAssetPage {
  assets: ImmichAsset[];
  /**
   * Immich had more to give and we stopped at the page cap.
   *
   * Surfaced rather than logged and swallowed: a scan that silently saw
   * two thirds of a library would report "no forgotten journeys" with
   * the same confidence as one that saw all of it.
   */
  truncated: boolean;
}

/** `searchWindowAssets`'s answer: every hit, and whether the page cap cut it short. */
export interface ImmichWindowPage {
  assets: ImmichAssetDetail[];
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** How Immich words a 403 for an API key that lacks a scope. */
const MISSING_PERMISSION = /Missing required permission: (\S+)/;

function missingScopeOf(body: unknown): string | undefined {
  const message = isRecord(body) ? body.message : undefined;
  return typeof message === "string" ? MISSING_PERMISSION.exec(message)?.[1] : undefined;
}

/**
 * Normalise anything thrown by axios into the four kinds the UI distinguishes.
 * An unknown non-axios throw is a protocol error — we never leak a raw stack.
 */
function toImmichError(error: unknown, context: string): ImmichError {
  if (error instanceof ImmichError) return error;

  if (isRecord(error) && error.isAxiosError === true) {
    const response = isRecord(error.response) ? error.response : undefined;
    const status = typeof response?.status === "number" ? response.status : undefined;

    if (status === 401 || status === 403) {
      // A key that is valid but lacks a scope is told apart from a bad key, so
      // the UI can say WHICH permission to add instead of "rejected".
      const missingScope = status === 403 ? missingScopeOf(response?.data) : undefined;
      if (missingScope) {
        return new ImmichError("auth", `Immich key lacks the ${missingScope} permission`, 403, {
          missingScope,
        });
      }
      return new ImmichError("auth", "Immich rejected the API key", status);
    }
    if (status === 404) {
      return new ImmichError("notFound", `Immich resource not found (${context})`, 404);
    }
    if (status === undefined || status >= 500) {
      return new ImmichError("unreachable", `Immich is unreachable (${context})`, status);
    }
    return new ImmichError("protocol", `Immich returned ${status} for ${context}`, status);
  }

  // Not an axios error at all — something genuinely unexpected (a programming
  // error, a thrown non-Error value, ...). The ImmichError we return keeps the
  // taxonomy the routes/UI depend on, but the original error and its stack
  // would otherwise vanish entirely, so log it here to keep the diagnostic
  // trail.
  logger.error({
    message: "immich_client_unexpected_error",
    error,
    context: { endpoint: context },
  });

  return new ImmichError("protocol", `Unexpected Immich failure (${context})`);
}

/** What `fileCreatedAt` becomes when Immich sends none — the existing "absent" convention. */
const NO_CAPTURE_TIME = new Date(0).toISOString();
const RFC3339_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * A photo's capture time as a UTC instant (ADR 0002 D6, library boundary).
 * Immich sends `fileCreatedAt` as RFC 3339 with an offset; it is normalised to
 * one UTC form so ordering by string compares instants, not spellings. A value
 * WITHOUT an offset is a camera wall clock with no zone: `new Date()` would
 * read it in the SERVER's zone, so it is treated like a missing time instead.
 */
function captureInstant(value: unknown): string {
  return offsetInstantOrNull(value) ?? NO_CAPTURE_TIME;
}

/** The same normalisation for a time that may legitimately be absent: null, not the epoch. */
function offsetInstantOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !RFC3339_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function mapAsset(raw: unknown): ImmichAsset | null {
  // A non-string OR empty id would build `/assets//original` — drop it, for
  // symmetry with `listAlbums`'s strict `id.length > 0` filter.
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  // Immich also has non-photo/video asset kinds (e.g. AUDIO). Coercing an
  // unexpected type into IMAGE would route it into the photo pipeline; drop
  // it instead — the caller already filters out `null`.
  if (raw.type !== "IMAGE" && raw.type !== "VIDEO") return null;
  const exif = isRecord(raw.exifInfo) ? raw.exifInfo : undefined;

  return {
    id: raw.id,
    type: raw.type,
    fileCreatedAt: captureInstant(raw.fileCreatedAt),
    originalFileName: asString(raw.originalFileName, `${raw.id}.bin`),
    mimeType: asString(raw.originalMimeType, "application/octet-stream"),
    sizeBytes: asNumberOrNull(exif?.fileSizeInByte),
    lat: asNumberOrNull(exif?.latitude),
    lon: asNumberOrNull(exif?.longitude),
  };
}

/** Immich's `localDateTime`: a wall clock printed with a fake `Z` (and milliseconds). */
const NAIVE_LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/;
const VISIBILITIES: readonly ImmichVisibility[] = ["timeline", "archive", "hidden", "locked"];

/**
 * The wall clock without Immich's fake `Z`, or null. A value that carries a REAL
 * offset is refused, not stripped: it is an instant, and reading it as a wall
 * clock would shift the photo by that offset.
 */
function naiveLocalDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return NAIVE_LOCAL_DATE_TIME.exec(value)?.[1] ?? null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function visibilityOrNull(value: unknown): ImmichVisibility | null {
  return VISIBILITIES.find((visibility) => visibility === value) ?? null;
}

/**
 * One search hit as the trip builder reads it: `mapAsset`'s fields plus the
 * clock, zone, owner, visibility, grouping and place facts. Anything Immich did
 * not send, or sent in a shape this does not trust, is null; nothing is guessed
 * here (the clock model decides what a naive `localDateTime` means).
 */
export function mapAssetDetail(raw: unknown): ImmichAssetDetail | null {
  const base = mapAsset(raw);
  if (base === null || !isRecord(raw)) return null;
  const exif = isRecord(raw.exifInfo) ? raw.exifInfo : undefined;

  return {
    ...base,
    localDateTime: naiveLocalDateTime(raw.localDateTime),
    timeZone: nonEmptyString(exif?.timeZone),
    fileModifiedAt: offsetInstantOrNull(raw.fileModifiedAt),
    city: nonEmptyString(exif?.city),
    state: nonEmptyString(exif?.state),
    country: nonEmptyString(exif?.country),
    ownerId: nonEmptyString(raw.ownerId),
    visibility: visibilityOrNull(raw.visibility),
    livePhotoVideoId: nonEmptyString(raw.livePhotoVideoId),
    duplicateId: nonEmptyString(raw.duplicateId),
    make: nonEmptyString(exif?.make),
    model: nonEmptyString(exif?.model),
    isFavorite: raw.isFavorite === true,
  };
}

/** Adds each mappable photo or video of one search page, keeping the first sight of an id. */
function addAssetDetails(items: readonly unknown[], into: Map<string, ImmichAssetDetail>): void {
  for (const raw of items) {
    const mapped = mapAssetDetail(raw);
    if (mapped && !into.has(mapped.id)) into.set(mapped.id, mapped);
  }
}

export function createImmichClient(
  conn: ImmichConnection,
  options: ImmichClientOptions = {}
): ImmichClient {
  const headers = { "x-api-key": conn.apiKey };
  const jsonConfig: AxiosRequestConfig = { headers, timeout: requestTimeout(options) };
  const url = (suffix: string): string => `${conn.baseUrl}/api${suffix}`;

  /** One page of `POST /search/metadata`, checked for the shape the page loops rely on. */
  async function searchPage(
    body: Record<string, unknown>,
    context: string
  ): Promise<{ items: unknown[]; hasNext: boolean }> {
    let data: unknown;
    try {
      ({ data } = await axios.post(url("/search/metadata"), body, jsonConfig));
    } catch (error) {
      throw toImmichError(error, context);
    }
    const assets = isRecord(data) && isRecord(data.assets) ? data.assets : undefined;
    if (!assets || !Array.isArray(assets.items)) {
      throw new ImmichError("protocol", "Immich returned an unexpected search payload");
    }
    return { items: assets.items, hasNext: typeof assets.nextPage === "string" };
  }

  return {
    async getServerVersion(): Promise<string> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/server/version"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "server/version");
      }
      if (!isRecord(data) || typeof data.major !== "number") {
        throw new ImmichError("protocol", "Immich returned an unexpected version payload");
      }
      return `${data.major}.${data.minor}.${data.patch}`;
    },

    async whoami(): Promise<ImmichIdentity> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/users/me"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "users/me");
      }
      if (!isRecord(data) || typeof data.id !== "string") {
        throw new ImmichError("protocol", "Immich returned an unexpected identity payload");
      }
      return {
        id: data.id,
        email: asString(data.email, ""),
        name: asString(data.name, ""),
      };
    },

    async listAlbums(): Promise<ImmichAlbum[]> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/albums"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "albums");
      }
      if (!Array.isArray(data)) {
        throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      }
      // A missing/non-string id would otherwise collide as `{ id: "" }` — drop
      // it instead, consistent with mapAsset's handling of malformed assets.
      return data
        .filter(isRecord)
        .filter(
          (raw): raw is Record<string, unknown> & { id: string } =>
            typeof raw.id === "string" && raw.id.length > 0
        )
        .map((raw) => ({
          id: raw.id,
          albumName: asString(raw.albumName, ""),
          assetCount: asNumberOrNull(raw.assetCount) ?? 0,
          thumbnailAssetId:
            typeof raw.albumThumbnailAssetId === "string" ? raw.albumThumbnailAssetId : null,
        }));
    },

    async listAlbumAssets(albumId: string): Promise<ImmichAsset[]> {
      const collected: ImmichAsset[] = [];
      let truncated = false;

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        let data: unknown;
        try {
          ({ data } = await axios.post(
            url("/search/metadata"),
            { albumIds: [albumId], withExif: true, page, size: PAGE_SIZE },
            jsonConfig
          ));
        } catch (error) {
          throw toImmichError(error, `search/metadata album=${albumId}`);
        }

        const assets = isRecord(data) && isRecord(data.assets) ? data.assets : undefined;
        if (!assets || !Array.isArray(assets.items)) {
          throw new ImmichError("protocol", "Immich returned an unexpected search payload");
        }

        for (const raw of assets.items) {
          const mapped = mapAsset(raw);
          if (mapped) collected.push(mapped);
        }

        if (typeof assets.nextPage !== "string") break;
        // Immich still reports more pages, but we've hit the hard cap — the
        // gallery this returns is a silent partial unless we say so here.
        if (page === MAX_PAGES) truncated = true;
      }

      if (truncated) {
        logger.warn({
          message: "immich_album_assets_truncated",
          context: { albumId, maxPages: MAX_PAGES, collectedCount: collected.length },
        });
      }

      return collected;
    },

    async findAssetIdByChecksum(checksum: string): Promise<string | null> {
      let data: unknown;
      try {
        ({ data } = await axios.post(url("/search/metadata"), { checksum, size: 1 }, jsonConfig));
      } catch (error) {
        throw toImmichError(error, "search/metadata checksum");
      }
      const assets = isRecord(data) && isRecord(data.assets) ? data.assets : undefined;
      if (!assets || !Array.isArray(assets.items)) {
        throw new ImmichError("protocol", "Immich returned an unexpected search payload");
      }
      const first = assets.items.map(mapAsset).find((asset) => asset !== null);
      return first?.id ?? null;
    },

    async searchAssetsByDate({
      takenAfter,
      takenBefore,
    }: ImmichDateRange): Promise<ImmichAssetPage> {
      const collected: ImmichAsset[] = [];
      let truncated = false;

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        let data: unknown;
        try {
          ({ data } = await axios.post(
            url("/search/metadata"),
            {
              takenAfter: takenAfter.toISOString(),
              takenBefore: takenBefore.toISOString(),
              // Videos cluster like photos but weigh far more per item and
              // add nothing the timestamps do not already say.
              type: "IMAGE",
              // Coordinates live in the EXIF block; without this the scan
              // gets timestamps and no places at all.
              withExif: true,
              page,
              size: PAGE_SIZE,
            },
            jsonConfig
          ));
        } catch (error) {
          throw toImmichError(error, "search/metadata by date");
        }

        const assets = isRecord(data) && isRecord(data.assets) ? data.assets : undefined;
        if (!assets || !Array.isArray(assets.items)) {
          throw new ImmichError("protocol", "Immich returned an unexpected search payload");
        }

        for (const raw of assets.items) {
          const mapped = mapAsset(raw);
          if (mapped) collected.push(mapped);
        }

        if (typeof assets.nextPage !== "string") break;
        if (page === MAX_PAGES) truncated = true;
      }

      if (truncated) {
        logger.warn({
          message: "immich_date_search_truncated",
          context: {
            maxPages: MAX_PAGES,
            collectedCount: collected.length,
            takenAfter: takenAfter.toISOString(),
            takenBefore: takenBefore.toISOString(),
          },
        });
      }

      return { assets: collected, truncated };
    },

    async searchWindowAssets(
      { takenAfter, takenBefore }: ImmichDateRange,
      onPage?: (page: number, collected: number) => void
    ): Promise<ImmichWindowPage> {
      const byId = new Map<string, ImmichAssetDetail>();
      let truncated = false;

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { items, hasNext } = await searchPage(
          {
            takenAfter: takenAfter.toISOString(),
            takenBefore: takenBefore.toISOString(),
            withExif: true,
            order: "asc",
            page,
            size: PAGE_SIZE,
          },
          "search/metadata by window"
        );
        addAssetDetails(items, byId);
        onPage?.(page, byId.size);

        if (!hasNext) break;
        // Immich still reports more pages but we are at the hard cap: the
        // window this returns is a silent partial unless we say so.
        if (page === MAX_PAGES) truncated = true;
      }

      if (truncated) {
        logger.warn({
          message: "immich_window_search_truncated",
          context: {
            maxPages: MAX_PAGES,
            collectedCount: byId.size,
            takenAfter: takenAfter.toISOString(),
            takenBefore: takenBefore.toISOString(),
          },
        });
      }

      return { assets: [...byId.values()], truncated };
    },

    async searchByFileName(
      fragment: string,
      { takenAfter, takenBefore }: ImmichDateRange
    ): Promise<ImmichAssetDetail[]> {
      const needle = fragment.trim();
      if (needle === "") return [];

      const { items } = await searchPage(
        {
          originalFileName: needle,
          takenAfter: takenAfter.toISOString(),
          takenBefore: takenBefore.toISOString(),
          withExif: true,
          order: "asc",
          page: 1,
          size: PAGE_SIZE,
        },
        "search/metadata by file name"
      );
      const byId = new Map<string, ImmichAssetDetail>();
      addAssetDetails(items, byId);
      return [...byId.values()];
    },

    /**
     * Returns a live upstream stream. The caller owns it: attach an `error`
     * listener or pipe it through `stream/promises` `pipeline()` — adding a
     * listener here would swallow errors the caller needs to see (or react to
     * with e.g. `res.destroy()`).
     *
     * `STREAM_TIMEOUT_MS` only bounds axios' connect/header phase; once the
     * response starts streaming, axios enforces no timeout on the body
     * transfer for `responseType: "stream"` — the name promises more than it
     * delivers here.
     */
    async fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream> {
      const suffix =
        size === "original"
          ? `/assets/${assetId}/original`
          : `/assets/${assetId}/thumbnail?size=${size}`;

      try {
        const response = await axios.get(url(suffix), {
          headers,
          timeout: STREAM_TIMEOUT_MS,
          responseType: "stream",
        });
        const rawLength = response.headers["content-length"];
        const contentLength = typeof rawLength === "string" ? Number(rawLength) : NaN;

        return {
          stream: response.data as NodeJS.ReadableStream,
          contentType: asString(response.headers["content-type"], "application/octet-stream"),
          contentLength: Number.isFinite(contentLength) ? contentLength : null,
        };
      } catch (error) {
        throw toImmichError(error, `assets/${assetId} size=${size}`);
      }
    },
  };
}
