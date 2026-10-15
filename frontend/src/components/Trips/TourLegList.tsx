import { useTranslation } from "../../hooks/useTranslation";
import { RowActionButton } from "../table/RowActionButton";
import Button from "../ui/Button";
import SectionHeader from "../ui/SectionHeader";
import {
  LEG_MODES,
  isRoutableLegMode,
  type LegMode,
  type LegSource,
  type TourLeg,
} from "../../types/tour";

/**
 * The sources the MANUAL override endpoint accepts (see `MANUAL_LEG_SOURCES`
 * in `backend/src/schemas/tour.ts`). `routed` is deliberately excluded here —
 * it is never sent through `onSetSource`/the manual override endpoint, only
 * through `onRoute`/the routing endpoint (`POST .../route`). `track` is ALSO
 * excluded: it goes through `onAdoptTrack`/the same override endpoint's
 * discriminated `track` branch, which needs a `trackId` this type has no
 * room for.
 */
type ManualLegSource = "straight" | "drawn";

interface LegSourceOption {
  source: LegSource;
  disabled: boolean;
}

interface Props {
  /** The section's heading. The list draws it itself so "Route the whole
   *  tour" can sit on the same line; the page used to draw an `<h2>` above and
   *  this component drew the button in a row of its own below it. */
  title: string;
  legs: TourLeg[];
  stopTitleById: ReadonlyMap<string, string>;
  /** Whether a routing provider is configured and usable right now — see
   *  `routingAvailable` on `toursApi.get()`. Gates the "routed" option per
   *  leg AND the "route the whole tour" button; "straight"/"drawn" work
   *  regardless. The button used to ignore this, which let the batch run
   *  with no provider: every leg fell back to its straight chord and the
   *  toast still reported them as routed. Found in browser UAT. */
  routingAvailable: boolean;
  onSetSource: (leg: TourLeg, source: ManualLegSource) => void;
  /** Routes ONE leg through the configured provider. Only ever invoked for
   *  a leg whose "routed" option is enabled — never for a disabled or
   *  absent one, since the control itself prevents that selection. */
  onRoute: (leg: TourLeg) => void;
  /**
   * legId -> id of the recorded track that covers it (phase 3b, task 8).
   * Absent for a leg no uploaded track comes within anchor tolerance of —
   * decided on the server (`GET …/legs/track-coverage`). Gates the "track" option the same way
   * `routingAvailable` gates "routed": never offered as usable unless a
   * concrete track id is already known to cover this exact leg, because
   * selecting it with no covering track can only 409.
   */
  trackCoverageByLegId: ReadonlyMap<string, string>;
  /**
   * `useTourTracks`'s own `tracksKnown` — pass it straight through, never
   * recompute it here. An absent `trackCoverageByLegId` entry means "no
   * candidate" in FOUR different situations (see that hook's own doc
   * comment): genuinely no covering track, the list is still loading, the
   * list failed to load, or one track's own geometry fetch failed. Only the
   * first of those is a real "no track covers this leg"; `tracksKnown` is
   * `false` for the other three, so this component only ever renders the
   * definitive hint once coverage has actually been established.
   */
  tracksKnown: boolean;
  /** Adopts the covering track's geometry onto this leg. Only ever invoked
   *  for a leg whose "track" option is enabled, with the trackId this
   *  component already resolved from `trackCoverageByLegId` — never a
   *  caller-guessed one. */
  onAdoptTrack: (leg: TourLeg, trackId: string) => void;
  onClear: (leg: TourLeg) => void;
  /** Routes every routable leg of the section in one call. */
  onRouteAll: () => void;
  /** Disables the "route the whole section" button while a batch request
   *  is in flight, and swaps its label to a busy state. */
  routingAllInProgress?: boolean;
  /** Corrects the leg's MODE, leaving its source and geometry alone (owner
   *  request 2026-10-12 — an inferred ferry that was in fact a road leg).
   *  The editor builds the source-preserving write; this component only
   *  reports the choice. */
  onSetMode: (leg: TourLeg, mode: LegMode) => void;
  /** Id of the leg whose mode write is in flight, if any — that row's mode
   *  control is disabled until the answer lands, the same busy convention
   *  `routingAllInProgress` already follows for the batch button. */
  modeChangeInFlightLegId?: string | null;
}

