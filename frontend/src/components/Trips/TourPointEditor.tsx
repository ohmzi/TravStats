import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import FormFooter from "../ui/FormFooter";
import { LocationInput } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";
import type { TourPointInput } from "../../lib/api/tours";

interface TourPointEditorProps {
  points: TourPointInput[];
  saving: boolean;
  onSave: (points: TourPointInput[]) => void;
  /** Why the last save was refused, already worded — shown beside the button. */
  error?: string | null;
}

/**
 * The point list of a tour that belongs to no trip.
 *
 * A section of a TRIP picks its vertices from that trip's timeline
 * (`TourStopAssigner`). A standalone tour has no timeline to pick from, so
 * its points are found here — by place search, a click on the map or a pasted
 * coordinate (all three live in `LocationInput`), never by typing two bare
 * numbers. A search hit names an unnamed point, so "Gjendesheim" is one pick.
 *
 * Everything is edited locally and written in ONE call: the endpoint
 * replaces the whole list (added, moved, removed, renumbered) in a single
 * transaction, and saving per row would make a half-edited tour a state
 * the server can be left in. An existing point keeps its `id` across a
 * reorder, which is what lets its legs survive — legs are keyed by their
 * endpoint stops, never by position.
 */
export default function TourPointEditor({
  points,
  saving,
  onSave,
  error = null,
}: TourPointEditorProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const [draft, setDraft] = useState<TourPointInput[]>(points);

  const update = (index: number, patch: Partial<TourPointInput>): void => {
    setDraft((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // A point with no coordinate produces no leg and no kilometre, and the
  // server refuses it — so the form refuses it first, rather than letting
  // the reader type a whole list and meet one error for all of it.
  // A route correction needs its point but no name (tester 2026-09-26).
  const incomplete = draft.some(
    (p) => (p.via !== true && p.title.trim() === "") || !isFinite(p.lat) || !isFinite(p.lon)
  );

  /**
   * The list as the endpoint takes it. `hasNight` is the SERVER's answer to
   * "would a correction here delete a night" — the form shows it and never
   * writes it back, so the save payload is the same one it was before the
   * flag existed. The whole list is sent, night-carrying rows included.
   */
  const wirePoints = (points: TourPointInput[]): TourPointInput[] =>
    points.map(({ hasNight: _hasNight, ...point }) => point);

  return (
    <div className="space-y-2">
      {draft.length === 0 && (
        <p className="text-sm text-(--text-muted)">{t("trips:tours.points.empty")}</p>
      )}

      <ul className="space-y-2">
        {draft.map((point, index) => (
          <li
            key={point.id ?? `new-${index}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-(--color-border) p-2"
          >
            <span className="w-6 text-center text-xs text-(--text-muted)">{index + 1}</span>
            <input
              type="text"
              value={point.title}
              onChange={(e) => update(index, { title: e.target.value })}
              placeholder={t("trips:tours.points.titlePlaceholder")}
              aria-label={t("trips:tours.points.titlePlaceholder")}
              className="min-w-40 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={t("trips:tours.points.moveUp")}
              className="px-1 text-sm disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === draft.length - 1}
              aria-label={t("trips:tours.points.moveDown")}
              className="px-1 text-sm disabled:opacity-30"
            >
              ↓
            </button>
            {/* One body size per row: the title input and the arrows draw
                `text-sm`, so the remove link does too — at `text-xs` it was
                the row's smallest control (owner, 2026-10-13: "text size
                should be uniform"). */}
            <button
              type="button"
              onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              className="text-sm underline"
            >
              {t("trips:tours.points.remove")}
            </button>
            {/* A station with a night cannot become a correction here — the
                server refuses it (`VIA_POINT_HAS_NIGHT`) because this editor
                knows no nights and would delete one unseen. So the switch is
                disabled where the reader is about to flip it, and shows the
                same sentence a refused save would (owner report
                2026-10-12). The night itself is cleared on the trip page's
                station editor; the server rule stays the floor for what the
                form cannot know (a night added while this page is open). */}
            {/* The switch's label draws the row's body size too — the shared
                `ui/Field` switch labels at 14/600 — keeping its muted colour
                and its hint suffix. */}
            <label
              className="flex basis-full items-center gap-2 text-sm text-(--text-muted)"
              title={t(
                point.hasNight === true
                  ? "trips:tours.points.saveErrorViaNight"
                  : "trips:tours.points.viaHint"
              )}
            >
              <input
                type="checkbox"
                role="switch"
                aria-checked={point.via === true}
                aria-label={t("trips:tours.points.via")}
                checked={point.via === true}
                disabled={point.hasNight === true}
                onChange={(e) => update(index, { via: e.target.checked })}
              />
              <span>{t("trips:tours.points.via")}</span>
              {point.hasNight === true ? (
                <span>— {t("trips:tours.points.saveErrorViaNight")}</span>
              ) : (
                point.via === true && <span>— {t("trips:tours.points.viaHint")}</span>
              )}
            </label>
            <div className="basis-full">
              <LocationInput
                compact
                idPrefix={`tour-point-${index}`}
                value={
                  Number.isFinite(point.lat) && Number.isFinite(point.lon)
                    ? { lat: point.lat, lon: point.lon }
                    : null
                }
                onChange={(sel) =>
                  update(index, {
                    lat: sel.lat,
                    lon: sel.lon,
                    // A correction stays nameless unless the reader types one.
                    title:
                      point.title.trim() === "" && sel.name && point.via !== true
                        ? sel.name
                        : point.title,
                  })
                }
              />
            </div>
          </li>
        ))}
      </ul>

      {/* On a phone the row is pinned to the bottom edge, the journey edit
          page's Save row's own treatment (owner report 2026-10-12): the
          points sit under a 540px map, so the Save was further below the fold
          than the row it saves — unreachable from the first point being
          edited. `sticky bottom-0` holds it in reach while its own place is
          below the fold; the surface, the top border and the safe-area pad
          let the list scroll under it and keep it off a home bar. A desktop
          keeps the row in the flow. */}
      {/* The shared footer (`ui/FormFooter`), left-aligned because this row
          reads forward: "Add point" adds, "Save points" commits. It was a hand
          -rolled pair until 2026-10-15 — 36px tall and 8px round against the
          primitive's 46 and 12, and the label in `text-white` where the design
          says `--ts-accent-text` — which is the drift the owner photographed:
          "Save points" beside this page's own "Save dates", two recipes for
          one row. The phone behaviour it replaces is kept: pinned to the
          bottom edge with the safe-area pad, so the Save is reachable from the
          first point being edited. */}
      <FormFooter
        align="start"
        hint={
          <>
            {incomplete && (
              <span className="text-xs" style={{ color: "var(--warning)" }}>
                {t("trips:tours.points.incomplete")}
              </span>
            )}
            {error && (
              <span role="alert" className="text-xs" style={{ color: "var(--danger)" }}>
                {error}
              </span>
            )}
          </>
        }
      >
        <Button
          variant="secondary"
          onClick={() => setDraft((prev) => [...prev, { title: "", lat: NaN, lon: NaN }])}
        >
          {t("trips:tours.points.add")}
        </Button>
        <Button
          variant="primary"
          size="toolbar"
          disabled={saving || incomplete}
          onClick={() => onSave(wirePoints(draft))}
        >
          {t("trips:tours.points.save")}
        </Button>
      </FormFooter>
    </div>
  );
}
