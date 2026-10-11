/**
 * Everything the review page remembers (spec §A, §G): the scan job it follows,
 * the draft it loads, the user's edits (kept in sessionStorage, so a reload
 * resumes), the commit it sends, and what each of those ended in. The page
 * only draws what this returns.
 *
 * The URL is the state machine's input: `?job=<id>` follows a scan and then
 * replaces itself with `?draft=<id>`; `?draft=<id>` loads the draft and puts
 * the stored edits back by the stable station keys.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { JobLostError, waitForJob, type JobView } from "../lib/api/jobs";
import { tripBuilderApi } from "../lib/api/tripBuilder";
import {
  applyEdit,
  buildCommitBody,
  initialReviewState,
  reapplyEdits,
  type DraftEdit,
  type ReviewState,
} from "../lib/tripBuilder/draftEdits";
import {
  alreadyCommittedTripId,
  commitFailureKey,
  commitNeedsRescan,
  rateLimitOf,
  scanFailureKey,
  scanStartFailureKey,
} from "../lib/tripBuilder/errors";
import { keepEverything } from "../lib/tripBuilder/existingReview";
import { scanBodyFor, startRescan } from "../lib/tripBuilder/rescan";
import {
  carryKey,
  isScanMemo,
  isStoredReview,
  memoKey,
  newCommitKey,
  type StoredReview,
} from "../lib/tripBuilder/reviewSession";
import {
  draftKey,
  isLauncherHandoff,
  jobKey,
  readSession,
  removeSession,
  writeSession,
} from "../lib/tripBuilder/session";
import type {
  AlbumOutcome,
  CommitBlocked,
  CommitJobResult,
  CommitResult,
  Day,
  LauncherHandoff,
  ScanJobResult,
  TripBuilderDraft,
} from "../types/tripBuilder";
import { useToastStore } from "../store/toastStore";
import { useTranslation } from "./useTranslation";

export type Phase =
  | { kind: "empty" }
  | { kind: "scanning"; progress: JobView["progress"] }
  | { kind: "scanLost" }
  | { kind: "scanFailed"; message: string }
  | { kind: "loading" }
  | { kind: "expired"; canScanAgain: boolean }
  | { kind: "loadFailed" }
  | { kind: "ready" };

export type CommitView =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "blocked"; blocked: CommitBlocked }
  /** `canScanAgain`: only a new scan mends it (the trip changed since the scan). */
  | { kind: "failed"; message: string; canScanAgain: boolean }
  | { kind: "unknown" }
  | { kind: "already"; tripId: string | null }
  | { kind: "done"; result: CommitResult; album: "idle" | "running" };

export interface BuilderSession {
  phase: Phase;
  draft: TripBuilderDraft | null;
  state: ReviewState | null;
  /** After a re-scan: how many of the user's edits the new draft could take. */
  carried: { kept: number; total: number } | null;
  /** The form the trip was started from; `buildCommitBody` takes the trip's fields from it. */
  handoff: LauncherHandoff;
  commit: CommitView;
  edit: (edit: DraftEdit) => void;
  resetEdits: () => void;
  rescan: (range: { startDay?: Day; endDay?: Day }) => Promise<void>;
  scanAgain: () => Promise<void>;
  /** Sends the commit; `withoutAlbum` first switches the album off (after it was blocked). */
  submit: (withoutAlbum?: boolean) => Promise<void>;
  /** Sends the flights alone: the empty-window screen's re-sync decisions go out as keep. */
  submitFlightsOnly: () => Promise<void>;
  retryAlbum: () => Promise<void>;
  /** Discards the draft and goes back to where the review was started. */
  leave: () => void;
}

const fallbackHandoff = (draft: TripBuilderDraft): LauncherHandoff => ({
  form: { name: draft.tripName },
  target:
    draft.target.kind === "existing"
      ? { kind: "existing", tripId: draft.target.tripId }
      : { kind: "new" },
  returnTo: "/trips",
});

