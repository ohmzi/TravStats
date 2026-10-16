import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import FormFooter from "../components/ui/FormFooter";
import PageHeader from "../components/ui/PageHeader";
import CompanionPicker from "../components/CompanionPicker";
import TagInput from "../components/TagInput";
import SuggestionChips from "../components/common/SuggestionChips";
import TripDeleteConfirm from "../components/Trips/TripDeleteConfirm";
import ResyncFromImmich from "../components/Trips/tripBuilder/ResyncFromImmich";
import { CoverPreview, Field } from "../components/Trips/tripFormParts";
import { useTripForm } from "../components/Trips/useTripForm";
import { useTranslation } from "../hooks/useTranslation";
import { useTripEntrySuggestions } from "../hooks/useTripEntrySuggestions";
import { tripsApi } from "../lib/api/trips";
import { formatDate } from "../lib/displayFormat";
import { logger } from "../lib/logger";
import { TRIP_COLORS as PALETTE } from "../lib/tripColors";
import { tripEntrySpan } from "../lib/tripEntrySpan";
import { useToastStore } from "../store/toastStore";
import type { Trip, TripCategory } from "../types";

const CATEGORIES: TripCategory[] = ["vacation", "business", "weekend", "family", "other"];

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

export type TripEditContext = "journey" | "flightTrip";

/**
 * Where the page was opened from decides its title, where it lands, and
 * nothing else. A flight trip IS a journey — `/flights/journeys/:id` is the
 * flight-centred view of the same row — but the owner reads it as its own
 * thing and asked for its popup to become "an edit page", not to be sent to
 * the journey's (2026-10-15). So the same form, the same `useTripForm`, with
 * the flight trip's name and its own way home.
 *
 * "Where it lands" is three targets rather than one, which is what the
 * `home`/`list` pair is for: `home` takes Back, Cancel and Save (the flight
 * trip), `list` takes a delete and a failed load (the flight logbook). Re-sync
 * is neither — it opens the journey's own `/trips/:id/resync` in both
 * contexts, since that page is the Immich flow's and the journey links to it
 * too. Reading the pair as "every exit" was wrong; the flight-trip page's
 * "Re-sync" left it for the journey.
 */
const CONTEXTS: Record<
  TripEditContext,
  { titleKey: string; home: (id: string) => string; list: string }
> = {
  journey: { titleKey: "trips:editTrip", home: (id) => `/trips/${id}`, list: "/trips" },
  flightTrip: {
    titleKey: "trips:editFlightTrip",
    home: (id) => `/flights/journeys/${id}`,
    list: "/flights",
  },
};

/**
 * The journey's edit page, `/trips/:id/edit` (spec 2026-10-12 §4): today's
 * `TripModal` fields as page content, in the modal's own four groups, plus
 * **Re-sync from Immich** (the same launch the journey's header button carries,
 * §K.1) and **Delete** (the existing confirm flow; deleting a journey detaches
 * its trips and never touches the Immich album — the §J rule) in its header,
 * and — in the `flightTrip` context — the flight trip's own title and exits
 * (see `CONTEXTS`).
 *
 * The form itself — its fields, its refusals, its payload and its save
 * sequence — is `useTripForm`, the same core `TripModal` renders, so the two
 * edit surfaces cannot drift. This page adds what the modal cannot: loading a
 * journey by id, the page chrome, and the delete confirm.
 */
