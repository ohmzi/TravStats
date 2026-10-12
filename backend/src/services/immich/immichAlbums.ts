/**
 * The album calls of the Immich client (spec 2026-10-09): read an album, find the
 * user's own by name, create one, put assets in it and (on a re-sync) take them
 * out and refresh its description. They live apart from `immichClient.ts` so that
 * file stays under the size limit; `createImmichClient` attaches them, so callers
 * see one client.
 *
 * The trip builder writes ONE album per trip and nothing else to Immich; these
 * are the only calls that write.
 */
import axios, { AxiosRequestConfig } from "axios";
import { ALBUM_ADD_CHUNK } from "../tripBuilder/thresholds";
import { asNumberOrNull, asString, isRecord, toImmichError } from "./immichWire";
import {
  ImmichAlbum,
  ImmichAlbumInfo,
  ImmichAlbumRemoveResult,
  ImmichAlbumWriteResult,
  ImmichError,
} from "./types";

export interface ImmichAlbumCalls {
  /** One album by id: its name and asset count (`AlbumResponseDto` carries no asset array). */
  getAlbum(albumId: string): Promise<ImmichAlbum>;
  /**
   * The album `ownerId` owns whose name is exactly `name` (case-sensitive), or
   * null. Asked with `name` and `isOwned=true`, then checked again here: an
   * Immich that ignores those parameters answers with every album, and an album
   * someone shared with the caller must never be mistaken for the caller's own.
   * With several matches the first in Immich's order wins.
   */
  findOwnedAlbumByName(name: string, ownerId: string): Promise<ImmichAlbum | null>;
  /**
   * Creates an EMPTY album (a WRITE; needs `album.create`). Assets are added
   * afterwards with `addAssetsToAlbum`, because creating with `assetIds` drops
   * the ones the user cannot share and reports none of them.
   */
  createAlbum(input: { albumName: string; description: string }): Promise<ImmichAlbum>;
  /**
   * Adds assets to an album (a WRITE; needs `albumAsset.create`), at most
   * `ALBUM_ADD_CHUNK` ids a request. Immich answers per asset: `success` is
   * added, `duplicate` is already in (so a retry is safe), anything else is
   * refused with its reason. Each distinct id gets exactly one outcome; an id
   * Immich did not answer for is refused as `missing`. A failed chunk throws:
   * the chunks before it stay added, which a retry then hears as `duplicate`.
   */
  addAssetsToAlbum(albumId: string, ids: readonly string[]): Promise<ImmichAlbumWriteResult>;
  /**
   * `DELETE /albums/:id/assets` (scope `albumAsset.delete`): take assets out of an
   * album, `ALBUM_ADD_CHUNK` ids per call. An id that is not in the album comes back
   * `not_found` and is counted, not refused — a retry is safe.
   */
  removeAssetsFromAlbum(albumId: string, ids: readonly string[]): Promise<ImmichAlbumRemoveResult>;
  /** `GET /albums/:id` with what a re-sync needs of it. */
  getAlbumInfo(albumId: string): Promise<ImmichAlbumInfo>;
  /** `PATCH /albums/:id` (scope `album.update`): only the description. */
  setAlbumDescription(albumId: string, description: string): Promise<void>;
  /**
   * `PATCH /albums/:id` (scope `album.update`): name AND description at once —
   * the rename a stored album owes when the naming convention changes under it
   * (scripts/renameTripNames.ts). Same endpoint and body shape as
   * `createAlbum`, and the one call the script makes.
   */
  updateAlbum(albumId: string, input: { albumName: string; description: string }): Promise<void>;
}

/** One album as the app reads it; null for an entry without a usable id. */
export function mapAlbum(raw: unknown): ImmichAlbum | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    albumName: asString(raw.albumName, ""),
    assetCount: asNumberOrNull(raw.assetCount) ?? 0,
    thumbnailAssetId:
      typeof raw.albumThumbnailAssetId === "string" ? raw.albumThumbnailAssetId : null,
  };
}

/**
 * The id of an album's owner. `AlbumResponseDto.albumUsers` documents its first
 * entry as always the owner; a payload without one has no owner we can name.
 */
function albumOwnerId(raw: Record<string, unknown>): string | null {
  const first = Array.isArray(raw.albumUsers) ? raw.albumUsers[0] : undefined;
  const user = isRecord(first) && isRecord(first.user) ? first.user : undefined;
  return typeof user?.id === "string" ? user.id : null;
}

/**
 * The album calls bound to one connection: `url` builds `<base>/api<suffix>` and
 * `jsonConfig` carries the key and the timeout.
 */
