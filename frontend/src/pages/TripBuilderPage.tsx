import { useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

import {
  AppShell,
  Button,
  Card,
  EmptyState,
  PageHeader,
  TOOLBAR_CONTROL_STYLE,
} from "../components/ui";
import ChangeDatesDialog from "../components/Trips/tripBuilder/ChangeDatesDialog";
import { ExistingDiffProvider } from "../components/Trips/tripBuilder/ExistingDiffContext";
import ExistingSuccessSummary from "../components/Trips/tripBuilder/ExistingSuccessSummary";
import NotSeenList from "../components/Trips/tripBuilder/NotSeenList";
import ReviewAlbumSection from "../components/Trips/tripBuilder/ReviewAlbumSection";
import ReviewAreaSection from "../components/Trips/tripBuilder/ReviewAreaSection";
import ReviewExcluded from "../components/Trips/tripBuilder/ReviewExcluded";
import ReviewFlightRows from "../components/Trips/tripBuilder/ReviewFlightRows";
import ReviewHeader from "../components/Trips/tripBuilder/ReviewHeader";
import ReviewMapPreview from "../components/Trips/tripBuilder/ReviewMapPreview";
import ReviewNightChip from "../components/Trips/tripBuilder/ReviewNightChip";
import ReviewPhotoJourneys from "../components/Trips/tripBuilder/ReviewPhotoJourneys";
import ReviewSection from "../components/Trips/tripBuilder/ReviewSection";
import ReviewStopovers from "../components/Trips/tripBuilder/ReviewStopovers";
import ReviewWarnings from "../components/Trips/tripBuilder/ReviewWarnings";
import ShowUnchangedToggle from "../components/Trips/tripBuilder/ShowUnchangedToggle";
import { useBuilderSession, type BuilderSession } from "../hooks/useBuilderSession";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useTranslation } from "../hooks/useTranslation";
import { DETAIL_MAP_STICKY_TOP } from "../lib/detailChrome";
import { useDisplayFormat } from "../lib/displayFormat";
import { effectiveNights, sleptKeys } from "../lib/tripBuilder/planRules";
import {
  nightChoices,
  placeNights,
  reviewProblems,
  unknownNightCount,
  type ReviewProblem,
} from "../lib/tripBuilder/reviewView";
import {
  TRIP_BUILDER_PHASES,
  pitstopRetry,
  stopoverRetry,
  type AlbumOutcome,
  type AlbumRetryTarget,
  type CommitBlocked,
  type CommitResult,
  type PreflightBlockReason,
  type TripBuilderPhase,
} from "../types/tripBuilder";

const PHASE_KEY: Record<TripBuilderPhase, string> = {
  fetch: "tripBuilder:progress.fetch",
  clean: "tripBuilder:progress.clean",
  flights: "tripBuilder:progress.flights",
  movement: "tripBuilder:progress.movement",
  names: "tripBuilder:progress.names",
  roads: "tripBuilder:progress.roads",
  nights: "tripBuilder:progress.nights",
};

const PROBLEM_KEY: Record<ReviewProblem["code"], string> = {
  blankTripName: "tripBuilder:review.problems.blankTripName",
  roadtripTooShort: "tripBuilder:review.problems.roadtripTooShort",
  nightPlanInvalid: "tripBuilder:review.problems.nightPlanInvalid",
};

const BLOCKED_KEY: Record<PreflightBlockReason, string> = {
  sharedConnection: "tripBuilder:review.blocked.sharedConnection",
  connectionChanged: "tripBuilder:review.blocked.connectionChanged",
  missingScopes: "tripBuilder:review.blocked.missingScopes",
  unreachable: "tripBuilder:review.blocked.unreachable",
};

/** Where the Immich key is set; opened in a new tab so the review is kept. */
const KEY_SETTINGS = "/settings/services?section=externalServices";

