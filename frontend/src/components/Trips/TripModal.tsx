import { useState } from "react";
import type { Trip, TripCategory } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { TRIP_COLORS as PALETTE } from "../../lib/tripColors";
import Button from "../ui/Button";
import CompanionPicker from "../CompanionPicker";
import TagInput from "../TagInput";
import SuggestionChips from "../common/SuggestionChips";
import { useFormDirty } from "../../hooks/useFormDirty";
import { useTripEntrySuggestions } from "../../hooks/useTripEntrySuggestions";
import { tripEntrySpan } from "../../lib/tripEntrySpan";
import { formatDate } from "../../lib/displayFormat";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { CoverPreview, Field } from "./tripFormParts";
import { useTripForm } from "./useTripForm";
import EditBuildButton from "./tripBuilder/EditBuildButton";
import TripBuilderLauncher from "./tripBuilder/TripBuilderLauncher";
import TripImmichOptions from "./tripBuilder/TripImmichOptions";
import { useImmichBuild } from "./tripBuilder/useImmichBuild";

interface TripModalProps {
  trip: Trip | null; // null = create mode
  /** Create mode only: opens with "Inspect Immich" already on (the chooser's "from photos" route). */
  initialInspect?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: TripCategory[] = ["vacation", "business", "weekend", "family", "other"];

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

type ModalTab = "general" | "people" | "appearance" | "notes";

const TABS: ReadonlyArray<{ id: ModalTab; icon: string }> = [
  { id: "general", icon: "📋" },
  { id: "people", icon: "👥" },
  { id: "appearance", icon: "🎨" },
  { id: "notes", icon: "📝" },
];

export default function TripModal({
  trip,
  initialInspect = false,
  onClose,
  onSaved,
}: TripModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common", "tripBuilder"]);
  const addToast = useToastStore((s) => s.addToast);

  const [tab, setTab] = useState<ModalTab>("general");

  // The form itself — its fields, its seeding, its cover buffer, its refusals,
  // its payloads and its edit-save sequence — is shared with the edit page
  // (`useTripForm`), so the two surfaces of the trip form cannot drift. This
  // modal keeps what the page does not have: the tabs, the create mode and
  // the Immich scan hand-off.
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
    coverFile,
    coverPreview,
    uploadingCover,
    coverInputRef,
    handlePickCover,
    handleRemoveCover,
    saving,
    setSaving,
    nameMissing,
    showNameMissing,
    datesOutOfOrder,
    validate,
    updateInput,
    createInput,
    uploadCoverIfPicked,
    save,
  } = useTripForm(trip);

  // Offered under the two place labels, never written into them: the labels
  // stay the user's free text.
  const placeSuggestions = useTripEntrySuggestions(trip?.id ?? null);
  // Read from the entries the trip detail already carries; a trip from a list
  // endpoint has none, and then there is simply nothing to offer. The offer's
  // number only — the date boxes open at the journey's served effective span
  // (`useTripForm`), never at this.
  const entrySpan = trip ? tripEntrySpan(trip) : null;
  const offerEntrySpan =
    entrySpan !== null && (entrySpan.start !== startDate || entrySpan.end !== endDate);

  // The two Immich switches of a new trip; with one on, Save scans the photos first.
  const build = useImmichBuild(trip === null && initialInspect, startDate, endDate);
  // What Save sends for an existing trip. A change in it, or a picked cover, is an unsaved edit:
  // the Immich trip builder reads the saved trip, so its button waits for a saved form.
  const unsaved = useFormDirty([updateInput, coverFile]);

  const handleSave = async (): Promise<void> => {
    if (!validate()) {
      // The name lives on the first tab; a save tried from another one must
      // still show the reader the field that stopped it.
      if (nameMissing) setTab("general");
      return;
    }

    // An existing trip: the shared edit core (update → cover upload → success
    // toast → the §K.1 re-sync offer).
    if (trip) {
      const savedTrip = await save();
      if (savedTrip) onSaved();
      return;
    }

    setSaving(true);
    try {
      // A switch is on: the photos are scanned and reviewed before the trip is written.
      if (build.scanning) return build.launch(createInput);
      const savedTrip = await tripsApi.create(createInput);
      await uploadCoverIfPicked(savedTrip.id);
      addToast("success", t("trips:toasts.created"));
      onSaved();
    } catch (err: unknown) {
      addToast("error", saveErrorMessage(err, t, "trips:toasts.createError"));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input, var(--bg-base))",
    border: "1px solid var(--color-border)",
    color: "var(--text-primary)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {trip ? t("trips:editTrip") : t("trips:createTrip")}
          </h2>
        </div>

        <div
          className="flex gap-1 px-3 pt-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
          role="tablist"
        >
          {TABS.map((tDef) => {
            const active = tab === tDef.id;
            return (
              <button
                key={tDef.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tDef.id)}
                className="px-3 py-2 text-sm rounded-t-md transition-colors flex items-center gap-1.5"
                style={{
                  background: active ? "var(--bg-surface)" : "transparent",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: active ? 600 : 400,
                  marginBottom: "-1px",
                }}
              >
                <span>{tDef.icon}</span>
                <span>{t(`trips:modalTabs.${tDef.id}`)}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {tab === "general" && (
            <>
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

              {/* #status-from-dates: trip status now derives from linked
                  segment dates (deriveTripStatus) — there is no manual
                  control here, and no "cancelled" concept for trips. */}
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
                  className="-mt-2 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
                >
                  {t("trips:modal.useEntrySpan", {
                    start: formatDate(entrySpan.start, { timeZone: "UTC" }),
                    end: formatDate(entrySpan.end, { timeZone: "UTC" }),
                  })}
                </button>
              )}

              {!trip && <TripImmichOptions build={build} />}
              {trip && <EditBuildButton trip={trip} unsaved={unsaved} onLaunched={onClose} />}

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
            </>
          )}

          {tab === "people" && (
            <>
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
            </>
          )}

          {tab === "appearance" && (
            <>
              <Field label={t("trips:modal.coverLabel")} hidden={build.scanning}>
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
                  {/* Same two controls as the edit page's, so the same two
                      primitives — the journey is edited in two places and a
                      cover button must not change shape between them. Both
                      `secondary`: the form's one amber control is its Save. */}
                  <Button
                    variant="secondary"
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
                    <Button variant="danger" onClick={handleRemoveCover} disabled={uploadingCover}>
                      {t("trips:modal.coverRemove")}
                    </Button>
                  )}
                </div>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  {coverFile && !trip
                    ? t("trips:modal.coverPending")
                    : t("trips:modal.coverUploadReady")}
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
            </>
          )}

          {tab === "notes" && (
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
          )}
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "var(--ts-border)" }}
        >
          {/* The shared recipe, not a fourth copy of it: this footer was
              byte-identical to `TripEditPage`'s — 36px controls, `rounded-lg`,
              `--accent` — and both were wrong in the same way against the
              primitive (46, `--ts-radius-button`, `--ts-accent`). The journey
              is edited in two places, so the two have to draw one row
              (owner, 2026-10-15). */}
          <Button variant="secondary" onClick={onClose}>
            {t("trips:modal.cancel")}
          </Button>
          <Button
            variant="primary"
            size="toolbar"
            onClick={() => void handleSave()}
            disabled={saving || datesOutOfOrder || build.busy}
          >
            {saving ? "…" : build.scanning ? t("tripBuilder:popup.scan") : t("trips:modal.save")}
          </Button>
        </div>
      </div>
      {build.launchProps && <TripBuilderLauncher {...build.launchProps} onClose={onClose} />}
    </div>
  );
}
