import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiErrorProse } from "../lib/apiError";
import { saveErrorMessage } from "../lib/saveErrorMessage";
import { TRACK_ERROR_KEYS } from "../lib/trackErrorKeys";

import AppShell from "../components/ui/AppShell";
import BackLink from "../components/ui/BackLink";
import PageHeader from "../components/ui/PageHeader";
import TripMap, { type TripMapContent } from "../components/Trips/TripMap";
import TourRecordingSummary from "../components/Trips/TourRecordingSummary";
import PlannedProfileCard from "../components/Trips/PlannedProfileCard";
import StravaImportDialog, { useStravaConnected } from "../components/Trips/StravaImportDialog";
import { useDomainColors } from "../hooks/useDomainColors";
import { hexToRgb } from "../lib/domainColor";
import { TOUR_COLOR } from "../shared/domains";
import { TOUR_ACTIVITIES, type TourActivity } from "../shared/tour/roadtrip";
import TourStopAssigner from "../components/Trips/TourStopAssigner";
import TourPointEditor from "../components/Trips/TourPointEditor";
import TourDayEditor from "../components/Trips/TourDayEditor";
import { editsOwnPoints, tourPointsSaveErrorKey } from "../components/Trips/tourPointsSave";
import RoadtripDatesSection, {
  type TripDatesSpan,
} from "../components/Roadtrips/RoadtripDatesSection";
import RoadtripEditActions from "../components/Roadtrips/RoadtripEditActions";
import TourLegList from "../components/Trips/TourLegList";
import TourTrackList from "../components/Trips/TourTrackList";
import { useTranslation } from "../hooks/useTranslation";
import { useTourTracks } from "../hooks/useTourTracks";
import { useTourTrackCoverage } from "../hooks/useTourTrackCoverage";
import { useTourLegActions } from "../hooks/useTourLegActions";
import { tripsApi } from "../lib/api";
import { roadtripsApi } from "../lib/api/roadtrips";
import { toursApi, type TourPointInput } from "../lib/api/tours";
import { trackArchiveApi } from "../lib/api/trackArchive";
import { downloadBlob } from "../lib/export";
import { dawarichFailureKey, dawarichFailureKind } from "../lib/api/dawarich";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { Trip, TripStop } from "../types";
import type { TourGeometry, TourLeg, TourRoute, TourStop, TourTrackMeta } from "../types/tour";

/**
 * `TripStop` (`types/index.ts`) does not declare `routeId`/`routeOrderIdx` —
 * no other frontend consumer needed them before this page. The backend DOES
 * send them: `GET /trips/:id` includes every trip stop with `stops: {
 * orderBy: [...] }` and NO `select`, i.e. every scalar column, and
 * `TripStop.routeId`/`routeOrderIdx` are plain columns on that Prisma model
 * (`backend/prisma/schema.prisma`). Extending locally rather than editing
 * the shared type keeps this task's file list to what it says on the tin.
 */
interface StopWithRoute extends TripStop {
  routeId: string | null;
  routeOrderIdx: number | null;
}

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/**
 * The route editor: `/trips/:id/route/:routeId`. Where a tour section
 * becomes usable — assign stops, see the line on the map, adjust a leg's
 * source.
 *
 * `load()` reads the section via `toursApi.get`, a plain `GET
 * /trips/:id/routes/:routeId` (added in Task 14's fix round 1). Its `404`
 * IS the "section not found" signal — no separate `list()` call is needed
 * just to check the route exists. An earlier version of this page instead
 * re-sent the section's own current stop order through the WRITE endpoint
 * (`assignStops`) as a deliberate no-op just to get a payload shaped like
 * this one back; that was unsound for a page LOAD — the write endpoint
 * opens a transaction, takes a row lock on every one of the section's
 * stops, and its 409 guard exists precisely because concurrent claims are
 * expected, so merely opening the editor could fail on a lock collision or
 * race a genuine concurrent write. A read must never be able to lose
 * someone else's write.
 */
