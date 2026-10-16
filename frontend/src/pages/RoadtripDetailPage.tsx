import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import FormFooter from "../components/ui/FormFooter";
import { Icon } from "../components/ui/Icon";
import EntityHeader from "../components/Entity/EntityHeader";
import EntityPage from "../components/Entity/EntityPage";
import EntityTabBar from "../components/ui/EntityTabBar";
import LegDialog from "../components/Roadtrips/LegDialog";
import RoadtripGallery from "../components/Roadtrips/RoadtripGallery";
import RoadtripMapPanel from "../components/Roadtrips/RoadtripMapPanel";
import RoadtripSummaryPanel from "../components/Roadtrips/RoadtripSummaryPanel";
import RoadtripTimelineTab from "../components/Roadtrips/RoadtripTimelineTab";
import RoadtripLogisticsTab from "../components/Roadtrips/RoadtripLogisticsTab";
import { Placeholder } from "../components/Trips/TripDetailPanels";
import StationEditor, {
  type EditorSaveState,
  type EditorStart,
} from "../components/Roadtrips/StationEditor";
import StationTimeline from "../components/Roadtrips/StationTimeline";
import type { SaveStatus } from "../components/Roadtrips/useStationAutosave";
import { useTranslation } from "../hooks/useTranslation";
import { roadtripsApi } from "../lib/api/roadtrips";
import { toursApi } from "../lib/api/tours";
import { logger } from "../lib/logger";
import { DETAIL_MAP_BOX_RADIUS, DETAIL_MAP_STICKY_TOP } from "../lib/detailChrome";
import { useTodayZone } from "../hooks/useTodayZone";
import { todayIn } from "../shared/time";
import { useToastStore } from "../store/toastStore";
import type { RoadtripDetail, RoadtripStation } from "../types/roadtrip";
import type { TourGeometry, TourLeg } from "../types/tour";

type LegEdit = {
  leg: TourLeg;
  from: { id: string; title: string };
  to: { id: string; title: string };
};

/** The shared tab set (spec 2026-10-12 §3): the trip page's five, no Trips tab. */
type TripTabKey = "overview" | "timeline" | "map" | "gallery" | "logistics";
const TRIP_TABS: TripTabKey[] = ["overview", "timeline", "map", "gallery", "logistics"];

const STATUS_COLOR: Record<SaveStatus, string> = {
  saved: "var(--ts-good)",
  pending: "var(--ts-muted)",
  saving: "var(--ts-muted)",
  error: "var(--ts-bad)",
  waiting: "var(--ts-warn)",
  conflict: "var(--ts-bad)",
};

/**
 * One roadtrip (design 2026-09-25, board 2): the head and its figures, the
 * stations by day beside a map that follows the selection; the day tours and
 * the costs (forgejo#140) moved to the Logistics tab (template spec §3).
 * Editing happens on the same page — the stations turn into the
 * editor, the map stays — and saves as it goes.
 *
 * `?station=neu` opens the editor with a new station (from "Neuer
 * Roadtrip"), `?station=heute` with one dated today (from "Heutige Nacht
 * eintragen").
 */