/**
 * The mode options this leg's `<select>` offers: every `SELECTABLE_LEG_MODES`
 * entry, plus the leg's OWN `rail` when the leg is a rail leg — shown as its
 * current value but disabled, because rail is never hand-selectable (a rail
 * leg belongs to the rail domain; see `SELECTABLE_LEG_MODES`). A rail leg
 * may still be corrected AWAY from rail, which is exactly the inference fix
 * this control exists for; what it must not offer is a rail leg being
 * hand-minted here.
 */
function buildModeOptions(leg: TourLeg): Array<{ mode: LegMode; disabled: boolean }> {
  return LEG_MODES.filter((mode) => mode !== "rail" || leg.mode === "rail").map((mode) => ({
    mode,
    disabled: mode === "rail",
  }));
}

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/**
 * Which sources this leg's `<select>` may offer, and whether each is
 * actually usable right now.
 *
 * "drawn" is offered ONLY when the leg already has a stored line
 * (`leg.waypoints !== null`) — the "keep the line I have, or revert to
 * straight" case, which always succeeds. A leg with no line yet has no way
 * to become "drawn" from this page (no line-drawing tool exists — Phase 3),
 * so it is left out entirely rather than offered disabled.
 *
 * "routed" is offered ONLY for a routable mode (`isRoutableLegMode`) — a
 * ferry or rail leg never shows it at all, because no provider can
 * meaningfully answer either (see `isRoutableLegMode`'s own doc comment).
 * When the mode IS routable but no provider is configured
 * (`!routingAvailable`), the option is still shown but DISABLED, with the
 * reason surfaced as a hint below the select — never silently omitted,
 * so a traveller who wants routing knows it exists and why it does not
 * work yet, rather than wondering if the feature is missing.
 *
 * Fix round 1 of Task 14 already established the rule this follows: a
 * control whose only possible outcome is an error is a broken control, not
 * an honest one. Task 7 extends the same rule to "routed" — never offer it
 * where selecting it can only 409. Phase 3b's task 8 extends it a second
 * time to "track": always shown (any leg mode may have been recorded, not
 * only a routable one — unlike "routed" this has no mode restriction), but
 * disabled unless `coveringTrackId` is already known, exactly the same
 * shape.
 */
function buildOptions(
  leg: TourLeg,
  routingAvailable: boolean,
  coveringTrackId: string | undefined
): LegSourceOption[] {
  const hasLine = leg.waypoints !== null && leg.waypoints.length >= 2;
  const options: LegSourceOption[] = [{ source: "straight", disabled: false }];
  if (hasLine) {
    options.push({ source: "drawn", disabled: false });
  }
  if (isRoutableLegMode(leg.mode)) {
    options.push({ source: "routed", disabled: !routingAvailable });
  }
  options.push({ source: "track", disabled: coveringTrackId === undefined });
  return options;
}

/**
 * One row per leg between two consecutive route stops, plus a header
 * action to route every routable leg of the section at once.
 */
