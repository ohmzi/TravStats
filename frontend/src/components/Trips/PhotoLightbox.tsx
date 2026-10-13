import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";
import { useImmichWebUrl } from "../../hooks/useImmichWebUrl";
import { immichApi } from "../../lib/api/immich";
import { useToastStore } from "../../store/toastStore";
import PhotoDetailsPanel, { type PhotoDetails } from "./PhotoDetailsPanel";

export type { PhotoDetails };

export interface LightboxItem {
  id: string;
  previewUrl: string;
  caption?: string | null;
  /** A local `TripPhoto`, or a live asset proxied from a linked album. */
  source: { kind: "photo" } | { kind: "immich"; linkId: string };
  /** What the Details panel shows; absent when the caller has nothing to say. */
  details?: PhotoDetails;
}

interface Props {
  tripId: string;
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
  onCoverChanged?: (coverImageUrl: string) => void;
}

/**
 * Full-screen viewer shared by uploaded photos and linked Immich assets. The
 * only difference between the two is which endpoint sets the cover — the
 * image itself is just a URL, proxied or local.
 *
 * The Details toggle (owner request, 2026-10-13) slides the photo aside — a
 * right-hand metadata column on a roomy viewport, a bottom sheet on a phone —
 * in Immich's info-panel spirit. "Open in Immich" appears only for a live
 * album asset AND an owner-configured web address; the connection's internal
 * base URL is never emitted into a browser link.
 */
export default function PhotoLightbox({
  tripId,
  items,
  startIndex,
  onClose,
  onCoverChanged,
}: Props): JSX.Element | null {
  const { t } = useTranslation("immich");
  const addToast = useToastStore((s) => s.addToast);
  const isPhone = useIsPhoneViewport();
  const [index, setIndex] = useState(startIndex);
  const [coverSet, setCoverSet] = useState(false);
  const [settingCover, setSettingCover] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Tracks which item is on screen *right now*, independent of any closure
  // captured when an in-flight cover request was kicked off. Read only after
  // the request settles, so a stale response can't confirm the wrong photo.
  const currentItemIdRef = useRef<string | null>(null);

  // Clamp instead of indexing out of bounds, so a parent shrinking `items`
  // (e.g. a photo delete) while this lightbox is still open cannot crash it.
  const item = items.length > 0 ? items[Math.min(index, items.length - 1)] : null;
  // A live album asset is the only thing that can be opened in Immich; the
  // settings are not read for anything else.
  const webUrl = useImmichWebUrl(item?.details?.albumId != null);

  const step = useCallback(
    (delta: number) => {
      setCoverSet(false);
      setIndex((prev) => (prev + delta + items.length) % items.length);
    },
    [items.length]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  if (item === null) return null;
  currentItemIdRef.current = item.id;

  // Immich's own deep link into an album's viewer: /albums/:id/photos/:assetId.
  const immichHref =
    webUrl !== null && item.details?.albumId
      ? `${webUrl}/albums/${encodeURIComponent(item.details.albumId)}/photos/${encodeURIComponent(item.id)}`
      : null;

  const handleSetCover = async (): Promise<void> => {
    const requestedItemId = item.id;
    setSettingCover(true);
    try {
      const result =
        item.source.kind === "immich"
          ? await immichApi.setImmichCover(tripId, item.source.linkId, item.id)
          : await immichApi.setPhotoCover(tripId, item.id);

      // Only confirm the cover if the user is still looking at the photo
      // the request was actually issued for — otherwise navigating away
      // mid-request would flip the confirmation onto the wrong photo.
      if (currentItemIdRef.current === requestedItemId) {
        setCoverSet(true);
        onCoverChanged?.(result.coverImageUrl);
      }
    } catch {
      addToast("error", t("errors.unreachable"));
    } finally {
      setSettingCover(false);
    }
  };

  const detailsPanel = <PhotoDetailsPanel details={item.details} />;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="flex min-h-0 w-full flex-1 items-stretch justify-center">
        {/* Clicking the empty stage still closes the viewer, as it always did;
            the photo and the controls below stop the click themselves. */}
        <div
          data-testid="lightbox-stage"
          data-details-open={detailsOpen ? "true" : "false"}
          className={`relative flex min-h-0 flex-1 items-center justify-center px-4 py-6 transition-transform duration-300 ${
            detailsOpen && !isPhone ? "md:-translate-x-8" : ""
          }`}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <img
              data-testid="lightbox-image"
              src={item.previewUrl}
              alt={item.caption ?? ""}
              className="max-h-full object-contain"
            />

            {items.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label={t("gallery.previous")}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2"
                  onClick={() => step(-1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label={t("gallery.next")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2"
                  onClick={() => step(1)}
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>

        {detailsOpen && !isPhone && (
          <aside
            id="lightbox-details-panel"
            data-testid="lightbox-details"
            data-variant="column"
            aria-label={t("gallery.details")}
            className="w-80 max-w-[45vw] shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-950/80 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {detailsPanel}
          </aside>
        )}
      </div>

      {/* On a phone the details cannot sit beside the photo — the sheet slides
          up below it instead of overlapping the picture. */}
      {detailsOpen && isPhone && (
        <div
          id="lightbox-details-panel"
          data-testid="lightbox-details"
          data-variant="sheet"
          aria-label={t("gallery.details")}
          className="max-h-[45vh] shrink-0 overflow-y-auto rounded-t-xl border-t border-slate-700 bg-slate-950/95 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          {detailsPanel}
        </div>
      )}

      <div
        className="flex flex-wrap items-center justify-center gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        {item.caption && <span className="text-sm text-slate-300">{item.caption}</span>}
        <button
          type="button"
          className="rounded-sm border border-slate-500 px-3 py-1 text-sm"
          onClick={() => void handleSetCover()}
          disabled={settingCover}
        >
          {coverSet ? t("gallery.coverSet") : t("gallery.setAsCover")}
        </button>
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls="lightbox-details-panel"
          className="rounded-sm border border-slate-500 px-3 py-1 text-sm"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {t("gallery.details")}
        </button>
        {immichHref !== null && (
          <a
            href={immichHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm border border-slate-500 px-3 py-1 text-sm"
          >
            {t("gallery.openInImmich")}
          </a>
        )}
        <button
          type="button"
          aria-label={t("gallery.close")}
          className="rounded-sm border border-slate-500 px-3 py-1 text-sm"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
