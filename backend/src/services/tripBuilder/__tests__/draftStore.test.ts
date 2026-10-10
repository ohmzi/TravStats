import { setClockForTests } from "../../../shared/time/clock";
import {
  abortCommit,
  attachCommitJob,
  beginCommit,
  clearDraftsForTests,
  deleteDraft,
  expiresAtOf,
  finishCommit,
  getDraft,
  putDraft,
} from "../draftStore";
import type { CommitResult, StoredDraft } from "../types";
import { COMMIT_KEY, CREATED_AT, OTHER_COMMIT_KEY, fixtureDraft } from "./commitFixtures";

const HOUR = 3_600_000;
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";

const at = (offsetMs: number) => setClockForTests(new Date(CREATED_AT + offsetMs));
const draft = (id: string, ownerId = ALICE, over: Partial<StoredDraft> = {}) =>
  fixtureDraft(ownerId, [], { id, ...over });

const RESULT = {
  tripId: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01",
  created: true,
  roadtrips: [],
  stopIds: [],
  flightsAssigned: 0,
  flightsMovedFrom: [],
  routing: { routed: 0, straight: 0, ferry: 0, providerAvailable: false },
  photoJourneysResolved: 0,
  unknownNights: 0,
  album: { status: "skipped", skipReason: "notRequested" },
} satisfies CommitResult;

beforeEach(() => {
  clearDraftsForTests();
  at(0);
});
afterEach(() => setClockForTests(null));

describe("getDraft", () => {
  it("answers a stranger exactly as it answers an unknown id", () => {
    putDraft(draft("d1"));
    expect(getDraft(BOB, "d1")).toBeNull();
    expect(getDraft(ALICE, "nope")).toBeNull();
    expect(getDraft(ALICE, "d1")).not.toBeNull();
  });

  it("lets a draft live two hours untouched, and slides the idle clock on every read", () => {
    putDraft(draft("d1"));
    at(1.9 * HOUR);
    expect(getDraft(ALICE, "d1")).not.toBeNull();
    at(3.8 * HOUR);
    expect(getDraft(ALICE, "d1")).not.toBeNull();
    at(5.7 * HOUR);
    expect(getDraft(ALICE, "d1")).not.toBeNull();
  });

  it("expires a draft two hours after its last read", () => {
    putDraft(draft("d1"));
    at(2.1 * HOUR);
    expect(getDraft(ALICE, "d1")).toBeNull();
  });

  it("expires a draft six hours after it was made however often it was read", () => {
    putDraft(draft("d1"));
    for (const hours of [1.5, 3, 4.5, 5.9]) {
      at(hours * HOUR);
      expect(getDraft(ALICE, "d1")).not.toBeNull();
    }
    at(6.1 * HOUR);
    expect(getDraft(ALICE, "d1")).toBeNull();
  });

  it("reports the earlier of the two deadlines", () => {
    const d = draft("d1");
    expect(expiresAtOf(d)).toBe(CREATED_AT + 2 * HOUR);
    expect(expiresAtOf({ ...d, touchedAt: CREATED_AT + 5 * HOUR })).toBe(CREATED_AT + 6 * HOUR);
  });

  it("never expires a draft whose commit is running", () => {
    putDraft(draft("d1"));
    beginCommit(ALICE, "d1", COMMIT_KEY);
    at(9 * HOUR);
    expect(getDraft(ALICE, "d1")).not.toBeNull();
  });
});