export default function TripRouteEditorPage(): JSX.Element {
  const { id, routeId } = useParams<{ id: string; routeId: string }>();
  const { t } = useTranslation(["trips", "roadtrips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const { colorOf } = useDomainColors();
  const stravaConnected = useStravaConnected();
  const [stravaOpen, setStravaOpen] = useState(false);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [route, setRoute] = useState<TourRoute | null>(null);
  /* The span the trip already shows, for the Dates section's prefill; null
     until the detail answers (or when there is none to ask). */
  const [span, setSpan] = useState<TripDatesSpan | null>(null);
  const [legs, setLegs] = useState<TourLeg[]>([]);
  /* The section's OWN points, as the endpoint returns them. For a tour on
     a trip they are a subset of `trip.stops` and the assigner works from
     the trip; for a standalone tour there is no trip, and these are the
     only points there are. */
  const [sectionStops, setSectionStops] = useState<TourStop[]>([]);
  const [savingPoints, setSavingPoints] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  // Whether a routing provider is configured and usable right now — see
  // `routingAvailable` on `toursApi.get()`. Defaults to `false` (never a
  // guessed `true`) so a slow/failed load never briefly offers a control
  // that would just 409.
  const [routingAvailable, setRoutingAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  // `null` = loaded fine so far; a value distinguishes "record is gone"
  // (404) from "could not ask" (anything else) — same two-valued
  // vocabulary `lib/api/loadFailure.ts` already uses for cruise/lodging
  // detail pages, so a dropped connection never reads as "this section
  // does not exist".
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!routeId) return;
    setFailure(null);
    try {
      /* `id` is absent on `/tours/:routeId` — a tour that belongs to no
         trip. Then there is no trip to fetch and none to show; every
         section call takes the trip-less path instead (see `sectionPath`
         in `lib/api/tours.ts`), so the rest of this page is unchanged. */
      const [tripData, sectionData, geometryData] = await Promise.all([
        id === undefined ? Promise.resolve(null) : tripsApi.getById(id),
        toursApi.get(id, routeId),
        toursApi.geometry(id, routeId),
      ]);
      if (!mountedRef.current) return;

      /* The Dates section prefills from the span the trip already shows — its
         stored day where a side has one, the stations otherwise. That span is
         the roadtrip detail's (`spanOf` on the server), so the editor asks the
         endpoint the trip's own page asks; a failed read costs the prefill
         only, never the editor, and a day tour has no span to ask for. */
      let spanData: TripDatesSpan | null = null;
      if (sectionData.route.kind === "roadtrip") {
        try {
          const detail = await roadtripsApi.get(sectionData.route.id);
          spanData = { startDate: detail.startDate, endDate: detail.endDate };
        } catch (err) {
          logger.warn("TripRouteEditorPage: failed to load the trip's span", err);
        }
      }
      if (!mountedRef.current) return;

      setSpan(spanData);
      setTrip(tripData);
      setRoute(sectionData.route);
      setLegs(sectionData.legs);
      setSectionStops(sectionData.stops);
      setRoutingAvailable(sectionData.routingAvailable);
      setGeometry(geometryData);
    } catch (err) {
      if (!mountedRef.current) return;
      logger.warn("TripRouteEditorPage: failed to load route", err);
      setFailure(classifyLoadFailure(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [id, routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Recorded tracks (phase 3b, task 8) — a genuinely separate concern from
  // this page's own section/leg state, pulled into its own hook so this
  // file stays readable. Loaded and reported INDEPENDENTLY of `failure`
  // above, so a track-list hiccup never turns into "this section does not
  // exist" — the track list gets its own honest loading/error/empty
  // states instead of inheriting the page's.
  const {
    tracks,
    tracksLoading,
    tracksLoadError,
    loadTracks,
    tracksWithGeometry,
    tracksKnown,
    trackUploading,
    uploadTrack,
    trackPulling,
    pullDawarichTrack,
    deleteTrack,
    dawarichAvailable,
  } = useTourTracks(id, routeId);

  // Every trip stop, annotated for THIS section only. A stop assigned to a
  // DIFFERENT section still shows up (so the user can see it exists and try
  // to claim it), but its switch reads as "off" here — `routeOrderIdx` is
  // deliberately nulled out unless the stop belongs to THIS route, because
  // `TourStopAssigner` has no other way to tell "not in any section" apart
  // from "in a section that is not this one".
  const assignerStops = useMemo<TourStop[]>(() => {
    // No trip means no timeline to choose from: the section's own points
    // ARE the list, and they are all already on it.
    if (trip === null) return sectionStops;
    const stopsWithRoute = (trip.stops ?? []) as unknown as StopWithRoute[];
    return stopsWithRoute.map((s) => ({
      id: s.id,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      routeOrderIdx: s.routeId === routeId ? s.routeOrderIdx : null,
    }));
  }, [trip, sectionStops, routeId]);

  const stopTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of assignerStops) map.set(s.id, s.title);
    return map;
  }, [assignerStops]);

  /**
   * legId -> id of the recorded track that covers it, powering
   * `TourLegList`'s "track" option gate — decided on the server by the rule
   * the adoption itself applies. Asked again whenever the legs or the
   * recordings change.
   */
  const coverageKey = `${legs.map((l) => `${l.id}:${l.fromStopId}:${l.toStopId}`).join(",")}|${tracks
    .map((tr) => tr.id)
    .join(",")}`;
  const { coveringTrackByLegId: trackCoverageByLegId, known: coverageKnown } = useTourTrackCoverage(
    id,
    routeId,
    coverageKey
  );

  // `TripMap` was specifically changed to protect its layer `useMemo` with a
  // stable default (`NO_TOUR_GEOMETRIES`) when no `tourGeometries` prop is
  // passed at all — but this page always passes one, and a fresh array
  // literal built inline in JSX on every render defeats that protection just
  // as completely as omitting the prop would help it. `react-hooks/exhaustive-deps`
  // is disabled repo-wide, so the dependency array here is hand-picked to
  // match exactly what the constructed object reads: `route.id`/`route.name`
  // (not the whole `route` object, whose other fields like `distanceKm`
  // change on every reload without touching this array's shape) and `geometry`.
  const roadtripHex = colorOf("roadtrip");
  // The recordings, drawn as lines of their own. For a day tour the track IS
  // the route — its points are often none at all — so a map without it
  // showed an empty world. Keyed on the ids: `tracksWithGeometry` is a fresh
  // array on every render.
  const recordedKey = tracksWithGeometry.map((tr) => tr.id).join(",");
  const recordingGeometry = useMemo<TourGeometry | null>(
    () =>
      tracksWithGeometry.length === 0
        ? null
        : {
            type: "FeatureCollection",
            features: tracksWithGeometry.map((tr) => ({
              type: "Feature",
              geometry: { type: "LineString", coordinates: [...tr.geometry] },
              properties: {
                legId: `track:${tr.id}`,
                source: "track",
                mode: route?.mode ?? "foot",
                confidence: "high",
                distanceKm: tracks.find((x) => x.id === tr.id)?.distanceKm ?? 0,
              },
            })),
          },
    [recordedKey, route?.mode]
  );
  const tourGeometries = useMemo(() => {
    if (!route) return [];
    // A roadtrip's line in its own domain hue (2.7); a tour keeps the tour hue.
    const rgb = route.kind === "roadtrip" ? hexToRgb(roadtripHex) : undefined;
    return [
      ...(geometry ? [{ routeId: route.id, name: route.name, geometry, rgb }] : []),
      ...(recordingGeometry
        ? [{ routeId: `${route.id}:tracks`, name: route.name, geometry: recordingGeometry, rgb }]
        : []),
    ];
  }, [geometry, recordingGeometry, route?.id, route?.name, route?.kind, roadtripHex]);

  /**
   * What the map draws when there is no trip: the tour's own points. A
   * standalone tour used to get no map at all, because the map could only
   * draw a TRIP; since 2.7 it draws whatever content it is handed.
   */
  const mapContent = useMemo<TripMapContent>(
    () =>
      trip ?? {
        // A route correction bends the line; it is not a stop to mark.
        stops: sectionStops
          .filter((s) => s.viaPoint !== true)
          .map((s) => ({
            title: s.title,
            lat: s.lat,
            lon: s.lon,
            domain: "tour",
          })),
        emptyKey: route?.kind === "roadtrip" ? "roadtrips:map.empty" : "trips:tours.map.empty",
      },
    [trip, sectionStops, route?.kind]
  );

  const handleActivityChange = useCallback(
    async (activity: TourActivity | null): Promise<void> => {
      if (!route) return;
      try {
        const updated = await toursApi.update(id, route.id, { activity });
        setRoute(updated);
      } catch {
        addToast("error", t("roadtrips:activitySaveError"));
      }
    },
    [route, id, addToast, t]
  );

  /**
   * The standalone tour's write path: one call replaces the whole point
   * list, and the response carries the section, its points and the
   * recomputed legs — so nothing is re-read and the page cannot briefly
   * show a list that disagrees with its own kilometres.
   */
  const handleSavePoints = useCallback(
    async (points: TourPointInput[]): Promise<void> => {
      if (!routeId) return;
      setSavingPoints(true);
      setPointsError(null);
      try {
        const result = await toursApi.replacePoints(id, routeId, points);
        if (!mountedRef.current) return;
        setRoute(result.route);
        setSectionStops(result.stops);
        setLegs(result.legs);
        // The geometry is derived from the legs that just changed; it is
        // the one thing the write does not return.
        setGeometry(await toursApi.geometry(undefined, routeId));
      } catch (err) {
        logger.warn("TripRouteEditorPage: saving the points failed", err);
        if (!mountedRef.current) return;
        const message = t(tourPointsSaveErrorKey(err));
        setPointsError(message);
        addToast("error", message);
      } finally {
        if (mountedRef.current) setSavingPoints(false);
      }
    },
    [id, routeId, addToast, t]
  );

  const handleAssignChange = useCallback(
    (orderedIds: string[]): void => {
      if (!id || !routeId) return;
      void (async (): Promise<void> => {
        try {
          await toursApi.assignStops(id, routeId, orderedIds);
          await load();
        } catch (err) {
          // A stop with no coordinate is filtered out client-side, but a
          // stop already claimed by another section (400) or one lost to a
          // concurrent claim (409) can only be found out by asking — both
          // must read as an actual message, never a switch that silently
          // flips back with no explanation.
          addToast("error", apiErrorProse(err) ?? t("trips:tours.assignError"));
        }
      })();
    },
    [id, routeId, load, addToast, t]
  );

  /**
   * Every leg action of this page — source, single-leg routing, the batch,
   * clearing, track adoption and the mode correction (owner request
   * 2026-10-12) — lives in `useTourLegActions`, split out the same way
   * `useTourTracks` already split out the recordings, to keep this page
   * under its file-size ceiling. Its two in-flight flags come back with
   * them: `routingAllInProgress` for the batch button, and the id of the leg
   * whose mode write is in flight, so only THAT row's control waits.
   */
  const legActions = useTourLegActions({
    tripId: id,
    routeId,
    load,
    mountedRef,
    trackCoverageByLegId,
  });

  const handleUploadTrack = useCallback(
    (file: File): void => {
      void (async (): Promise<void> => {
        try {
          await uploadTrack(file);
        } catch (err) {
          // A malformed file, one without timestamps, an oversized one and a
          // duplicate each carry their own server CODE — mapped to DE/EN copy,
          // never the server's English prose.
          addToast(
            "error",
            saveErrorMessage(err, t, "trips:tours.tracks.uploadError", TRACK_ERROR_KEYS)
          );
        }
      })();
    },
    [uploadTrack, addToast, t]
  );

  const handleDeleteTrack = useCallback(
    (track: TourTrackMeta): void => {
      void (async (): Promise<void> => {
        try {
          await deleteTrack(track.id);
        } catch (err) {
          addToast("error", apiErrorProse(err) ?? t("trips:tours.tracks.deleteError"));
        }
      })();
    },
    [deleteTrack, addToast, t]
  );

  const handleDownloadTrack = useCallback(
    (track: TourTrackMeta): void => {
      if (!routeId) return;
      void (async (): Promise<void> => {
        try {
          const file = await trackArchiveApi.downloadTrack(id, routeId, track.id);
          downloadBlob(file.blob, file.filename);
        } catch (err) {
          addToast("error", apiErrorProse(err) ?? t("roadtrips:trackArchive.downloadFailed"));
        }
      })();
    },
    [id, routeId, addToast, t]
  );

  /**
   * Pulls the section's own date span from Dawarich (an empty body — the
   * server derives the window from the section's stops). Three failure
   * shapes, per `toursApi.tracks.pullDawarich`'s doc comment: a fixed-kind
   * 409 (`dawarichFailureKind` parses it, `notConfigured` included), or a
   * `code` (an empty window, too few points, no dated stops to derive one
   * from) that `TRACK_ERROR_KEYS` turns into its own DE/EN sentence.
   */
  const handlePullDawarich = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        await pullDawarichTrack();
      } catch (err) {
        const kind = dawarichFailureKind(err);
        addToast(
          "error",
          kind
            ? t(dawarichFailureKey(kind))
            : saveErrorMessage(err, t, "trips:tours.tracks.dawarich.error", TRACK_ERROR_KEYS)
        );
      }
    })();
  }, [pullDawarichTrack, addToast, t]);

  // The journey this trip is filed on, for the Re-sync section (§K.1): the
  // twin `/trips/:id/route/:routeId` carries it in the path; the standalone
  // mounts (`/tours/:routeId`, `/roadtrips/:routeId/edit`) read it off the
  // route's own `tripId`. `null` on a detached trip — there is no journey to
  // re-sync, and no section.
  const journeyId = id ?? route?.tripId ?? null;

  if (loading) {
    return (
      <AppShell width="list">
        <div className="flex items-center justify-center py-20 text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      </AppShell>
    );
  }

  // A standalone tour (and a roadtrip) has no trip, so `trip === null` is its
  // normal state, not a failure. Only a TRIP section needs its trip loaded.
  // This read `!trip` alone until 2026-09-24, which turned every standalone
  // tour's page into "could not be loaded" — found in the browser.
  if (failure || !route || (id !== undefined && !trip)) {
    return (
      <AppShell width="reading">
        <div className="py-16 text-center">
          <p className="text-sm text-rose-400">
            {failure === "notFound" ? t("trips:tours.notFound") : t("trips:tours.loadError")}
          </p>
          {failure === "loadError" && (
            <button type="button" className="mt-3 underline text-sm" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </button>
          )}
          <div className="mt-6">
            {/* The same way back as the loaded page draws: a failed load is
                still that page, and the owner's report covers "every screen"
                — a second, differently-styled back link on the error arm is
                the drift this change exists to remove. */}
            <BackLink to={id ? `/trips/${id}?tab=tours` : "/tours"}>
              {t("trips:tours.backToTrip")}
            </BackLink>
          </div>
        </div>
      </AppShell>
    );
  }

  const ownPoints = editsOwnPoints(trip !== null, sectionStops);
  return (
    <AppShell width="list">
      <div className="space-y-6">
        <div>
          <BackLink
            to={
              route.kind === "roadtrip"
                ? `/roadtrips/${route.id}`
                : id
                  ? `/trips/${id}?tab=tours`
                  : "/tours"
            }
          >
            {route.kind === "roadtrip"
              ? t("roadtrips:backToRoadtrip")
              : t(id ? "trips:tours.backToTrip" : "trips:tours.backToTours")}
          </BackLink>
          {/* The trip's page actions on the title's line, at the right
              (owner, 2026-10-15). A day tour has none: passing the element
              anyway would leave `PageHeader` an empty flex box, since it
              tests the slot for truthiness, not for what the element renders. */}
          <PageHeader
            title={route.name}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                {route.kind === "tour" && (
                  <select
                    id="tour-activity"
                    value={route.activity ?? ""}
                    onChange={(e) =>
                      void handleActivityChange((e.target.value || null) as TourActivity | null)
                    }
                    aria-label={t("roadtrips:activityLabel")}
                    className="rounded-sm border border-(--color-border) bg-transparent px-2 py-0.5 text-sm"
                  >
                    <option value="">{t("roadtrips:activityNone")}</option>
                    {TOUR_ACTIVITIES.map((a) => (
                      <option key={a} value={a}>
                        {t(`roadtrips:activity.${a}`)}
                      </option>
                    ))}
                  </select>
                )}
                {route.kind === "tour" && (
                  <TourDayEditor route={route} tripId={id} onSaved={setRoute} />
                )}
                <span>
                  {t(`trips:tours.mode.${route.mode}`)} ·{" "}
                  {/* A day tour is measured by its recording once it has one. */}
                  {formatKm(
                    route.kind === "tour" && tracks.length > 0
                      ? tracks.reduce((sum, tr) => sum + tr.distanceKm, 0)
                      : route.distanceKm
                  )}{" "}
                  km
                </span>
              </span>
            }
            actions={
              route.kind === "roadtrip" ? (
                <RoadtripEditActions route={route} journeyId={journeyId} />
              ) : undefined
            }
          />
        </div>

        {route.kind === "tour" && (
          <TourRecordingSummary
            tracks={tracks}
            tripId={id}
            routeId={route.id}
            accent={TOUR_COLOR}
          />
        )}
        {route.kind === "tour" && tracksKnown && tracks.length === 0 && legs.length > 0 && (
          <PlannedProfileCard
            routeId={route.id}
            lineKey={legs
              .map((l) => `${l.fromStopId}-${l.toStopId}-${l.source}-${l.distanceKm}`)
              .join("|")}
            accent={TOUR_COLOR}
          />
        )}

        {/* The trip's own start and end (owner 2026-10-13): the primary way
            its span is set, beside the re-sync window that writes the same
            fields. It opens pre-filled with what the trip already shows, so
            an untouched save keeps those dates as the trip's own. A day tour
            renders nothing here. */}
        <RoadtripDatesSection route={route} tripId={id} span={span} onSaved={setRoute} />

        {/* A trip's section draws the whole trip around it; a standalone
            tour or a roadtrip draws its own points (see `mapContent`). */}
        <TripMap trip={mapContent} tourGeometries={tourGeometries} />

        <section>
          <h2 className="text-lg font-semibold mb-3">
            {ownPoints ? t("trips:tours.points.heading") : t("trips:tours.stopsHeading")}
          </h2>
          {ownPoints ? (
            <TourPointEditor
              points={sectionStops.map((s) => ({
                id: s.id,
                title: s.title,
                lat: s.lat ?? NaN,
                lon: s.lon ?? NaN,
                via: s.viaPoint === true,
                // The stored night, so the editor disables the correction
                // switch there instead of letting a save find the refusal.
                hasNight: s.hasNight === true,
              }))}
              saving={savingPoints}
              error={pointsError}
              onSave={(points) => void handleSavePoints(points)}
            />
          ) : (
            <TourStopAssigner stops={assignerStops} onChange={handleAssignChange} />
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("trips:tours.legsHeading")}</h2>
          <TourLegList
            legs={legs}
            stopTitleById={stopTitleById}
            routingAvailable={routingAvailable}
            onSetSource={legActions.setSource}
            onRoute={legActions.route}
            trackCoverageByLegId={trackCoverageByLegId}
            tracksKnown={coverageKnown && tracksKnown}
            onAdoptTrack={legActions.adoptTrack}
            onClear={legActions.clear}
            onRouteAll={legActions.routeAll}
            routingAllInProgress={legActions.routingAllInProgress}
            onSetMode={legActions.setMode}
            modeChangeInFlightLegId={legActions.modeChangeInFlightLegId}
          />
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("trips:tours.tracks.heading")}</h2>
          <TourTrackList
            tracks={tracks}
            loading={tracksLoading}
            loadError={tracksLoadError}
            onRetry={loadTracks}
            uploading={trackUploading}
            onUpload={handleUploadTrack}
            onDelete={handleDeleteTrack}
            onDownload={handleDownloadTrack}
            pulling={trackPulling}
            dawarichAvailable={dawarichAvailable}
            onPullDawarich={handlePullDawarich}
            onImportStrava={stravaConnected ? () => setStravaOpen(true) : undefined}
          />
          {stravaOpen && route && (
            <StravaImportDialog
              target={{ kind: "route", routeId: route.id }}
              around={tracks[0]?.startedAt ?? null}
              onClose={() => setStravaOpen(false)}
              onDone={() => {
                setStravaOpen(false);
                void loadTracks();
              }}
            />
          )}
        </section>
      </div>
    </AppShell>
  );
}
