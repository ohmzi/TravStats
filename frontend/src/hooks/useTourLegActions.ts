import { useCallback, useState, type RefObject } from "react";

import { apiErrorProse } from "../lib/apiError";
import { toursApi, type SetTourLegInput } from "../lib/api/tours";
import { routeFallbackMessage } from "../lib/routeFallbackCopy";
import { useToastStore } from "../store/toastStore";
import type { LegMode, TourLeg } from "../types/tour";
import { useTranslation } from "./useTranslation";

export interface UseTourLegActionsOptions {
  tripId: string | undefined;
  routeId: string | undefined;
  /** The editor's own reload. Every leg write re-reads the section rather
   *  than patching state locally: a source or mode change moves
   *  `route.distanceKm`/the header and the drawn line with it. */
  load: () => Promise<void>;
  /** The editor's `mountedRef` — a write that lands after unmount must not
   *  set state. */
  mountedRef: RefObject<boolean>;
  /** legId → covering track id, the map `TourLegList` gates its "track"
   *  option with. A track leg's mode correction re-adopts through it. */
  trackCoverageByLegId: ReadonlyMap<string, string>;
}

export interface TourLegActions {
  /** True while `routeAll` is in flight — `TourLegList` disables its batch
   *  button and swaps its label to a busy state. */
  routingAllInProgress: boolean;
  /** The leg whose mode write is in flight, if any — that row's mode control
   *  is disabled until the answer lands. */
  modeChangeInFlightLegId: string | null;
  setSource: (leg: TourLeg, source: "straight" | "drawn") => void;
  route: (leg: TourLeg) => void;
  routeAll: () => void;
  clear: (leg: TourLeg) => void;
  adoptTrack: (leg: TourLeg, trackId: string) => void;
  setMode: (leg: TourLeg, mode: LegMode) => void;
}

/**
 * The HTTP status of a failed request, if this is an axios-shaped error.
 * Used to tell the routing endpoint's deliberate 409 ("instance not
 * equipped to route at all") apart from every other failure — a network
 * drop, a 404 for a leg that no longer exists, a 500. Only the 409 gets its
 * own message; everything else falls back to the generic routing error.
 */
function apiErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : null;
}

/**
 * The override endpoint's own cap on a body-supplied line
 * (`legOverrideSchema`'s `waypoints` array, `backend/src/schemas/tour.ts`).
 * A STORED line may be longer — a provider's routed geometry is written by
 * the routing endpoint, which has no such bound — so re-sending one is not
 * automatically possible.
 */
const MAX_PUT_WAYPOINTS = 256;

/**
 * The write that corrects a leg's mode WITHOUT costing its geometry (owner
 * request 2026-10-12: "its not ferry it was roadtrip or viseversa"). What a
 * leg's source can be re-sent as is the endpoint's vocabulary, not this
 * file's:
 *
 * - `straight` re-sends itself — the chord is derived, nothing is lost;
 * - `drawn` re-sends its stored waypoints, because the endpoint CLEARS an
 *   omitted `waypoints` for every source;
 * - `track` re-adopts from the id the server's coverage answer gave
 *   (`coveringTrackId`) — the endpoint's `track` branch requires it, and
 *   re-derives the same waypoints from the same recording;
 * - `routed` cannot be re-sent at all (the endpoint refuses `routed`: a
 *   caller must not hand-supply provider geometry), so its stored line goes
 *   back as `drawn` — exactly the line it already has, under the closest
 *   honest source this endpoint can store. The alternative, `straight`,
 *   would silently flatten it.
 *
 * `null` means no available write keeps the geometry; the caller then leaves
 * the mode as it is and says so, rather than dropping the line. That is the
 * track leg whose covering track the server no longer reports (a race with
 * a deleted recording), and the stored line the endpoint's own waypoint cap
 * above would refuse.
 */
function legModeChangeInput(
  leg: TourLeg,
  mode: LegMode,
  coveringTrackId: string | undefined
): SetTourLegInput | null {
  if (leg.source === "track") {
    return coveringTrackId === undefined
      ? null
      : { source: "track", mode, trackId: coveringTrackId };
  }
  if (leg.source === "straight") return { source: "straight", mode };
  const line = leg.waypoints !== null && leg.waypoints.length >= 2 ? leg.waypoints : null;
  if (line === null || line.length > MAX_PUT_WAYPOINTS) return null;
  return { source: "drawn", mode, waypoints: line };
}