export function useBuilderSession(): BuilderSession {
  const { t } = useTranslation(["tripBuilder"]);
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job");
  const draftId = params.get("draft");

  const [phase, setPhase] = useState<Phase>(
    jobId !== null
      ? { kind: "scanning", progress: null }
      : draftId !== null
        ? { kind: "loading" }
        : { kind: "empty" }
  );
  const [draft, setDraft] = useState<TripBuilderDraft | null>(null);
  const [state, setState] = useState<ReviewState | null>(null);
  const [carried, setCarried] = useState<BuilderSession["carried"]>(null);
  const [commit, setCommit] = useState<CommitView>({ kind: "idle" });
  const commitKey = useRef("");
  const handoff = useRef<LauncherHandoff | null>(null);
  const carry = useRef<StoredReview | null>(null);

  /** The sentence for a refused request, with the wait when the server said how long. */
  const refusal = useCallback(
    (err: unknown, key: string): string => {
      const limited = rateLimitOf(err);
      return limited?.minutes
        ? t("tripBuilder:errors.rateLimitedMinutes", { count: limited.minutes })
        : t(key);
    },
    [t]
  );

  useEffect(() => {
    if (jobId === null && draftId === null) setPhase({ kind: "empty" });
  }, [jobId, draftId]);

  // ── ?job=: follow the scan ────────────────────────────────────────────────
  useEffect(() => {
    if (jobId === null) return;
    let cancelled = false;
    setPhase({ kind: "scanning", progress: null });
    handoff.current = readSession(jobKey(jobId), isLauncherHandoff) ?? handoff.current;
    waitForJob<ScanJobResult>(jobId, {
      onPoll: (job) => {
        if (!cancelled) setPhase({ kind: "scanning", progress: job.progress });
      },
    })
      .then((result) => {
        if (cancelled) return;
        carry.current = readSession(carryKey(jobId), isStoredReview);
        setParams({ draft: result.draftId }, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPhase(
          err instanceof JobLostError
            ? { kind: "scanLost" }
            : { kind: "scanFailed", message: t(scanFailureKey(err)) }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // ── ?draft=: load it and put the edits back ──────────────────────────────
  useEffect(() => {
    if (draftId === null) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    setCommit({ kind: "idle" });
    tripBuilderApi
      .getDraft(draftId)
      .then((loaded) => {
        if (cancelled) return;
        const stored = readSession(draftKey(loaded.id), isStoredReview);
        const incoming = carry.current;
        const replay = reapplyEdits(loaded, stored?.edits ?? incoming?.edits ?? []);
        commitKey.current = stored?.commitKey ?? incoming?.commitKey ?? newCommitKey();
        const memo = readSession(memoKey(loaded.id), isScanMemo);
        handoff.current = handoff.current ?? memo?.handoff ?? fallbackHandoff(loaded);
        writeSession(memoKey(loaded.id), {
          scan: scanBodyFor(loaded, replay.state.tripName),
          handoff: handoff.current,
        });
        writeSession(draftKey(loaded.id), {
          edits: replay.state.edits,
          commitKey: commitKey.current,
        });
        setDraft(loaded);
        setState(replay.state);
        setCarried(
          stored === null && incoming !== null && incoming.edits.length > 0
            ? { kept: replay.kept, total: replay.total }
            : null
        );
        setPhase({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } } | null)?.response?.status;
        if (status === 404) {
          const memo = readSession(memoKey(draftId), isScanMemo);
          setPhase({ kind: "expired", canScanAgain: memo !== null });
        } else {
          setPhase({ kind: "loadFailed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  // ── The edits survive a reload ───────────────────────────────────────────
  useEffect(() => {
    if (draft === null || state === null) return;
    writeSession(draftKey(draft.id), { edits: state.edits, commitKey: commitKey.current });
  }, [draft, state?.edits]);

  // ── Leaving with edits unsaved asks first ────────────────────────────────
  const guarded =
    phase.kind === "ready" &&
    state !== null &&
    state.edits.length > 0 &&
    commit.kind !== "done" &&
    commit.kind !== "already";
  useEffect(() => {
    if (!guarded) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guarded]);

  const edit = useCallback(
    (next: DraftEdit) => {
      if (draft === null) return;
      setState((current) => (current === null ? current : applyEdit(draft, current, next)));
    },
    [draft]
  );

  const resetEdits = useCallback(() => {
    if (draft !== null) setState(initialReviewState(draft));
  }, [draft]);

  /**
   * Starts a scan and follows it. The new job's hand-off carries the request it
   * was started with, so if that job is lost too, "Scan again" repeats these
   * dates and not the first scan's.
   */
  const follow = useCallback(
    async (input: Parameters<typeof startRescan>[0]): Promise<void> => {
      try {
        const next = await startRescan({
          ...input,
          handoff: { ...input.handoff, scan: input.scan },
        });
        setParams({ job: next }, { replace: true });
      } catch (err: unknown) {
        addToast("error", refusal(err, scanStartFailureKey(err)));
      }
    },
    [addToast, refusal]
  );

  const rescan = useCallback(
    async (range: { startDay?: Day; endDay?: Day }): Promise<void> => {
      if (draft === null || state === null || handoff.current === null) return;
      await follow({
        scan: {
          ...scanBodyFor(draft, state.tripName),
          startDay: range.startDay ?? draft.window.startDay,
          endDay: range.endDay ?? draft.window.endDay,
        },
        handoff: handoff.current,
        edits: state.edits,
        commitKey: commitKey.current,
      });
    },
    [draft, state, follow]
  );

  /**
   * Scans again what was scanned: for an expired draft, from the memo kept with
   * it; for a lost scan job (no draft yet), from the request its hand-off
   * carries (spec §G), with the edits a lost re-scan was carrying.
   */
  const scanAgain = useCallback(async (): Promise<void> => {
    if (draftId !== null) {
      const memo = readSession(memoKey(draftId), isScanMemo);
      if (memo === null) return;
      const stored = readSession(draftKey(draftId), isStoredReview);
      await follow({
        scan: memo.scan,
        handoff: memo.handoff,
        edits: stored?.edits ?? [],
        commitKey: stored?.commitKey ?? newCommitKey(),
      });
      return;
    }
    const lost = handoff.current;
    if (jobId === null || lost?.scan === undefined) return;
    const carriedOver = readSession(carryKey(jobId), isStoredReview);
    await follow({
      scan: lost.scan,
      handoff: lost,
      edits: carriedOver?.edits ?? [],
      commitKey: carriedOver?.commitKey ?? newCommitKey(),
    });
  }, [draftId, jobId, follow]);

  /** Sends one built body and holds the outcome; the caller decides what goes in it. */
  const sendCommit = useCallback(
    async (sending: ReviewState): Promise<void> => {
      if (draft === null || handoff.current === null) return;
      setCommit({ kind: "running" });
      try {
        const body = buildCommitBody(draft, sending, handoff.current.form, commitKey.current);
        const { jobId: commitJob } = await tripBuilderApi.commit(draft.id, body);
        const result = await waitForJob<CommitJobResult>(commitJob);
        if (result.status === "blocked") {
          setCommit({ kind: "blocked", blocked: result });
          return;
        }
        removeSession(draftKey(draft.id));
        setCommit({ kind: "done", result, album: "idle" });
      } catch (err: unknown) {
        const tripId = alreadyCommittedTripId(err);
        if (err instanceof JobLostError) setCommit({ kind: "unknown" });
        else if (tripId !== null) setCommit({ kind: "already", tripId });
        else {
          setCommit({
            kind: "failed",
            message: refusal(err, commitFailureKey(err)),
            canScanAgain: commitNeedsRescan(err),
          });
        }
      }
    },
    [draft, refusal]
  );

  const submit = useCallback(
    async (withoutAlbum = false): Promise<void> => {
      if (draft === null || state === null) return;
      let sending = state;
      if (withoutAlbum) {
        sending = applyEdit(draft, state, {
          type: "setAlbum",
          create: false,
          name: state.album?.name ?? state.tripName,
        });
        setState(sending);
      }
      await sendCommit(sending);
    },
    [draft, state, sendCommit]
  );

  /**
   * The empty-window screen's submit: it draws only the flights, so the re-sync
   * decisions it never showed (spec §K.5) are sent as keep, with no album
   * removals — that screen must not delete or remove what it did not show.
   */
  const submitFlightsOnly = useCallback(async (): Promise<void> => {
    if (state === null) return;
    await sendCommit(keepEverything(state));
  }, [state, sendCommit]);

  const retryAlbum = useCallback(async (): Promise<void> => {
    if (commit.kind !== "done") return;
    const { result } = commit;
    setCommit({ kind: "done", result, album: "running" });
    try {
      const { jobId: albumJob } = await tripBuilderApi.retryAlbum(
        result.tripId,
        state?.album?.name
      );
      const album = await waitForJob<AlbumOutcome>(albumJob);
      setCommit({ kind: "done", result: { ...result, album }, album: "idle" });
    } catch {
      setCommit({ kind: "done", result, album: "idle" });
      addToast("error", t("tripBuilder:errors.album.retryFailed"));
    }
  }, [commit, state, addToast, t]);

  const leave = useCallback((): void => {
    if (draft !== null) {
      void tripBuilderApi.discardDraft(draft.id).catch(() => undefined);
      removeSession(draftKey(draft.id));
      removeSession(memoKey(draft.id));
    }
    navigate(handoff.current?.returnTo ?? "/trips");
  }, [draft, navigate]);

  return {
    phase,
    draft,
    state,
    carried,
    handoff: handoff.current ?? { form: { name: "" }, target: { kind: "new" }, returnTo: "/trips" },
    commit,
    edit,
    resetEdits,
    rescan,
    scanAgain,
    submit,
    submitFlightsOnly,
    retryAlbum,
    leave,
  };
}