export default function TourLegList({
  title,
  legs,
  stopTitleById,
  routingAvailable,
  onSetSource,
  onRoute,
  trackCoverageByLegId,
  tracksKnown,
  onAdoptTrack,
  onClear,
  onRouteAll,
  routingAllInProgress = false,
  onSetMode,
  modeChangeInFlightLegId = null,
}: Props): JSX.Element {
  const { t } = useTranslation();

  // Above the early return: the heading belongs to the section, not to the
  // legs, so a tour that has none yet still shows what the section is.
  const header = (
    <SectionHeader
      title={title}
      actions={
        legs.length > 0 ? (
          <Button
            variant="secondary"
            size="toolbar"
            disabled={routingAllInProgress || !routingAvailable}
            title={routingAvailable ? undefined : t("trips:tours.routing.unavailableReason")}
            onClick={onRouteAll}
          >
            {routingAllInProgress
              ? t("trips:tours.routing.routingAll")
              : t("trips:tours.routing.routeAll")}
          </Button>
        ) : undefined
      }
    />
  );

  if (legs.length === 0) {
    return (
      <div>
        {header}
        <p className="text-sm text-(--text-muted)">{t("trips:tours.noLegs")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      <ul className="space-y-2">
        {legs.map((leg) => {
          const hasLine = leg.waypoints !== null && leg.waypoints.length >= 2;
          const isRoutable = isRoutableLegMode(leg.mode);
          const coveringTrackId = trackCoverageByLegId.get(leg.id);
          const options = buildOptions(leg, routingAvailable, coveringTrackId);
          const enabledCount = options.filter((o) => !o.disabled).length;
          return (
            <li
              key={leg.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) p-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {stopTitleById.get(leg.fromStopId) ?? "?"} →{" "}
                {stopTitleById.get(leg.toStopId) ?? "?"}
              </span>
              {/* Where the mode badge used to sit, now the correction (owner
                  request 2026-10-12): it reads as a badge, but a wrong
                  inference ("not ferry, a roadtrip") is one change away. */}
              <select
                value={leg.mode}
                disabled={modeChangeInFlightLegId === leg.id}
                onChange={(e) => onSetMode(leg, e.target.value as LegMode)}
                aria-label={t("trips:tours.modeLabel")}
                className="rounded-sm border border-(--color-border) bg-(--bg-surface) px-1.5 py-0.5 text-xs disabled:opacity-40"
              >
                {buildModeOptions(leg).map((option) => (
                  <option key={option.mode} value={option.mode} disabled={option.disabled}>
                    {t(`trips:tours.mode.${option.mode}`)}
                  </option>
                ))}
              </select>
              <span className="text-(--text-muted)">{formatKm(leg.distanceKm)} km</span>
              <select
                value={leg.source}
                disabled={enabledCount < 2}
                onChange={(e) => {
                  const value = e.target.value as LegSource;
                  if (value === "routed") {
                    onRoute(leg);
                  } else if (value === "track") {
                    // The option is disabled whenever `coveringTrackId` is
                    // `undefined` (see `buildOptions`), so a `<select>`
                    // change event can only carry this value when it is
                    // defined — but the guard stays here rather than
                    // asserting, so a future bug in that gating logs a
                    // silent no-op instead of adopting a track that was
                    // never actually confirmed to cover this leg.
                    if (coveringTrackId !== undefined) onAdoptTrack(leg, coveringTrackId);
                  } else {
                    onSetSource(leg, value as ManualLegSource);
                  }
                }}
                className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:min-h-(--ts-size-touch-min)"
              >
                {options.map((option) => (
                  <option key={option.source} value={option.source} disabled={option.disabled}>
                    {t(`trips:tours.source.${option.source}`)}
                  </option>
                ))}
              </select>
              {!hasLine && (
                <span className="text-xs text-(--text-muted)">{t("trips:tours.noLineYet")}</span>
              )}
              {isRoutable && !routingAvailable && (
                <span className="text-xs text-(--text-muted)">
                  {t("trips:tours.routing.unavailableReason")}
                </span>
              )}
              {coveringTrackId === undefined && tracksKnown && leg.source !== "track" && (
                <span className="text-xs text-(--text-muted)">
                  {t("trips:tours.tracks.noCoverageReason")}
                </span>
              )}
              {/* `ml-auto`: the row wraps, and a lone icon on a line of its own
                  would otherwise sit at the start, not at the row's end. */}
              <span className="ml-auto">
                <RowActionButton
                  icon="clear"
                  label={t("trips:tours.clearLeg")}
                  disabled={leg.source === "straight"}
                  onClick={() => onClear(leg)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
