/**
 * Drafts, in memory (spec 2026-10-09 §A). A draft is a short-lived answer to
 * one click and the deployment is one Node process, so a `Map` is enough and
 * no migration is needed. A restart loses every draft; the page says "expired".
 *
 * Time comes from `now()`. A draft is bound to its owner: a stranger's draft
 * answers exactly as an unknown id does. A committing draft never expires and
 * no draft that is committing or committed is ever evicted: a commit that has
 * written the trip must not be able to run twice.
 */
import { now } from "../../shared/time/clock";
import {
  DRAFT_IDLE_TTL_MS,
  DRAFT_MAX_TTL_MS,
  MAX_DRAFTS_PER_USER,
  MAX_DRAFTS_TOTAL,
} from "./thresholds";
import type { BeginCommit, CommitResult, StoredDraft } from "./types";

const drafts = new Map<string, StoredDraft>();

const nowMs = (): number => now().getTime();

/** The instant a draft expires: two hours after it was last read, six at most after it was made. */
export function expiresAtOf(draft: StoredDraft): number {
  return Math.min(draft.touchedAt + DRAFT_IDLE_TTL_MS, draft.createdAt + DRAFT_MAX_TTL_MS);
}

function isLive(draft: StoredDraft, at: number): boolean {
  return draft.status === "committing" || expiresAtOf(draft) > at;
}

function oldestReady(matches: (draft: StoredDraft) => boolean): StoredDraft[] {
  return [...drafts.values()]
    .filter((draft) => draft.status === "ready" && matches(draft))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function putDraft(draft: StoredDraft): void {
  const at = nowMs();
  for (const [id, held] of drafts) if (!isLive(held, at)) drafts.delete(id);
  drafts.set(draft.id, draft);

  const mine = oldestReady((held) => held.ownerId === draft.ownerId);
  for (const held of mine.slice(0, Math.max(0, mine.length - MAX_DRAFTS_PER_USER))) {
    drafts.delete(held.id);
  }
  let excess = drafts.size - MAX_DRAFTS_TOTAL;
  for (const held of oldestReady(() => true)) {
    if (excess <= 0) break;
    drafts.delete(held.id);
    excess--;
  }
}

/** The caller's live draft, with its idle clock slid forward; null for a stranger's, an unknown or an expired one. */
export function getDraft(ownerId: string, id: string): StoredDraft | null {
  const draft = drafts.get(id);
  if (!draft || draft.ownerId !== ownerId) return null;
  const at = nowMs();
  if (!isLive(draft, at)) {
    drafts.delete(id);
    return null;
  }
  draft.touchedAt = at;
  return draft;
}

/** Discards the caller's draft; a committing one is left to finish. */
export function deleteDraft(ownerId: string, id: string): void {
  const draft = drafts.get(id);
  if (draft && draft.ownerId === ownerId && draft.status !== "committing") drafts.delete(id);
}

/**
 * The commit state machine, one transition per call. `start` means the caller
 * owns the commit and must start its job and `attachCommitJob`; every other
 * answer tells the caller what is already true.
 */
export function beginCommit(ownerId: string, id: string, commitKey: string): BeginCommit {
  const draft = getDraft(ownerId, id);
  if (!draft) return { kind: "missing" };
  if (draft.status === "committed" && draft.result) {
    return { kind: "committed", result: draft.result };
  }
  if (draft.status === "committing") {
    return draft.commitKey === commitKey && draft.commitJobId
      ? { kind: "inProgress", jobId: draft.commitJobId }
      : { kind: "busy" };
  }
  draft.status = "committing";
  draft.commitKey = commitKey;
  draft.commitJobId = undefined;
  return { kind: "start" };
}

export function attachCommitJob(id: string, jobId: string): void {
  const draft = drafts.get(id);
  if (draft && draft.status === "committing") draft.commitJobId = jobId;
}

/** Called right after phase B commits: from here the draft can never run again. */
export function finishCommit(id: string, result: CommitResult): void {
  const draft = drafts.get(id);
  if (draft) {
    draft.status = "committed";
    draft.result = result;
  }
}

/** Only from a failure before or inside phase B; a committed draft stays committed. */
export function abortCommit(id: string): void {
  const draft = drafts.get(id);
  if (draft && draft.status === "committing") {
    draft.status = "ready";
    draft.commitKey = undefined;
    draft.commitJobId = undefined;
  }
}

/**
 * The committed draft of this user that wrote this trip, newest first; null
 * when the process no longer holds one. The album retry reads it for the
 * stopover whose name it posts (spec 2026-10-11 §5.4): the draft is the only
 * record of the layover's picture ids (§2.3), so no new state is kept and no
 * request ever carries an id. Expiry is not consulted — the record is the
 * historical fact that wrote the trip.
 */
export function committedDraftForTrip(ownerId: string, tripId: string): StoredDraft | null {
  const wrote = [...drafts.values()].filter(
    (draft) =>
      draft.ownerId === ownerId && draft.status === "committed" && draft.result?.tripId === tripId
  );
  wrote.sort((a, b) => b.createdAt - a.createdAt);
  return wrote[0] ?? null;
}

/** Test seam. */
export function clearDraftsForTests(): void {
  drafts.clear();
}
