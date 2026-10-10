/**
 * What the review page keeps in sessionStorage besides the launcher's handoff
 * (`session.ts`): the user's edits and the commit key of one review, the scan
 * that made the draft (so an expired draft can be scanned again), and the edits
 * a re-scan carries over to its successor.
 */
import type { LauncherHandoff, ScanBody } from "../../types/tripBuilder";
import type { DraftEdit } from "./draftEdits";
import { isLauncherHandoff, isScanBody } from "./session";

/** `tb:draft:<id>` and `tb:carry:<jobId>`: the edits so far, and the key the commit is sent under. */
export interface StoredReview {
  edits: DraftEdit[];
  commitKey: string;
}

/** `tb:scan:<draftId>`: how the draft was asked for, and where Back goes. */
export interface ScanMemo {
  scan: ScanBody;
  handoff: LauncherHandoff;
}

/**
 * A fresh key for one review's commit: a version-4 UUID. `randomUUID` only
 * exists on a secure origin (https or localhost), and the app is also served
 * over plain http on a home network, so without it the bytes are drawn by hand.
 */
export function newCommitKey(
  source: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = crypto
): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export const carryKey = (jobId: string): string => `tb:carry:${jobId}`;
export const memoKey = (draftId: string): string => `tb:scan:${draftId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Shape only: an edit of a kind this page no longer knows is dropped when the edits are replayed. */
export function isStoredReview(value: unknown): value is StoredReview {
  return (
    isRecord(value) &&
    typeof value.commitKey === "string" &&
    Array.isArray(value.edits) &&
    value.edits.every((edit) => isRecord(edit) && typeof edit.type === "string")
  );
}

export function isScanMemo(value: unknown): value is ScanMemo {
  return isRecord(value) && isScanBody(value.scan) && isLauncherHandoff(value.handoff);
}
