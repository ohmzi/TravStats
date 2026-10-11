jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import type { CommitBody } from "../../../schemas/tripBuilder";
import { loadVisibleDomains } from "../../domainVisibility";
import { prepareCommit } from "../commitPlan";
import type { StoredDraft } from "../types";
import { fixtureBody, fixtureDraft, fixtureStoredPitstop, PITSTOP_ALBUM } from "./commitFixtures";

const mockDomains = loadVisibleDomains as jest.Mock;

// Synthetic fixtures only (public repository): invented places, shifted years.
const USER = "f2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d";

/** The fixture draft with its one area offered as a pitstop (spec 2026-10-11 pitstops §2, §4). */
const draft = (over: Partial<StoredDraft> = {}): StoredDraft => {
  const base = fixtureDraft(USER, [], { pitstops: [fixtureStoredPitstop()], ...over });
  const [area, ...rest] = base.dto.areas;
  return {
    ...base,
    dto: { ...base.dto, areas: [{ ...area, pitstop: { albumName: PITSTOP_ALBUM } }, ...rest] },
  };
};
const body = (over: Partial<CommitBody> = {}): CommitBody => ({ ...fixtureBody([]), ...over });
const albumOn = (album: boolean): Partial<CommitBody> => ({
  areas: fixtureBody([]).areas.map((area) => ({ ...area, album })),
});
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode: number; code?: string; field?: string };
  }
  throw new Error("expected prepareCommit to refuse");
};

describe("prepareCommit and a pitstop's own album", () => {
  beforeEach(() => mockDomains.mockResolvedValue(["flight", "roadtrip"]));

  it("carries the area's album — its name and its own photo set — on the roadtrip plan", async () => {
    const plan = await prepareCommit(USER, draft(), body(albumOn(true)));

    expect(plan.roadtrips).toHaveLength(1);
    expect(plan.roadtrips[0].album).toEqual({
      name: PITSTOP_ALBUM,
      assetIds: ["photo-a", "photo-b"],
    });
  });

  it("plans no album when the switch is off", async () => {
    const plan = await prepareCommit(USER, draft(), body(albumOn(false)));
    expect(plan.roadtrips[0].album).toBeUndefined();
  });

  it("refuses 400 DRAFT_MISMATCH for an album tick on an area the scan offered no pitstop for", async () => {
    // `pitstops` is kept, so only the missing DTO offer can refuse it.
    const plain = fixtureDraft(USER, [], { pitstops: [fixtureStoredPitstop()] });
    const refused = await refusal(prepareCommit(USER, plain, body(albumOn(true))));
    expect([refused.statusCode, refused.code, refused.field]).toEqual([
      400,
      "DRAFT_MISMATCH",
      "areas",
    ]);
  });
});