function Message({
  kind = "nothing",
  title,
  description,
  action,
}: {
  kind?: "nothing" | "degraded" | "pending";
  title: string;
  description?: string;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <Card>
      <EmptyState kind={kind} title={title} description={description} action={action} />
    </Card>
  );
}

/**
 * One success-panel line per city album — a stopover's or a pitstop area's own
 * (spec 2026-10-11 §5.4, pitstops §4) — with its own retry when it failed. One
 * component renders both album classes so a status branch, a string or the
 * retry guard can never drift between them; only the retry target differs.
 */
function SuccessAlbumLine({
  albumKey,
  name,
  outcome,
  retryTarget,
  retrying,
  onRetryAlbum,
}: {
  albumKey: string;
  name: string;
  outcome: AlbumOutcome;
  retryTarget: AlbumRetryTarget;
  retrying: AlbumRetryTarget | null;
  onRetryAlbum: (target: AlbumRetryTarget) => void;
}): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return (
    <div
      data-album={albumKey}
      className="flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-md)" }}
    >
      {(outcome.status === "linked" || outcome.status === "skipped") && (
        <span className="t-caption">
          {t("tripBuilder:review.success.pitstopAlbum", {
            name,
            added: outcome.added ?? 0,
            already: outcome.alreadyIn ?? 0,
          })}
        </span>
      )}
      {(outcome.status === "failed" || outcome.status === "blocked") && (
        <>
          <span className="t-caption">
            {t("tripBuilder:review.success.pitstopAlbumFailed", { name })}
          </span>
          <Button disabled={retrying !== null} onClick={() => onRetryAlbum(retryTarget)}>
            {t("tripBuilder:review.success.retryAlbum")}
          </Button>
        </>
      )}
    </div>
  );
}

function SuccessPanel({
  result,
  retrying,
  onRetryAlbum,
  onOpen,
}: {
  result: CommitResult;
  retrying: AlbumRetryTarget | null;
  onRetryAlbum: (target: AlbumRetryTarget) => void;
  onOpen: () => void;
}): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const stations = result.roadtrips.reduce((sum, roadtrip) => sum + roadtrip.stations, 0);
  const nights = result.roadtrips.reduce((sum, roadtrip) => sum + roadtrip.nights, 0);
  const { album } = result;
  const facts = [
    result.roadtrips.length > 0
      ? t("tripBuilder:review.success.stations", { count: stations })
      : null,
    result.roadtrips.length > 0 ? t("tripBuilder:review.success.nights", { count: nights }) : null,
    result.stopIds.length > 0
      ? t("tripBuilder:review.success.stops", { count: result.stopIds.length })
      : null,
    result.flightsAssigned > 0
      ? t("tripBuilder:review.success.flights", { count: result.flightsAssigned })
      : null,
    result.routing.straight > 0
      ? t("tripBuilder:review.success.legsStraight", { count: result.routing.straight })
      : null,
    result.unknownNights > 0
      ? t("tripBuilder:review.success.unknownNights", { count: result.unknownNights })
      : null,
    // An updated trip's album has its own line in the diff below.
    result.created && album.status === "linked"
      ? t("tripBuilder:review.success.albumAdded", {
          added: album.added ?? 0,
          already: album.alreadyIn ?? 0,
        })
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--ts-space-lg)" }}>
      <h2 className="t-card-title">
        {result.created
          ? t("tripBuilder:review.success.created")
          : t("tripBuilder:review.success.updated")}
      </h2>
      {facts.length > 0 && <p>{facts.join(" · ")}</p>}
      <ExistingSuccessSummary result={result} />
      {!result.routing.providerAvailable && result.routing.straight > 0 && (
        <p className="t-caption">{t("tripBuilder:review.success.noRouting")}</p>
      )}
      {(album.status === "failed" || album.status === "blocked") && (
        <div
          data-album="trip"
          className="flex flex-wrap items-center"
          style={{ gap: "var(--ts-space-md)" }}
        >
          <span className="t-caption">{t("tripBuilder:review.success.albumFailed")}</span>
          <Button disabled={retrying !== null} onClick={() => onRetryAlbum("trip")}>
            {t("tripBuilder:review.success.retryAlbum")}
          </Button>
        </div>
      )}
      {(result.stopoverAlbums ?? []).map(({ key, name, album: outcome }) => (
        <SuccessAlbumLine
          key={key}
          albumKey={key}
          name={name}
          outcome={outcome}
          retryTarget={stopoverRetry(key)}
          retrying={retrying}
          onRetryAlbum={onRetryAlbum}
        />
      ))}
      {(result.pitstopAlbums ?? []).map(({ key, name, album: outcome }) => (
        <SuccessAlbumLine
          key={key}
          albumKey={key}
          name={name}
          outcome={outcome}
          retryTarget={pitstopRetry(key)}
          retrying={retrying}
          onRetryAlbum={onRetryAlbum}
        />
      ))}
      <div>
        <Button variant="primary" onClick={onOpen}>
          {t("tripBuilder:review.success.open")}
        </Button>
      </div>
    </Card>
  );
}

