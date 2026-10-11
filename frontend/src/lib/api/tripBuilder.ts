import { API_URL, api } from "./client";
import type {
  CapabilitiesDto,
  CommitBody,
  PreviewSize,
  ScanBody,
  TripBuilderDraft,
} from "../../types/tripBuilder";

/**
 * The photo trip builder (`/api/v1/trip-builder`, spec 2026-10-09 §F).
 *
 * A BARE router (`docs/adr/0001-api-response-shape.md`): every call here
 * answers the resource itself, with no `{success, data}` envelope, unlike
 * `GET /jobs/:id`, which `waitForJob` unwraps. `scan`, `commit` and
 * `retryAlbum` answer 202 with a job id; the caller reads the outcome with
 * `waitForJob<ScanJobResult | CommitJobResult | AlbumOutcome>`.
 *
 * No call carries an Immich asset id. A thumbnail is the draft id plus an
 * INDEX, and the stored draft is the permission (`previewUrl`).
 */
export const tripBuilderApi = {
  /** What this account may do with its Immich. Asked on the first flip of a popup switch, never on mount. */
  capabilities: async (): Promise<CapabilitiesDto> => {
    const { data } = await api.get<CapabilitiesDto>("/trip-builder/capabilities");
    return data;
  },

  /** Starts the read-only scan job for a trip's window; nothing is written anywhere. */
  scan: async (body: ScanBody): Promise<{ jobId: string }> => {
    const { data } = await api.post<{ jobId: string }>("/trip-builder/scan", body);
    return data;
  },

  getDraft: async (draftId: string): Promise<TripBuilderDraft> => {
    const { data } = await api.get<TripBuilderDraft>(`/trip-builder/drafts/${draftId}`);
    return data;
  },

  discardDraft: async (draftId: string): Promise<void> => {
    await api.delete(`/trip-builder/drafts/${draftId}`);
  },

  commit: async (draftId: string, body: CommitBody): Promise<{ jobId: string }> => {
    const { data } = await api.post<{ jobId: string }>(
      `/trip-builder/drafts/${draftId}/commit`,
      body
    );
    return data;
  },

  /**
   * Retries a failed or blocked album for a trip that exists. `name` overrides
   * the album's name; `removeOutside` carries the review's removal choice on a
   * re-sync, so the retry completes the update the commit was asked for.
   */
  retryAlbum: async (
    tripId: string,
    name?: string,
    removeOutside = false
  ): Promise<{ jobId: string }> => {
    const body: { name?: string; removeOutside?: boolean } = {};
    if (name !== undefined) body.name = name;
    if (removeOutside) body.removeOutside = true;
    const { data } = await api.post<{ jobId: string }>(`/trip-builder/trips/${tripId}/album`, body);
    return data;
  },

  /** One thumbnail of a draft's station card, by index; the draft is the grant. */
  previewUrl: (draftId: string, index: number, size: PreviewSize): string =>
    `${API_URL}/api/v1/trip-builder/drafts/${draftId}/preview/${index}/file?size=${size}`,
};