/**
 * The route editor's leg actions (`TripRouteEditorPage`), split out of the
 * page to keep it under its file-size ceiling — the same reasoning that
 * already split `useTourTracks` and `useTourTrackCoverage` out. Every action
 * follows one shape: write through `toursApi`, reload the section, toast the
 * failure. The two pieces of in-flight state the page's own controls read
 * (`routingAllInProgress`, `modeChangeInFlightLegId`) live here with them.
 *
 * A leg action needs a SECTION, not a trip: a standalone tour or roadtrip
 * has no trip id, and until 2026-09-26 an `!id` guard in the page made its
 * "route" buttons return before sending anything — hence `tripId` stays
 * possibly-undefined here.
 */
export function useTourLegActions(options: UseTourLegActionsOptions): TourLegActions {
  const { tripId, routeId, load, mountedRef, trackCoverageByLegId } = options;
  const { t, i18n } = useTranslation(["trips"]);
  const addToast = useToastStore((s) => s.addToast);
  const [routingAllInProgress, setRoutingAllInProgress] = useState(false);
  const [modeChangeInFlightLegId, setModeChangeInFlightLegId] = useState<string | null>(null);

  const setSource = useCallback(
    (leg: TourLeg, source: "straight" | "drawn"): void => {
      if (!routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.setLeg(tripId, routeId, leg.fromStopId, leg.toStopId, { source });
          await load();
        } catch (err) {
          addToast("error", apiErrorProse(err) ?? t("trips:tours.legError"));
        }
      })();
    },
    [tripId, routeId, load, addToast, t]
  );

  /**
   * Routes ONE leg through the configured provider. The 409 "no provider
   * configured" answer gets its OWN message — a generic
   * "could not be changed" toast would read as a validation failure, but
   * this is the instance not being equipped to answer at all, which
   * `TourLegList` already prevents by disabling the option in the common
   * case; this still guards the request directly (a second tab could have
   * unconfigured routing between load and click). A 200 with a low-confidence
   * fallback is not an error — `load()` picks up the honest result (source
   * reverts to "straight") and a distinct info toast says so, rather than
   * silently looking like nothing happened. The toast carries the numbers
   * behind the refusal when the server sent any (`routeFallbackMessage`) —
   * a bare "did not fit" reads like the app rejecting a good answer
   * (2026-10-13, the Muscat roadtrip) — and the sentence saying the region's
   * map is downloading when that is why (`autofetch`,
   * spec 2026-10-13-osrm-autofetch-design §2.4), so a self-healing refusal
   * does not read as a broken button.
   */
  const route = useCallback(
    (leg: TourLeg): void => {
      if (!routeId) return;
      void (async (): Promise<void> => {
        try {
          const { fallbackReason, fallbackDetail, autofetch } = await toursApi.routeLeg(
            tripId,
            routeId,
            leg.fromStopId,
            leg.toStopId
          );
          await load();
          if (fallbackReason !== null) {
            addToast(
              "info",
              `${t("trips:tours.routing.fallback")} ${routeFallbackMessage(
                fallbackReason,
                fallbackDetail,
                t,
                i18n.language,
                autofetch
              )}`
            );
          }
        } catch (err) {
          if (apiErrorStatus(err) === 409) {
            addToast("error", t("trips:tours.routing.notConfigured"));
          } else {
            addToast("error", apiErrorProse(err) ?? t("trips:tours.routing.error"));
          }
        }
      })();
    },
    [tripId, routeId, load, addToast, t]
  );

  /**
   * Routes every routable leg of the section in one call. Never 409s (see
   * `toursApi.routeAll`'s own doc comment), so the only failure path here
   * is a genuine request error (network, 500). On success, `load()` is
   * re-run rather than applying `result.legs` directly — routing can change
   * `route.distanceKm`/`drivenKm` (the header) and the drawn line
   * (`geometry`, fetched separately for the map), so only a full reload
   * keeps every part of the page honest. The counts are then reported
   * verbatim — never a blanket "done!" toast, which would hide a batch
   * that quietly routed zero legs because no provider is configured. The
   * cause of the first fallback is named with the numbers behind it
   * (`routeFallbackMessage`), so a batch whose legs all stayed straight
   * says how far off the provider's answers were, not just "did not fit" —
   * and that same first fallback's `autofetch` rides along, so the batch
   * whose whole region is downloading says so too.
   */
  const routeAll = useCallback((): void => {
    if (!routeId) return;
    setRoutingAllInProgress(true);
    void (async (): Promise<void> => {
      try {
        const result = await toursApi.routeAll(tripId, routeId);
        await load();
        if (!mountedRef.current) return;
        addToast(
          "info",
          result.fallbackCount > 0
            ? t("trips:tours.routing.resultFallback", {
                routed: result.routedCount,
                fallback: result.fallbackCount,
                skipped: result.skippedCount,
                reason: result.fallbackReason
                  ? routeFallbackMessage(
                      result.fallbackReason,
                      result.fallbackDetail,
                      t,
                      i18n.language,
                      result.autofetch
                    )
                  : "",
              })
            : t("trips:tours.routing.result", {
                routed: result.routedCount,
                skipped: result.skippedCount,
              })
        );
      } catch (err) {
        addToast("error", apiErrorProse(err) ?? t("trips:tours.routing.allError"));
      } finally {
        if (mountedRef.current) setRoutingAllInProgress(false);
      }
    })();
  }, [tripId, routeId, load, addToast, t, mountedRef]);

  const clear = useCallback(
    (leg: TourLeg): void => {
      if (!routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.clearLeg(tripId, routeId, leg.fromStopId, leg.toStopId);
          await load();
        } catch (err) {
          addToast("error", apiErrorProse(err) ?? t("trips:tours.legError"));
        }
      })();
    },
    [tripId, routeId, load, addToast, t]
  );

  /**
   * Adopts a track's geometry onto a leg (phase 3b, task 8). Only ever
   * invoked by `TourLegList` for a leg whose "track" option is enabled —
   * gated client-side by `trackCoverageByLegId` — but the server re-checks
   * coverage itself and answers 409 with an exact reason if it disagrees
   * (a race: the track could have been deleted between render and click).
   * `apiErrorProse` already surfaces that 409's own prose, so no special
   * status handling is needed here, unlike `route`'s 409 case.
   */
  const adoptTrack = useCallback(
    (leg: TourLeg, trackId: string): void => {
      if (!routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.setLeg(tripId, routeId, leg.fromStopId, leg.toStopId, {
            source: "track",
            trackId,
          });
          await load();
        } catch (err) {
          addToast("error", apiErrorProse(err) ?? t("trips:tours.legError"));
        }
      })();
    },
    [tripId, routeId, load, addToast, t]
  );

  /**
   * Corrects a leg's mode (owner request 2026-10-12), writing the
   * source-preserving shape `legModeChangeInput` builds so the correction
   * never costs the line. The leg whose write is in flight disables its own
   * mode control until the reload lands. A leg with no geometry-preserving
   * write is not sent at all: the mode stays as it is and the row's own
   * failure copy is shown, because a silent source change would look like a
   * fix while quietly flattening the line.
   */
  const setMode = useCallback(
    (leg: TourLeg, mode: LegMode): void => {
      if (!routeId) return;
      const input = legModeChangeInput(leg, mode, trackCoverageByLegId.get(leg.id));
      if (input === null) {
        addToast("error", t("trips:tours.legError"));
        return;
      }
      setModeChangeInFlightLegId(leg.id);
      void (async (): Promise<void> => {
        try {
          await toursApi.setLeg(tripId, routeId, leg.fromStopId, leg.toStopId, input);
          await load();
        } catch (err) {
          addToast("error", apiErrorProse(err) ?? t("trips:tours.legError"));
        } finally {
          if (mountedRef.current) setModeChangeInFlightLegId(null);
        }
      })();
    },
    [tripId, routeId, load, addToast, t, mountedRef, trackCoverageByLegId]
  );

  return {
    routingAllInProgress,
    modeChangeInFlightLegId,
    setSource,
    route,
    routeAll,
    clear,
    adoptTrack,
    setMode,
  };
}
