import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { tripsApi } from "../../lib/api";
import type { CreateTripInput, UpdateTripInput } from "../../lib/api/trips";
import { tripEnd, tripStart } from "../../lib/entityTimes";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { TRIP_COLORS as PALETTE } from "../../lib/tripColors";
import { useToastStore } from "../../store/toastStore";
import type { Trip, TripCategory } from "../../types";
import { offerResync } from "./tripBuilder/offerResync";
import { fromDateInput } from "./tripFormParts";

/**
 * The journey form's core, shared by its two surfaces — the modal
 * (`TripModal`) and the edit page (`pages/TripEditPage`). They are the same
 * form for the same entity, so the state, the seeding from the loaded trip,
 * the cover buffer, the two refusals, the payloads and the save sequence
 * (update → cover upload → success toast → the §K.1 re-sync offer) live here
 * once and neither copy can drift.
 *
 * The modal's create mode reads the same state and `createInput`, and wraps
 * its own write in the Immich-scan hand-off; the page owns loading and Delete.
 *
 * The date boxes open at the journey's EFFECTIVE span exactly as the server
 * serves it (`services/trips/journeySpan.ts` on the DTO: a stored day on its
 * own side, the entries' days — flights, cruises, stays — answering the rest),
 * read here through `tripStart`/`tripEnd` (`lib/entityTimes`), the same reader
 * the journey's cards and its Dates cell use. `times` (ADR 0002) is the
 * carrier that matters: a stored day can live in `startDay` alone, with the
 * legacy anchor null. This core does NOT derive a span of its own — the
 * entries' span is computed per surface for its "Use the span of the entries"
 * offer only, and it never seeds a box, so only the served answer fills them.
 */
export interface TripForm {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  color: string;
  setColor: (value: string) => void;
  category: TripCategory | "";
  setCategory: (value: TripCategory | "") => void;
  startDate: string;
  setStartDate: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
  originLabel: string;
  setOriginLabel: (value: string) => void;
  destinationLabel: string;
  setDestinationLabel: (value: string) => void;
  tags: string[];
  setTags: (value: string[]) => void;
  companions: string[];
  setCompanions: (value: string[]) => void;
  notes: string;
  setNotes: (value: string) => void;
  /** The server's cover; `coverPreview` is a pending local pick, `coverFile` its file. */
  coverUrl: string;
  coverFile: File | null;
  coverPreview: string | null;
  uploadingCover: boolean;
  coverInputRef: RefObject<HTMLInputElement | null>;
  handlePickCover: (e: ChangeEvent<HTMLInputElement>) => void;
  handleRemoveCover: () => void;
  saving: boolean;
  /** The create path keeps its own write; this is the one mutator it needs. */
  setSaving: (value: boolean) => void;
  nameMissing: boolean;
  showNameMissing: boolean;
  datesOutOfOrder: boolean;
  /** Marks a save tried (so its refusals show at the field); false while one stands. */
  validate: () => boolean;
  /** What an edit PATCHes — `null` clears a nullable field (see `lib/api/trips`). */
  updateInput: UpdateTripInput;
  /** What a create POSTs: the same fields, but `undefined` where PATCH clears. */
  createInput: CreateTripInput;
  /** Uploads a buffered pick against an id the caller just wrote; a failure only toasts. */
  uploadCoverIfPicked: (tripId: string) => Promise<void>;
  /** The edit save core. Null when the form was refused or the write failed. */
  save: () => Promise<Trip | null>;
}