function BlockedPanel({
  blocked,
  busy,
  onSaveWithoutAlbum,
}: {
  blocked: CommitBlocked;
  busy: boolean;
  onSaveWithoutAlbum: () => void;
}): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return (
    <Card
      role="alert"
      style={{ display: "flex", flexDirection: "column", gap: "var(--ts-space-lg)" }}
    >
      <p>{t(BLOCKED_KEY[blocked.reason], { scopes: blocked.missingScopes.join(", ") })}</p>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-md)" }}>
        <a
          href={KEY_SETTINGS}
          target="_blank"
          rel="noreferrer"
          className="ts-button inline-flex items-center"
          data-variant="secondary"
          style={{
            ...TOOLBAR_CONTROL_STYLE,
            border: "1px solid var(--ts-border-button)",
            color: "var(--ts-text)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {t("tripBuilder:review.blocked.fixKey")}
        </a>
        <Button disabled={busy} onClick={onSaveWithoutAlbum}>
          {t("tripBuilder:review.blocked.saveWithoutAlbum")}
        </Button>
      </div>
    </Card>
  );
}

function ReviewScreen({
  session,
  onBack,
}: {
  session: BuilderSession;
  onBack: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const [changingDates, setChangingDates] = useState(false);
  const { draft, state, commit, edit } = session;
  if (draft === null || state === null) return null;

  const problems = reviewProblems(draft, state);
  const placed = placeNights(draft, state);
  const slept = sleptKeys(state);
  const answers = effectiveNights(state);
  const running = commit.kind === "running";
  // While a commit is in flight its key belongs to this draft: scanning again
  // would hand the key to another draft (and so a second trip), and leaving would
  // hide what the commit did. Every way out of the review waits for the answer.
  const openDates = (): void => {
    if (!running) setChangingDates(true);
  };
  const rescan = (range: Parameters<BuilderSession["rescan"]>[0]): void => {
    if (!running) void session.rescan(range);
  };
  const cancel = (): void => {
    if (!running) onBack();
  };
  const emptyWindow = draft.stats.assets === 0;
  const ticked = draft.flights.filter((f) => !f.locked && state.flightTicks[f.id]).length;
  const roadtripsHidden = draft.warnings.some((w) => w.code === "roadtripsHidden");
  const { startDay, endDay } = draft.window;

  // Why Create/Update is off, said at the button: the reasons block sits in
  // the very next element after the header that holds the action row, and the
  // button describes itself by it. A disabled button that only greys out
  // leaves a hover with nothing but the not-allowed cursor (owner,
  // 2026-10-12, on the journey page's twin), and the problems list it was
  // first said in stands a whole name/dates/nights panel below the button.
  const blockersId = "builder-review-blockers";
  const blockers = problems.length > 0 || emptyWindow;

  const create = (
    <Button
      variant="primary"
      size="toolbar"
      disabled={running || emptyWindow || problems.length > 0}
      aria-describedby={blockers ? blockersId : undefined}
      onClick={() => void session.submit()}
    >
      {running
        ? t("tripBuilder:review.saving")
        : draft.target.kind === "existing"
          ? t("tripBuilder:existing.header.update")
          : t("tripBuilder:review.createTrip")}
    </Button>
  );

  const body = (
    <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <ShowUnchangedToggle />
      {state.areas.map((area, index) => (
        <ReviewAreaSection
          key={area.key}
          draft={draft}
          state={state}
          area={area}
          ordinal={index + 1}
          nights={placed.byArea.get(area.key) ?? []}
          slept={slept}
          roadtripsHidden={roadtripsHidden}
          onEdit={edit}
        />
      ))}
      <NotSeenList areaKey={null} />
      {placed.loose.length > 0 && (
        <ReviewSection title={t("tripBuilder:review.otherNights")}>
          {placed.loose.map((night) => (
            <ReviewNightChip
              key={night}
              day={night}
              assign={answers[night]}
              choices={nightChoices(draft, state, night)}
              onAssign={(assign) => edit({ type: "assignNight", day: night, assign })}
            />
          ))}
        </ReviewSection>
      )}
      <ReviewFlightRows
        flights={draft.flights}
        ticks={state.flightTicks}
        onTick={(flightId, ticked) => edit({ type: "setFlightTick", flightId, ticked })}
      />
      <ReviewStopovers
        stopovers={draft.stopovers ?? []}
        flights={draft.flights}
        ticks={state.stopoverTicks}
        roadtripsHidden={roadtripsHidden}
        onTick={(key, tick) =>
          edit({ type: "setStopoverTick", key, roadtrip: tick.roadtrip, album: tick.album })
        }
      />
      {draft.album !== null && state.album !== null && (
        <ReviewAlbumSection
          album={draft.album}
          value={state.album}
          onChange={(createAlbum, name) => edit({ type: "setAlbum", create: createAlbum, name })}
        />
      )}
      <ReviewPhotoJourneys
        journeys={draft.photoJourneys}
        ticks={state.photoJourneyTicks}
        onTick={(id, tickedJourney) =>
          edit({ type: "togglePhotoJourney", id, ticked: tickedJourney })
        }
      />
      <ReviewExcluded excluded={draft.stats.excluded} />
      <ReviewWarnings warnings={draft.warnings} window={draft.window} onExtend={rescan} />
    </div>
  );

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <PageHeader
        title={
          draft.target.kind === "existing"
            ? t("tripBuilder:review.titleExisting")
            : t("tripBuilder:review.titleNew")
        }
        meta={t("tripBuilder:review.meta", {
          from: fmt.localDate(startDay),
          to: fmt.localDate(endDay),
          assets: draft.stats.assets,
        })}
        actions={
          <>
            {state.edits.length > 0 && !running && (
              <Button onClick={session.resetEdits}>{t("tripBuilder:review.reset")}</Button>
            )}
            <Button disabled={running} onClick={onBack}>
              {t("tripBuilder:review.back")}
            </Button>
            {create}
          </>
        }
      />

      {blockers && (
        <div id={blockersId} role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {problems.length > 0 && (
            <ul>
              {problems.map((problem) => (
                <li key={problem.code === "roadtripTooShort" ? problem.areaKey : problem.code}>
                  {t(PROBLEM_KEY[problem.code], {
                    name:
                      problem.code === "roadtripTooShort"
                        ? (state.areas.find((a) => a.key === problem.areaKey)?.name ?? "")
                        : "",
                  })}
                </li>
              ))}
            </ul>
          )}
          {/* The button is off for an empty window too, and the copy that says
              so already exists — reused, never re-invented. */}
          {emptyWindow && (
            <p>
              {t("tripBuilder:review.empty.noPhotos", {
                from: fmt.localDate(startDay),
                to: fmt.localDate(endDay),
              })}
            </p>
          )}
        </div>
      )}

      {commit.kind === "failed" && (
        <Card
          role="alert"
          style={{ display: "flex", flexDirection: "column", gap: "var(--ts-space-md)" }}
        >
          <p>{commit.message}</p>
          {commit.canScanAgain && (
            <div>
              <Button onClick={() => rescan({})}>{t("tripBuilder:review.failed.scanAgain")}</Button>
            </div>
          )}
        </Card>
      )}
      {commit.kind === "blocked" && (
        <BlockedPanel
          blocked={commit.blocked}
          busy={running}
          onSaveWithoutAlbum={() => void session.submit(true)}
        />
      )}

      <ReviewHeader
        draft={draft}
        tripName={state.tripName}
        countries={state.countries}
        unknownNights={unknownNightCount(state)}
        carried={session.carried}
        onTripName={(name) => edit({ type: "setTripName", name })}
        onCountries={(countries) => edit({ type: "setCountries", countries })}
        onChangeDates={openDates}
      />

      {emptyWindow ? (
        <Message
          title={t("tripBuilder:review.empty.noPhotos", {
            from: fmt.localDate(startDay),
            to: fmt.localDate(endDay),
          })}
          description={[
            t("tripBuilder:review.empty.checked", {
              from: fmt.localDate(draft.window.checkedFrom),
              to: fmt.localDate(draft.window.checkedTo),
            }),
            draft.stats.excluded.partner > 0
              ? t("tripBuilder:review.empty.partner", { count: draft.stats.excluded.partner })
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          action={
            <div className="flex flex-wrap justify-center" style={{ gap: "var(--ts-space-md)" }}>
              <Button disabled={running} onClick={openDates}>
                {t("tripBuilder:review.empty.changeDates")}
              </Button>
              {ticked > 0 && (
                <Button
                  variant="primary"
                  size="toolbar"
                  disabled={running}
                  onClick={() => void session.submitFlightsOnly()}
                >
                  {draft.target.kind === "existing"
                    ? t("tripBuilder:review.empty.flightsOnlyExisting", { count: ticked })
                    : t("tripBuilder:review.empty.flightsOnlyNew", { count: ticked })}
                </Button>
              )}
              <Button disabled={running} onClick={cancel}>
                {t("tripBuilder:review.empty.cancel")}
              </Button>
            </div>
          }
        />
      ) : (
        <div
          className="grid items-start lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"
          style={{ gap: "var(--ts-space-xl)" }}
        >
          <ExistingDiffProvider draft={draft} state={state} onEdit={edit}>
            {body}
          </ExistingDiffProvider>
          <aside className="lg:sticky" style={{ top: DETAIL_MAP_STICKY_TOP }}>
            <ReviewMapPreview draft={draft} state={state} />
          </aside>
        </div>
      )}

      <ChangeDatesDialog
        open={changingDates}
        startDay={startDay}
        endDay={endDay}
        onClose={() => setChangingDates(false)}
        onConfirm={(range) => {
          setChangingDates(false);
          rescan(range);
        }}
      />
    </div>
  );
}

/**
 * The review of a photo-built trip (spec §G): follows the scan, shows the draft
 * for editing, and sends it. Nothing is written before the user presses the
 * button; this page only ever reads and edits a draft in memory on the server.
 */
export default function TripBuilderPage(): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const session = useBuilderSession();
  const { phase, commit, state } = session;

  const back = async (): Promise<void> => {
    const unsaved = state !== null && state.edits.length > 0 && commit.kind !== "done";
    if (unsaved) {
      const leave = await confirm({
        message: t("tripBuilder:review.leaveConfirm"),
        confirmText: t("tripBuilder:review.leaveYes"),
        destructive: true,
      });
      if (!leave) return;
    }
    session.leave();
  };
  const goBack = <Button onClick={() => session.leave()}>{t("tripBuilder:review.back")}</Button>;

  // Every phase but the review itself sits under the page's own heading. The
  // review draws a heading of its own (it carries the dates and the buttons),
  // and a page has one h1.
  let heading: JSX.Element | null = <PageHeader title={t("tripBuilder:page.title")} />;
  let content: JSX.Element;
  if (phase.kind === "scanning") {
    const phaseName =
      phase.progress === null ? undefined : TRIP_BUILDER_PHASES[phase.progress.done - 1];
    content = (
      <Message
        kind="pending"
        title={t("tripBuilder:review.scan.title")}
        description={
          phase.progress !== null && phaseName !== undefined
            ? t("tripBuilder:review.scan.step", {
                done: phase.progress.done,
                total: phase.progress.total,
                phase: t(PHASE_KEY[phaseName]),
              })
            : t("tripBuilder:review.scan.running")
        }
      />
    );
  } else if (phase.kind === "scanLost") {
    // The hand-off kept the scan request, so the lost scan can be run again
    // exactly as it was — the same offer the expired draft makes (spec §G).
    content = (
      <Message
        kind="degraded"
        title={t("tripBuilder:review.scan.lost")}
        action={
          <div className="flex flex-wrap justify-center" style={{ gap: "var(--ts-space-md)" }}>
            {session.handoff.scan !== undefined && (
              <Button variant="primary" size="toolbar" onClick={() => void session.scanAgain()}>
                {t("tripBuilder:review.expired.scanAgain")}
              </Button>
            )}
            {goBack}
          </div>
        }
      />
    );
  } else if (phase.kind === "scanFailed") {
    content = (
      <Message
        kind="degraded"
        title={t("tripBuilder:review.scan.failed")}
        description={phase.message}
        action={goBack}
      />
    );
  } else if (phase.kind === "loading") {
    content = <Message kind="pending" title={t("tripBuilder:review.loading")} />;
  } else if (phase.kind === "expired") {
    content = (
      <Message
        title={t("tripBuilder:review.expired.title")}
        description={t(
          phase.canScanAgain
            ? "tripBuilder:review.expired.keeps"
            : "tripBuilder:review.expired.startOver"
        )}
        action={
          phase.canScanAgain ? (
            <Button variant="primary" onClick={() => void session.scanAgain()}>
              {t("tripBuilder:review.expired.scanAgain")}
            </Button>
          ) : (
            goBack
          )
        }
      />
    );
  } else if (phase.kind === "loadFailed") {
    content = (
      <Message kind="degraded" title={t("tripBuilder:review.loadFailed")} action={goBack} />
    );
  } else if (phase.kind === "empty") {
    content = <Message title={t("tripBuilder:review.nothing")} action={goBack} />;
  } else if (commit.kind === "done") {
    content = (
      <SuccessPanel
        result={commit.result}
        retrying={commit.retrying}
        onRetryAlbum={(target) => void session.retryAlbum(target)}
        onOpen={() => navigate(`/trips/${commit.result.tripId}`)}
      />
    );
  } else if (commit.kind === "already") {
    content = (
      <Message
        title={t("tripBuilder:review.already")}
        action={
          commit.tripId !== null ? (
            <Button variant="primary" onClick={() => navigate(`/trips/${commit.tripId}`)}>
              {t("tripBuilder:review.success.open")}
            </Button>
          ) : (
            goBack
          )
        }
      />
    );
  } else if (commit.kind === "unknown") {
    content = (
      <Message
        kind="degraded"
        title={t("tripBuilder:review.unknown")}
        action={
          <Button variant="primary" onClick={() => navigate("/trips")}>
            {t("tripBuilder:review.unknownAction")}
          </Button>
        }
      />
    );
  } else {
    heading = null;
    content = <ReviewScreen session={session} onBack={() => void back()} />;
  }

  return (
    <AppShell width="table">
      {heading}
      {content}
      {confirmDialog}
    </AppShell>
  );
}