export function createAlbumCalls(
  url: (suffix: string) => string,
  jsonConfig: AxiosRequestConfig
): ImmichAlbumCalls {
  return {
    async getAlbum(albumId: string): Promise<ImmichAlbum> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url(`/albums/${encodeURIComponent(albumId)}`), jsonConfig));
      } catch (error) {
        throw toImmichError(error, `albums/${albumId}`);
      }
      const album = mapAlbum(data);
      if (!album) throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      return album;
    },

    async findOwnedAlbumByName(name: string, ownerId: string): Promise<ImmichAlbum | null> {
      let data: unknown;
      try {
        ({ data } = await axios.get(
          url(`/albums?name=${encodeURIComponent(name)}&isOwned=true`),
          jsonConfig
        ));
      } catch (error) {
        throw toImmichError(error, "albums by name");
      }
      if (!Array.isArray(data)) {
        throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      }
      for (const raw of data) {
        if (!isRecord(raw) || raw.albumName !== name || albumOwnerId(raw) !== ownerId) continue;
        const album = mapAlbum(raw);
        if (album) return album;
      }
      return null;
    },

    async createAlbum({
      albumName,
      description,
    }: {
      albumName: string;
      description: string;
    }): Promise<ImmichAlbum> {
      let data: unknown;
      try {
        ({ data } = await axios.post(url("/albums"), { albumName, description }, jsonConfig));
      } catch (error) {
        throw toImmichError(error, "create album");
      }
      const album = mapAlbum(data);
      if (!album) throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      return album;
    },

    async addAssetsToAlbum(
      albumId: string,
      ids: readonly string[]
    ): Promise<ImmichAlbumWriteResult> {
      // An album holds an asset once; asking twice would only hear "duplicate".
      const unique = [...new Set(ids)];
      const result: ImmichAlbumWriteResult = { added: 0, duplicate: 0, refused: [] };

      for (let offset = 0; offset < unique.length; offset += ALBUM_ADD_CHUNK) {
        const chunk = unique.slice(offset, offset + ALBUM_ADD_CHUNK);
        let data: unknown;
        try {
          ({ data } = await axios.put(
            url(`/albums/${encodeURIComponent(albumId)}/assets`),
            { ids: chunk },
            jsonConfig
          ));
        } catch (error) {
          throw toImmichError(error, `albums/${albumId}/assets`);
        }
        if (!Array.isArray(data)) {
          throw new ImmichError("protocol", "Immich returned an unexpected album-assets payload");
        }

        const answers = new Map<string, Record<string, unknown>>();
        for (const entry of data) {
          if (isRecord(entry) && typeof entry.id === "string") answers.set(entry.id, entry);
        }
        for (const id of chunk) {
          const answer = answers.get(id);
          if (answer === undefined) {
            result.refused.push({ id, error: "missing" });
          } else if (answer.success === true) {
            result.added += 1;
          } else if (answer.error === "duplicate") {
            result.duplicate += 1;
          } else {
            const reason = typeof answer.error === "string" ? answer.error : "unknown";
            result.refused.push({ id, error: reason });
          }
        }
      }
      return result;
    },

    async removeAssetsFromAlbum(
      albumId: string,
      ids: readonly string[]
    ): Promise<ImmichAlbumRemoveResult> {
      const result: ImmichAlbumRemoveResult = { removed: 0, notInAlbum: 0, refused: [] };
      for (let i = 0; i < ids.length; i += ALBUM_ADD_CHUNK) {
        const chunk = ids.slice(i, i + ALBUM_ADD_CHUNK);
        let data: unknown;
        try {
          ({ data } = await axios.delete(url(`/albums/${encodeURIComponent(albumId)}/assets`), {
            ...jsonConfig,
            data: { ids: chunk },
          }));
        } catch (error) {
          throw toImmichError(error, `albums/${albumId}/assets delete`);
        }
        if (!Array.isArray(data)) {
          throw new ImmichError("protocol", "Immich returned an unexpected album-remove payload");
        }
        for (const raw of data) {
          if (!isRecord(raw) || typeof raw.id !== "string") continue;
          if (raw.success === true) result.removed += 1;
          else if (raw.error === "not_found") result.notInAlbum += 1;
          else result.refused.push({ id: raw.id, error: asString(raw.error, "unknown") });
        }
      }
      return result;
    },

    async getAlbumInfo(albumId: string): Promise<ImmichAlbumInfo> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url(`/albums/${encodeURIComponent(albumId)}`), jsonConfig));
      } catch (error) {
        throw toImmichError(error, `albums/${albumId}`);
      }
      const album = mapAlbum(data);
      if (!album || !isRecord(data)) {
        throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      }
      return {
        ...album,
        description: asString(data.description, ""),
        ownerId: albumOwnerId(data),
      };
    },

    async setAlbumDescription(albumId: string, description: string): Promise<void> {
      try {
        await axios.patch(
          url(`/albums/${encodeURIComponent(albumId)}`),
          { description },
          jsonConfig
        );
      } catch (error) {
        throw toImmichError(error, `albums/${albumId} patch`);
      }
    },

    async updateAlbum(
      albumId: string,
      input: { albumName: string; description: string }
    ): Promise<void> {
      try {
        await axios.patch(url(`/albums/${encodeURIComponent(albumId)}`), input, jsonConfig);
      } catch (error) {
        throw toImmichError(error, `albums/${albumId} patch`);
      }
    },
  };
}
