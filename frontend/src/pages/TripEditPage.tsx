import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import CompanionPicker from "../components/CompanionPicker";
import TagInput from "../components/TagInput";
import SuggestionChips from "../components/common/SuggestionChips";
import TripDeleteConfirm from "../components/Trips/TripDeleteConfirm";
import ResyncFromImmich from "../components/Trips/tripBuilder/ResyncFromImmich";
import { offerResync } from "../components/Trips/tripBuilder/offerResync";
import { CoverPreview, Field, fromDateInput, toDateInput } from "../components/Trips/tripFormParts";
import { useTranslation } from "../hooks/useTranslation";
import { useTripEntrySuggestions } from "../hooks/useTripEntrySuggestions";
import { tripsApi } from "../lib/api/trips";
import { formatDate } from "../lib/displayFormat";
import { logger } from "../lib/logger";
import { saveErrorMessage } from "../lib/saveErrorMessage";
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

/**
 * The journey's edit page, `/trips/:id/edit` (spec 2026-10-12 §4): today's
 * `TripModal` fields as page content, in the modal's own four groups, plus the
 * two sections the headers lose — **Re-sync from Immich** (the same launch the
 * journey's header button carries, §K.1) and **Delete** (the existing confirm
 * flow; deleting a journey detaches its trips and never touches the Immich
 * album — the §J rule).
 *
 * The modal stays for the other screens that open it; this page is edit-only,
 * so it has no create path, no Immich build switches and no tabs.
 */
export default function TripEditPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(["trips", "common", "tripBuilder"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [category, setCategory] = useState<TripCategory | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [originLabel, setOriginLabel] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  // Cover is upload-only and buffered until save, exactly as in the modal:
  // `coverUrl` holds the server's current cover, `coverFile`/`coverPreview` a
  // pending pick, `removeCover` an explicit clear.
  const [coverUrl, setCoverUrl] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  // The server refuses a name of only whitespace (schemas/trip.ts): said at the
  // field once a save was tried, instead of a save button greyed out with no
  // word of why — the same rule the modal's form follows.
  const [saveTried, setSaveTried] = useState(false);
  const nameMissing = !name.trim();
  const showNameMissing = saveTried && nameMissing;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const placeSuggestions = useTripEntrySuggestions(trip?.id ?? null);
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
        navigate("/trips");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Seed the form from the loaded journey — the modal seeds the same way.
  useEffect(() => {
    if (!trip) return;
    setName(trip.name);
    setDescription(trip.description ?? "");
    setColor(trip.color);
    setCategory(trip.category ?? "");
    setStartDate(toDateInput(trip.startDate));
    setEndDate(toDateInput(trip.endDate));
    setOriginLabel(trip.originLabel ?? "");
    setDestinationLabel(trip.destinationLabel ?? "");
    setTags(trip.tags);
    setCompanions(trip.companions);
    setNotes(trip.notes ?? "");
    setCoverUrl(trip.coverImageUrl ?? "");
    setCoverFile(null);
    setCoverPreview(null);
    setRemoveCover(false);
  }, [trip]);

  // Release the object URL of a pending pick when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const handlePickCover = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
    setRemoveCover(false);
  };

  const handleRemoveCover = (): void => {
    setCoverFile(null);
    setCoverPreview(null);
    setCoverUrl("");
    setRemoveCover(true);
  };

  // Both inputs are `type="date"`, so their values are YYYY-MM-DD and compare
  // correctly as strings; the server refuses an end before the start, and this
  // says WHICH field is wrong instead of raising a generic save toast.
  const datesOutOfOrder = Boolean(startDate && endDate && endDate < startDate);

  const updateInput = {
    name: name.trim(),
    description: description.trim() || null,
    color,
    category: category === "" ? null : category,
    startDate: fromDateInput(startDate),
    endDate: fromDateInput(endDate),
    originLabel: originLabel.trim() || null,
    destinationLabel: destinationLabel.trim() || null,
    tags,
    companions,
    notes: notes.trim() || null,
    ...(removeCover ? { coverImageUrl: null } : {}),
  };

  const handleSave = async (): Promise<void> => {
    if (!trip) return;
    setSaveTried(true);
    if (nameMissing || datesOutOfOrder) return;
    setSaving(true);
    try {
      // The cover image is never sent as a field — it is uploaded separately
      // below; only an explicit clear travels as `coverImageUrl: null`.
      const savedTrip = await tripsApi.update(trip.id, updateInput);
      if (coverFile) {
        setUploadingCover(true);
        try {
          await tripsApi.uploadCover(savedTrip.id, coverFile);
        } catch {
          addToast("error", t("trips:gallery.uploadError"));
        } finally {
          setUploadingCover(false);
        }
      }
      addToast("success", t("trips:toasts.updated"));
      // A moved date leaves the album and the stations built for the old one;
      // the toast offers the re-sync (§K.1) — the modal makes the same offer.
      offerResync({ trip, tripId: savedTrip.id, startDate, endDate, addToast, t });
      navigate(`/trips/${savedTrip.id}`);
    } catch (err: unknown) {
      addToast("error", saveErrorMessage(err, t, "trips:toasts.updateError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!trip) return;
    try {
      await tripsApi.delete(trip.id);
      addToast("success", t("trips:toasts.deleted"));
      navigate("/trips");
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
        <header>
          <Link to={`/trips/${trip.id}`} className="text-xs text-(--text-muted) hover:underline">
            ← {t("common:buttons.back")}
          </Link>
          <h1 className="t-screen-title mt-1">{t("trips:editTrip")}</h1>
        </header>

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
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
                className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                {uploadingCover
                  ? "…"
                  : coverPreview || coverUrl
                    ? t("trips:modal.coverUploadReplace")
                    : t("trips:modal.coverUploadButton")}
              </button>
              {(coverPreview || coverUrl) && (
                <button
                  type="button"
                  onClick={handleRemoveCover}
                  disabled={uploadingCover}
                  className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                  style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
                >
                  {t("trips:modal.coverRemove")}
                </button>
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

        <div className="flex justify-end gap-2">
          <button
            onClick={() => navigate(`/trips/${trip.id}`)}
            type="button"
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || datesOutOfOrder}
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {saving ? "…" : t("trips:modal.save")}
          </button>
        </div>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("tripBuilder:resync.action")}</h2>
          <p className="text-sm text-(--text-muted) mb-3">{t("tripBuilder:edit.resyncHint")}</p>
          <ResyncFromImmich tripId={trip.id} />
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("tripBuilder:edit.deleteHeading")}</h2>
          <p className="text-sm text-(--text-muted) mb-3">
            {t("tripBuilder:edit.deleteJourneyHint")}
          </p>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            {t("common:buttons.delete")}
          </Button>
        </section>
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
