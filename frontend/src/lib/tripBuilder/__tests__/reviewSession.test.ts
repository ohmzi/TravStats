import { describe, expect, it } from "vitest";

import { carryKey, isScanMemo, isStoredReview, memoKey, newCommitKey } from "../reviewSession";

const HANDOFF = {
  form: { name: "Southern loop" },
  target: { kind: "new" },
  returnTo: "/trips",
};
const SCAN = {
  name: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

describe("the keys", () => {
  it("name the job or the draft they belong to", () => {
    expect(carryKey("job-1")).toBe("tb:carry:job-1");
    expect(memoKey("draft-1")).toBe("tb:scan:draft-1");
  });
});

describe("isStoredReview", () => {
  it("takes the edits and the commit key", () => {
    const edits = [{ type: "merge", stationKey: "a" }];
    expect(isStoredReview({ edits, commitKey: "k" })).toBe(true);
    expect(isStoredReview({ edits: [], commitKey: "k" })).toBe(true);
  });

  it("refuses what is not that shape", () => {
    expect(isStoredReview(null)).toBe(false);
    expect(isStoredReview({ edits: [], commitKey: 1 })).toBe(false);
    expect(isStoredReview({ edits: "none", commitKey: "k" })).toBe(false);
    expect(isStoredReview({ edits: [{ stationKey: "a" }], commitKey: "k" })).toBe(false);
    expect(isStoredReview({ edits: [null], commitKey: "k" })).toBe(false);
  });
});

describe("isScanMemo", () => {
  it("takes the scan with its handoff", () => {
    expect(isScanMemo({ scan: SCAN, handoff: HANDOFF })).toBe(true);
  });

  it("refuses a memo missing either half or a field of the scan", () => {
    expect(isScanMemo({ scan: SCAN })).toBe(false);
    expect(isScanMemo({ handoff: HANDOFF })).toBe(false);
    expect(isScanMemo({ scan: { ...SCAN, endDay: undefined }, handoff: HANDOFF })).toBe(false);
    expect(isScanMemo({ scan: { ...SCAN, inspect: "yes" }, handoff: HANDOFF })).toBe(false);
    expect(isScanMemo(undefined)).toBe(false);
  });
});

describe("newCommitKey", () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("uses the browser's own UUID where it has one", () => {
    const randomUUID = () => "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d" as const;
    expect(
      newCommitKey({ randomUUID, getRandomValues: <T extends ArrayBufferView | null>(a: T) => a })
    ).toBe("6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d");
  });

  it("builds a version-4 UUID from random bytes where the page is not on a secure origin", () => {
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint8Array).fill(0xff);
      return array;
    };
    const key = newCommitKey({ getRandomValues });
    expect(key).toMatch(V4);
    expect(key).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("makes a different key each time in a real browser", () => {
    expect(newCommitKey()).toMatch(V4);
    expect(newCommitKey()).not.toBe(newCommitKey());
  });
});