describe("putDraft", () => {
  it("keeps three ready drafts per user and drops the oldest", () => {
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      putDraft(draft(id, ALICE, { createdAt: CREATED_AT + i, touchedAt: CREATED_AT + i }));
    }
    expect(getDraft(ALICE, "a")).toBeNull();
    for (const id of ["b", "c", "d"]) expect(getDraft(ALICE, id)).not.toBeNull();
  });

  it("does not count another user's drafts against the cap", () => {
    for (const id of ["a", "b", "c"]) putDraft(draft(id, ALICE));
    putDraft(draft("x", BOB));
    for (const id of ["a", "b", "c"]) expect(getDraft(ALICE, id)).not.toBeNull();
  });

  it("never evicts a draft that is committing or committed", () => {
    putDraft(draft("busy"));
    beginCommit(ALICE, "busy", COMMIT_KEY);
    putDraft(draft("done"));
    beginCommit(ALICE, "done", COMMIT_KEY);
    finishCommit("done", RESULT);
    for (const id of ["r1", "r2", "r3", "r4"]) putDraft(draft(id));

    expect(getDraft(ALICE, "busy")).not.toBeNull();
    expect(getDraft(ALICE, "done")).not.toBeNull();
  });

  it("holds the process to fifty drafts by dropping the oldest ready ones", () => {
    for (let i = 0; i < 52; i++) {
      putDraft(
        draft(`d${i}`, `user-${i}`, { createdAt: CREATED_AT + i, touchedAt: CREATED_AT + i })
      );
    }
    expect(getDraft("user-0", "d0")).toBeNull();
    expect(getDraft("user-1", "d1")).toBeNull();
    expect(getDraft("user-2", "d2")).not.toBeNull();
    expect(getDraft("user-51", "d51")).not.toBeNull();
  });

  it("sweeps drafts that have already expired", () => {
    putDraft(draft("old"));
    at(7 * HOUR);
    putDraft(
      draft("new", ALICE, { createdAt: CREATED_AT + 7 * HOUR, touchedAt: CREATED_AT + 7 * HOUR })
    );
    expect(getDraft(ALICE, "old")).toBeNull();
  });
});

describe("deleteDraft", () => {
  it("removes the caller's draft and leaves a stranger's, and a committing one, alone", () => {
    putDraft(draft("mine"));
    putDraft(draft("busy"));
    beginCommit(ALICE, "busy", COMMIT_KEY);

    deleteDraft(BOB, "mine");
    expect(getDraft(ALICE, "mine")).not.toBeNull();
    deleteDraft(ALICE, "busy");
    expect(getDraft(ALICE, "busy")).not.toBeNull();
    deleteDraft(ALICE, "mine");
    expect(getDraft(ALICE, "mine")).toBeNull();
  });
});

describe("beginCommit", () => {
  it("starts once, then answers the same key with the running job and any other key with 'busy'", () => {
    putDraft(draft("d1"));
    expect(beginCommit(ALICE, "d1", COMMIT_KEY)).toEqual({ kind: "start" });
    expect(beginCommit(ALICE, "d1", COMMIT_KEY)).toEqual({ kind: "busy" });
    attachCommitJob("d1", JOB);
    expect(beginCommit(ALICE, "d1", COMMIT_KEY)).toEqual({ kind: "inProgress", jobId: JOB });
    expect(beginCommit(ALICE, "d1", OTHER_COMMIT_KEY)).toEqual({ kind: "busy" });
  });

  it("answers 'committed' with the result for any key once phase B is done", () => {
    putDraft(draft("d1"));
    beginCommit(ALICE, "d1", COMMIT_KEY);
    finishCommit("d1", RESULT);
    expect(beginCommit(ALICE, "d1", COMMIT_KEY)).toEqual({ kind: "committed", result: RESULT });
    expect(beginCommit(ALICE, "d1", OTHER_COMMIT_KEY)).toEqual({
      kind: "committed",
      result: RESULT,
    });
  });

  it("returns a draft to ready when the commit is aborted, ready to start again", () => {
    putDraft(draft("d1"));
    beginCommit(ALICE, "d1", COMMIT_KEY);
    attachCommitJob("d1", JOB);
    abortCommit("d1");
    expect(getDraft(ALICE, "d1")?.status).toBe("ready");
    expect(beginCommit(ALICE, "d1", OTHER_COMMIT_KEY)).toEqual({ kind: "start" });
  });

  it("does not return a committed draft to ready", () => {
    putDraft(draft("d1"));
    beginCommit(ALICE, "d1", COMMIT_KEY);
    finishCommit("d1", RESULT);
    abortCommit("d1");
    expect(getDraft(ALICE, "d1")?.status).toBe("committed");
  });

  it("says 'missing' for a stranger's, an unknown and an expired draft", () => {
    putDraft(draft("d1"));
    expect(beginCommit(BOB, "d1", COMMIT_KEY)).toEqual({ kind: "missing" });
    expect(beginCommit(ALICE, "nope", COMMIT_KEY)).toEqual({ kind: "missing" });
    at(3 * HOUR);
    expect(beginCommit(ALICE, "d1", COMMIT_KEY)).toEqual({ kind: "missing" });
  });
});