export default function RoadtripDetailPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  // The tab labels live in the `trips` namespace — the same keys the journey
  // page's bar draws, so the shared tab set cannot spell its words twice.
  const { t, i18n } = useTranslation(["roadtrips", "common", "trips"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const todayZone = useTodayZone();
  const today = useMemo(() => todayIn(todayZone), [todayZone]);

  /* The open tab lives in the URL, like the journey page's: a link can name
     one and a browser Back returns to it. An unknown value falls back to the
     overview rather than rendering nothing. */
  const tabParam = params.get("tab");
  const tab: TripTabKey = TRIP_TABS.includes(tabParam as TripTabKey)
    ? (tabParam as TripTabKey)
    : "overview";
  const setTab = (next: TripTabKey): void => {
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next === "overview") nextParams.delete("tab");
        else nextParams.set("tab", next);
        return nextParams;
      },
      { replace: true }
    );
  };

  const arrival = params.get("station");
  const [editorStart] = useState<EditorStart>(
    arrival === "heute" ? "today" : arrival === "neu" ? "new" : "plain"
  );
  const [editing, setEditing] = useState(editorStart !== "plain");
  const [detail, setDetail] = useState<RoadtripDetail | null>(null);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legEdit, setLegEdit] = useState<LegEdit | null>(null);
  const [save, setSave] = useState<{ status: SaveStatus; flush: () => Promise<unknown> }>({
    status: "saved",
    flush: async () => {},
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The station query parameter has done its job once the editor opened — and
  // the tab leaves with it, because the editor it opens lives on the overview:
  // `?tab=map&station=heute` must not leave the editor open on a tab that does
  // not draw it. Every other parameter survives (the old `setParams({})` wiped
  // them all, the tab flag included).
  useEffect(() => {
    if (!arrival) return;
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.delete("station");
        updated.delete("tab");
        return updated;
      },
      { replace: true }
    );
  }, [arrival, setParams]);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const [d, g] = await Promise.all([
        roadtripsApi.get(id),
        // The line is decoration beside the stations: a failed geometry call
        // leaves the map without it rather than the page without anything.
        toursApi.geometry(undefined, id).catch((err: unknown) => {
          logger.warn("Roadtrip geometry failed to load", err);
          return null;
        }),
      ]);
      if (!mountedRef.current) return;
      setDetail(d);
      setGeometry(g);
    } catch {
      if (mountedRef.current) setLoadError(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Upstream's richer `EditorSaveState` (forgejo#244): the page reads only the
  // status and the flush it always showed; `local`/`discard`/`merge` belong to
  // the editor's own status component.
  const onStatus = useCallback(
    (state: EditorSaveState) => setSave({ status: state.status, flush: state.flush }),
    []
  );

  // The map content, its line and the selection ring live in
  // `RoadtripMapPanel`, which both the overview's aside and the Map tab draw.
  const selected = detail?.stations.find((s) => s.id === selectedId) ?? null;

  const startTour = async (station: RoadtripStation): Promise<void> => {
    try {
      const tour = await toursApi.createStandalone({
        name: station.title,
        mode: "foot",
        activity: "hike",
      });
      await toursApi.update(undefined, tour.id, { anchorStopId: station.id });
      navigate(`/tours/${tour.id}`);
    } catch {
      addToast("error", t("roadtrips:startTourError"));
    }
  };

  // A station that is not complete keeps the editor open: closing would
  // leave it unsaved with nothing on screen saying so. Its hint is already
  // in the "still open" list.
  const finishEditing = async (): Promise<void> => {
    if (save.status === "waiting") return;
    await save.flush();
    setEditing(false);
    await load();
  };

  if (loadError) {
    return (
      <AppShell width="table">
        <EmptyState
          kind="degraded"
          title={t("roadtrips:detailLoadError")}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </Button>
          }
        />
      </AppShell>
    );
  }
  if (!detail) {
    return (
      <AppShell width="table">
        <div
          aria-busy="true"
          aria-label={t("common:loading.default")}
          className="flex flex-col"
          style={{ gap: 16 }}
        >
          <div
            className="animate-pulse"
            style={{
              height: 150,
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
            }}
          />
          <div
            className="animate-pulse"
            style={{
              height: 96,
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
            }}
          />
          <div
            className="animate-pulse"
            style={{
              height: 420,
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
            }}
          />
        </div>
      </AppShell>
    );
  }

  const r = detail.roadtrip;

  return (
    <AppShell width="table">
      {/* The editor draws no tabs: its Done button is the way back, and a
          half-saved station must not be left behind a tab switch. */}
      <EntityPage
        level="trip"
        detail={detail}
        today={today}
        header={<EntityHeader level="trip" id={id} name={r.name} countries={detail.countries} />}
        tabBar={
          !editing ? (
            <EntityTabBar
              tabs={TRIP_TABS}
              tab={tab}
              onChange={setTab}
              label={(key) => t(`trips:detail.tabs.${key}`)}
            />
          ) : undefined
        }
      >
        {/* The day-by-day breakdown: the same material as the overview's
            chain, with each day's stay dates, notes, places and nights. No
            wrapper of its own: `EntityPage`'s body already carries the gap,
            and a second `marginTop` here started this arm lower than the
            Gallery/Logistics ones — a visible jump between tabs of one page. */}
        {!editing && tab === "timeline" && <RoadtripTimelineTab detail={detail} />}

        {/* The full-screen map of the trip: its route and its stations, the
            same panel the overview carries in its aside. */}
        {!editing && tab === "map" && <RoadtripMapPanel detail={detail} geometry={geometry} />}

        {/* Every arm is gated on `editing` as the two above: the tab a station
            arrival came over is cleared in an effect, one render after the tab
            was read, so an ungated arm would paint behind the editor. */}
        {!editing &&
          tab === "gallery" &&
          (detail.trip ? (
            <RoadtripGallery detail={detail} onChanged={() => void load()} />
          ) : (
            <Placeholder text={t("roadtrips:detail.noAlbum")} />
          ))}

        {!editing && tab === "logistics" && (
          <RoadtripLogisticsTab detail={detail} onChanged={() => void load()} />
        )}

        {(editing || tab === "overview") && (
          <>
            {/* The editor's way out: the autosave status and the Done button
                that rode the head's action slot until the template (spec §2.1:
                the head is the name, the flags and ONE Edit link).

                Done is the commit of this editor, so it is the amber primary —
                and it draws `size="toolbar"`, the 46px row height, not the
                lone-CTA 52: the journey's Save and the points editor's "Save
                points" are both 46 in a footer row, and a 52 beside them was
                the last of the mismatched sizes the owner reported
                (2026-10-15: "the save button in edit mode aren't in same
                location or design").

                It is the shared `FormFooter` now, not a row of its own: the
                autosave status rides the `hint` slot and Done ends at the same
                right edge as every other commit control (owner, 2026-10-15:
                "lets move all the interactive buttons on the right side of
                screen"). This row is where the two treatments visibly
                disagreed — the status sat left and the button left with it. */}
            {editing && (
              <FormFooter
                hint={
                  <>
                    <span
                      role="status"
                      className="flex items-center"
                      style={{ gap: 6, fontSize: 13, color: STATUS_COLOR[save.status] }}
                    >
                      {save.status === "saved" && <Icon name="check" size={14} />}
                      {t(`roadtrips:editor.status.${save.status}`)}
                    </span>
                    {/* The retry is a control, not part of the announcement:
                        it sits BESIDE the `role="status"` line rather than
                        inside it, so the live region keeps saying the status
                        and nothing re-announces a button. Until 2026-10-15 it
                        was an underlined word — the one action this footer
                        offers when the autosave has failed, drawn as prose. */}
                    {save.status === "error" && (
                      <Button variant="secondary" size="toolbar" onClick={() => void save.flush()}>
                        {t("roadtrips:editor.status.retry")}
                      </Button>
                    )}
                  </>
                }
              >
                <Button variant="primary" size="toolbar" onClick={() => void finishEditing()}>
                  {t("roadtrips:detail.done")}
                </Button>
              </FormFooter>
            )}

            <div
              className="grid items-start lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"
              style={{ gap: "var(--ts-space-xl)", marginTop: "var(--ts-space-xl)" }}
            >
              <section className="order-2 flex min-w-0 flex-col lg:order-1" style={{ gap: 8 }}>
                <h2 className="t-card-title">{t("roadtrips:stations.title")}</h2>
                {editing ? (
                  <StationEditor
                    routeId={id}
                    stations={detail.stations.filter((s) => s.lat !== null)}
                    legs={detail.legs}
                    tripId={detail.trip?.id ?? null}
                    start={editorStart}
                    today={today}
                    onSaved={() => void load()}
                    onStatus={onStatus}
                    onEditLeg={(leg, from, to) => setLegEdit({ leg, from, to })}
                  />
                ) : (
                  <StationTimeline
                    stations={detail.stations}
                    legs={detail.legs}
                    tours={detail.tours}
                    startDate={detail.startDate}
                    today={today}
                    selectedId={selectedId}
                    onSelect={(s) => setSelectedId((cur) => (cur === s.id ? null : s.id))}
                    onStartTour={(s) => void startTour(s)}
                  />
                )}
              </section>

              {/* The sticky map panel both detail pages draw, from the two numbers
                  they share (`lib/detailChrome`) — the journey page's `<aside>` is
                  this one with a different map in it. */}
              <aside
                className="order-1 flex flex-col lg:sticky lg:order-2"
                style={{ gap: 8, top: DETAIL_MAP_STICKY_TOP }}
              >
                <div
                  className="overflow-hidden"
                  style={{
                    borderRadius: DETAIL_MAP_BOX_RADIUS,
                    border: "1px solid var(--ts-border)",
                    height: "min(640px, calc(100vh - 96px))",
                    minHeight: 380,
                  }}
                >
                  <RoadtripMapPanel detail={detail} geometry={geometry} selected={selected} />
                </div>
                {!editing && <span className="t-caption">{t("roadtrips:detail.mapHint")}</span>}
              </aside>
            </div>

            {/* Spec §1, §6: the trip's own summary reads BELOW its map, as the
                journey's reads below its own — the same card on both levels. A
                detached trip (no journey) shows no summary section at all (spec
                §8), because the summary belongs to a trip that is filed. */}
            {detail.trip !== null && (
              <div style={{ marginTop: "var(--ts-space-xl)" }}>
                <RoadtripSummaryPanel
                  roadtripId={r.id}
                  summary={detail.summary}
                  language={i18n.language}
                  onChanged={() => void load()}
                />
              </div>
            )}
          </>
        )}
      </EntityPage>

      {legEdit && (
        <LegDialog
          routeId={id}
          leg={legEdit.leg}
          from={legEdit.from}
          to={legEdit.to}
          routingAvailable={detail.routingAvailable}
          onClose={() => setLegEdit(null)}
          onChanged={() => void load()}
          onSaved={() => {
            setLegEdit(null);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}