export default function TripEditPage({
  context = "journey",
}: { context?: TripEditContext } = {}): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(["trips", "common", "tripBuilder"]);
  const navigate = useNavigate();
  const where = CONTEXTS[context];
  const addToast = useToastStore((s) => s.addToast);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    name,
    setName,
    description,
    setDescription,
    color,
    setColor,
    category,
    setCategory,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    originLabel,
    setOriginLabel,
    destinationLabel,
    setDestinationLabel,
    tags,
    setTags,
    companions,
    setCompanions,
    notes,
    setNotes,
    coverUrl,
    coverPreview,
    uploadingCover,
    coverInputRef,
    handlePickCover,
    handleRemoveCover,
    saving,
    nameMissing,
    showNameMissing,
    datesOutOfOrder,
    save,
  } = useTripForm(trip);

  const placeSuggestions = useTripEntrySuggestions(trip?.id ?? null);
  // The span the journey's visible entries cover — the number the "Use the
  // span of the entries" offer below shows and copies in. NOT a seeding rule:
  // the date boxes open at the journey's served effective span (`useTripForm`
  // reads it through `tripStart`/`tripEnd`), so the two can never disagree
  // about what the boxes hold.
  const entrySpan = trip ? tripEntrySpan(trip) : null;
  const offerEntrySpan =
    entrySpan !== null && (entrySpan.start !== startDate || entrySpan.end !== endDate);

  useEffect(() => {
    if (!id) return;
    void (async (): Promise<void> => {
      try {
        setTrip(await tripsApi.getById(id));
      } catch (err: unknown) {
        logger.warn("TripEditPage: failed to load the trip", err);
        addToast("error", t("trips:toasts.loadError"));
        navigate(where.list);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSave = async (): Promise<void> => {
    const savedTrip = await save();
    if (savedTrip) navigate(where.home(savedTrip.id));
  };

  const handleDelete = async (): Promise<void> => {
    if (!trip) return;
    try {
      await tripsApi.delete(trip.id);
      addToast("success", t("trips:toasts.deleted"));
      navigate(where.list);
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
      setConfirmDelete(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input, var(--bg-base))",
    border: "1px solid var(--color-border)",
    color: "var(--text-primary)",
  };

  if (loading || !trip) {
    return (
      <AppShell width="list">
        <div className="flex items-center justify-center py-20 text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="reading">
      <div className="space-y-6">
        <div>
          <BackLink to={where.home(trip.id)}>{t("common:buttons.back")}</BackLink>
          {/* The page's own actions on the title's line, at the right edge
              (owner, 2026-10-15: "the resync from immich button should be
              next to the title but all the way right of screen rather than
              below it. same goes for delete too"). Black before red. What a
              delete takes and what survives is said by the confirm dialog it
              opens (`TripDeleteConfirm`), where the decision is made. */}
          <PageHeader
            title={t(where.titleKey)}
            actions={
              <>
                <ResyncFromImmich tripId={trip.id} title={t("tripBuilder:edit.resyncHint")} />
                <Button variant="danger" size="toolbar" onClick={() => setConfirmDelete(true)}>
                  {t("common:buttons.delete")}
                </Button>
              </>
            }
          />
        </div>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("trips:modalTabs.general")}</h2>

          <Field label={t("trips:modal.nameLabel")}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("trips:modal.namePlaceholder")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
              aria-invalid={showNameMissing || undefined}
              aria-describedby={showNameMissing ? "trip-name-error" : undefined}
            />
            {showNameMissing && (
              <p id="trip-name-error" role="alert" className="mt-1 text-[11px] text-(--danger)">
                {t("trips:modal.nameRequired")}
              </p>
            )}
          </Field>

          {/* #status-from-dates: trip status derives from linked segment dates
              (deriveTripStatus) — there is no manual control here. */}
          <Field label={t("trips:modal.categoryLabel")}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TripCategory | "")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            >
              <option value="">—</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_ICON[c]} {t(`trips:category.${c}`)}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("trips:modal.startDateLabel")}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
            <Field label={t("trips:modal.endDateLabel")}>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
                aria-invalid={datesOutOfOrder}
              />
              {datesOutOfOrder && (
                <p className="text-[11px] mt-1" style={{ color: "var(--color-danger)" }}>
                  {t("trips:modal.endBeforeStart")}
                </p>
              )}
            </Field>
          </div>
          {offerEntrySpan && entrySpan && (
            <button
              type="button"
              onClick={() => {
                setStartDate(entrySpan.start);
                setEndDate(entrySpan.end);
              }}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
            >
              {t("trips:modal.useEntrySpan", {
                start: formatDate(entrySpan.start, { timeZone: "UTC" }),
                end: formatDate(entrySpan.end, { timeZone: "UTC" }),
              })}
            </button>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("trips:modal.originLabel")}>
              <input
                value={originLabel}
                onChange={(e) => setOriginLabel(e.target.value)}
                placeholder="München"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
              <SuggestionChips
                value={originLabel}
                suggestions={placeSuggestions.origins}
                onPick={setOriginLabel}
                fieldLabel={t("trips:modal.originLabel")}
              />
            </Field>
            <Field label={t("trips:modal.destinationLabel")}>
              <input
                value={destinationLabel}
                onChange={(e) => setDestinationLabel(e.target.value)}
                placeholder="Tokyo, Japan"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
              <SuggestionChips
                value={destinationLabel}
                suggestions={placeSuggestions.destinations}
                onPick={setDestinationLabel}
                fieldLabel={t("trips:modal.destinationLabel")}
              />
            </Field>
          </div>

          <Field label={t("trips:modal.descLabel")} hint={t("trips:modal.descHint")}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("trips:modal.descPlaceholder")}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none"
              style={inputStyle}
            />
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("trips:modalTabs.people")}</h2>

          <Field label={t("trips:modal.companionsLabel")}>
            <CompanionPicker value={companions} onChange={setCompanions} />
          </Field>

          <Field label={t("trips:modal.tagsLabel")}>
            <TagInput
              value={tags}
              onChange={setTags}
              ariaLabel={t("trips:modal.tagsLabel")}
              placeholder="kultur, food, fotos"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
              accent={color}
            />
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("trips:modalTabs.appearance")}</h2>

          <Field label={t("trips:modal.coverLabel")}>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handlePickCover}
            />
            <CoverPreview
              url={coverPreview ?? coverUrl}
              accent={color}
              title={name || "—"}
              onClick={() => coverInputRef.current?.click()}
            />
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {/* Ends right like every action row. Black for the upload, red
                  for the remove — remove is a delete (owner, 2026-10-15:
                  "delete red and others black"). */}
              <Button
                variant="secondary"
                size="toolbar"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
              >
                {uploadingCover
                  ? "…"
                  : coverPreview || coverUrl
                    ? t("trips:modal.coverUploadReplace")
                    : t("trips:modal.coverUploadButton")}
              </Button>
              {(coverPreview || coverUrl) && (
                <Button
                  variant="danger"
                  size="toolbar"
                  onClick={handleRemoveCover}
                  disabled={uploadingCover}
                >
                  {t("trips:modal.coverRemove")}
                </Button>
              )}
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
              {t("trips:modal.coverUploadReady")}
            </p>
          </Field>

          <Field label={t("trips:modal.colorLabel")}>
            <div className="flex gap-2 flex-wrap">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  aria-pressed={color === c}
                  type="button"
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                />
              ))}
            </div>
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("trips:modalTabs.notes")}</h2>

          <Field label={t("trips:modal.notesLabel")} hint={t("trips:modal.notesMarkdownHint")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("trips:modal.notesPlaceholder")}
              rows={14}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
              style={inputStyle}
            />
          </Field>
        </section>

        {/* The shared edit-form footer (`ui/FormFooter`): the same row, the
            same two controls and the same 46px recipe that the roadtrip and
            the points editor draw. It keeps the phone behaviour this page grew
            on 2026-10-12 — pinned to the bottom edge, above the safe area — and
            it is the reason the numbers are no longer written out here by hand
            (owner, 2026-10-15: "the save button in edit mode aren't in same
            location or design"). */}
        <FormFooter
          hint={
            // The button's own refusal, said where the button is: a disabled
            // Save that only greys out leaves the field's small hint as the
            // sole explanation, and that hint reads as unrelated (owner,
            // 2026-10-12: "the update button is disabled and no mention of
            // whats the reason"). The field-level hints stay where they are.
            !saving && (datesOutOfOrder || nameMissing) ? (
              <p role="alert" className="text-[11px] text-(--danger)">
                {t(datesOutOfOrder ? "trips:modal.endBeforeStart" : "trips:modal.nameRequired")}
              </p>
            ) : null
          }
        >
          <Button variant="secondary" onClick={() => navigate(where.home(trip.id))}>
            {t("trips:modal.cancel")}
          </Button>
          <Button
            variant="primary"
            size="toolbar"
            onClick={() => void handleSave()}
            disabled={saving || datesOutOfOrder}
          >
            {saving ? "…" : t("trips:modal.save")}
          </Button>
        </FormFooter>
      </div>

      {/* The existing confirm, unchanged: what a deleted journey takes with it
          and what survives (the §J rule — its trips are detached, never
          deleted, and the Immich album is not touched). */}
      <TripDeleteConfirm
        isOpen={confirmDelete}
        tripId={trip.id}
        tripName={trip.name}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </AppShell>
  );
}