export function useTripForm(trip: Trip | null): TripForm {
  const { t } = useTranslation(["trips", "tripBuilder"]);
  const addToast = useToastStore((s) => s.addToast);

  const [name, setName] = useState(trip?.name ?? "");
  const [description, setDescription] = useState(trip?.description ?? "");
  const [color, setColor] = useState(trip?.color ?? PALETTE[0]);
  const [category, setCategory] = useState<TripCategory | "">(trip?.category ?? "");
  // The dates open at the journey's EFFECTIVE span, the one answer the server
  // serves (owner report 2026-10-12: "after changing date theres no way to
  // save" — the boxes opened EMPTY for a journey with no stored days though
  // its flights gave a span). `tripStart`/`tripEnd` read it where every other
  // surface does, `times` first. A box the reader CLEARS hands that side back:
  // its empty day travels as null, never as the day it opened with, and
  // nothing re-derives it while the trip stands.
  const [startDate, setStartDate] = useState(trip ? (tripStart(trip)?.date ?? "") : "");
  const [endDate, setEndDate] = useState(trip ? (tripEnd(trip)?.date ?? "") : "");
  const [originLabel, setOriginLabel] = useState(trip?.originLabel ?? "");
  const [destinationLabel, setDestinationLabel] = useState(trip?.destinationLabel ?? "");
  const [tags, setTags] = useState<string[]>(trip?.tags ?? []);
  const [companions, setCompanions] = useState<string[]>(trip?.companions ?? []);
  const [notes, setNotes] = useState(trip?.notes ?? "");
  // Cover is upload-only. The chosen file is buffered and uploaded on save,
  // so it also works while creating a brand-new trip (before an id exists).
  // `coverUrl` holds the existing server cover; `coverFile`/`coverPreview`
  // hold a pending local pick; `removeCover` marks an explicit clear.
  const [coverUrl, setCoverUrl] = useState(trip?.coverImageUrl ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // The server refuses a name of only whitespace (schemas/trip.ts). Said at
  // the field once a save was tried, instead of a save button greyed out
  // with no word of why.
  const [saveTried, setSaveTried] = useState(false);

  // Seed the form from the loaded trip — the page loads it after the first
  // render; the modal hands it in already loaded, and this repeats its values.
  // The dates take the same served-span read as the initial state.
  useEffect(() => {
    if (!trip) return;
    setName(trip.name);
    setDescription(trip.description ?? "");
    setColor(trip.color);
    setCategory(trip.category ?? "");
    setStartDate(tripStart(trip)?.date ?? "");
    setEndDate(tripEnd(trip)?.date ?? "");
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

  const handlePickCover = (e: ChangeEvent<HTMLInputElement>): void => {
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

  const nameMissing = !name.trim();
  const showNameMissing = saveTried && nameMissing;

  // Both inputs are `type="date"`, so their values are YYYY-MM-DD and compare
  // correctly as strings. The server refuses an end before the start
  // (SRV-TRIP-DATE-001), and this says WHICH field is wrong instead of raising
  // a generic save toast.
  const datesOutOfOrder = Boolean(startDate && endDate && endDate < startDate);

  // Save is refused on either, and the refusal is shown once a save was tried.
  const validate = (): boolean => {
    setSaveTried(true);
    return !nameMissing && !datesOutOfOrder;
  };

  // The cover image is never sent as a field — it is uploaded separately in
  // `uploadCoverIfPicked`; only an explicit clear travels as
  // `coverImageUrl: null`.
  const updateInput: UpdateTripInput = {
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

  const createInput: CreateTripInput = {
    name: name.trim(),
    description: description.trim() || undefined,
    color,
    category: category === "" ? undefined : category,
    startDate: fromDateInput(startDate) ?? undefined,
    endDate: fromDateInput(endDate) ?? undefined,
    originLabel: originLabel.trim() || undefined,
    destinationLabel: destinationLabel.trim() || undefined,
    tags,
    companions,
    notes: notes.trim() || undefined,
  };

  // Upload a freshly picked cover against a trip id the caller just wrote. A
  // failure here must not lose the saved trip data — it surfaces a
  // cover-specific error and the save stands.
  const uploadCoverIfPicked = async (tripId: string): Promise<void> => {
    if (!coverFile) return;
    setUploadingCover(true);
    try {
      await tripsApi.uploadCover(tripId, coverFile);
    } catch {
      addToast("error", t("trips:gallery.uploadError"));
    } finally {
      setUploadingCover(false);
    }
  };

  /**
   * The edit save: refuse the invalid form, update the trip, upload the
   * buffered cover, say it was saved, and offer the §K.1 re-sync when the
   * dates moved. Null when the form was refused or the write failed.
   */
  const save = async (): Promise<Trip | null> => {
    if (!trip) return null;
    if (!validate()) return null;
    setSaving(true);
    try {
      const savedTrip = await tripsApi.update(trip.id, updateInput);
      await uploadCoverIfPicked(savedTrip.id);
      addToast("success", t("trips:toasts.updated"));
      // A moved date leaves the album and the stations built for the old one;
      // the toast offers the re-sync (§K.1).
      offerResync({ trip, tripId: savedTrip.id, startDate, endDate, addToast, t });
      return savedTrip;
    } catch (err: unknown) {
      addToast("error", saveErrorMessage(err, t, "trips:toasts.updateError"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  return {
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
  };
}
