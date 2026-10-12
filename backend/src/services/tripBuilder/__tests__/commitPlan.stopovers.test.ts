jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import type { CommitBody } from "../../../schemas/tripBuilder";
import { loadVisibleDomains } from "../../domainVisibility";
import { prepareCommit } from "../commitPlan";
import type { StoredDraft, StoredStopover } from "../types";
import { draftStation, fixtureBody, fixtureDraft } from "./commitFixtures";

const mockDomains = loadVisibleDomains as jest.Mock;

// Synthetic fixtures only (public repository): invented places, shifted years.
const USER = "e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
/** The two flights the layover joins; the stopover key is theirs (spec 2026-10-11 §2.3). */
const IN_FLIGHT = "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OUT_FLIGHT = "6d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const STOPOVER_KEY = `${IN_FLIGHT}#${OUT_FLIGHT}`;
const AIRPORT_KEY = "311|4201|2031-05-04";
const TOWN_KEY = "309|4203|2031-05-04";

/** The stopover a scan of the fixture window offered: an afternoon in Eastport. */
const STOPOVER: StoredStopover = {
  key: STOPOVER_KEY,
  title: "Northvale loop · Eastport",
  city: "Eastport",
  day: "2031-05-04",
  inFlightId: IN_FLIGHT,
  outFlightId: OUT_FLIGHT,
  airportIata: "EPT",
  photoIds: ["photo-s1", "photo-s2", "photo-s3"],
  stations: [
    {
      ...draftStation({
        key: AIRPORT_KEY,
        title: "Eastport Airport",
        lat: -38.02,
        lon: 177.01,
        firstDay: "2031-05-04",
        lastDay: "2031-05-04",
      }),
      kind: "airport",
    },
    draftStation({
      key: TOWN_KEY,
      title: "Eastport",
      lat: -38.07,
      lon: 177.08,
      firstDay: "2031-05-04",
      lastDay: "2031-05-04",
    }),
  ],
  legs: [
    {
      fromKey: AIRPORT_KEY,
      toKey: TOWN_KEY,
      chordKm: 8,
      routedKm: null,
      mode: "road",
      ferryEvidence: null,
    },
  ],
};

const draft = (over: Partial<StoredDraft> = {}): StoredDraft =>
  fixtureDraft(USER, [], { stopovers: [STOPOVER], ...over });
const body = (over: Partial<CommitBody> = {}): CommitBody => ({ ...fixtureBody([]), ...over });
const toggled = (roadtrip: boolean, album: boolean): Partial<CommitBody> => ({
  stopovers: [{ key: STOPOVER_KEY, roadtrip, album }],
});
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as {
      statusCode: number;
      code?: string;
      field?: string;
      extra?: Record<string, unknown>;
    };
  }
  throw new Error("expected prepareCommit to refuse");
};

describe("prepareCommit and the stopovers", () => {
  beforeEach(() => mockDomains.mockResolvedValue(["flight", "roadtrip"]));

  it("plans a toggled stopover as a night-free roadtrip beside the areas", async () => {
    const plan = await prepareCommit(USER, draft(), body(toggled(true, false)));

    expect(plan.roadtrips).toHaveLength(1); // the area's own roadtrip is untouched
    expect(plan.stops).toEqual([]);
    expect(plan.stopovers).toHaveLength(1);
    const [stopover] = plan.stopovers ?? [];
    expect(stopover.key).toBe(STOPOVER_KEY);
    expect(stopover.name).toBe("Northvale loop · Eastport");
    expect(stopover.roadtripId).toBeUndefined();
    expect(stopover.album).toBeNull();
    expect(
      stopover.stations.map((s) => [
        s.title,
        s.startDate?.toISOString(),
        s.endDate?.toISOString(),
        s.night.kind,
      ])
    ).toEqual([
      ["Eastport Airport", "2031-05-04T00:00:00.000Z", "2031-05-04T00:00:00.000Z", "pass"],
      ["Eastport", "2031-05-04T00:00:00.000Z", "2031-05-04T00:00:00.000Z", "pass"],
    ]);
  });

  it("carries the stored photo ids as the album's members when its switch is on", async () => {
    const plan = await prepareCommit(USER, draft(), body(toggled(true, true)));
    expect(plan.stopovers?.[0].album).toEqual({
      // The album takes the roadtrip row's own name — the draft's one title
      // (owner ruling 2026-10-12), never a second string.
      name: plan.stopovers?.[0].name,
      assetIds: ["photo-s1", "photo-s2", "photo-s3"],
    });
    expect(plan.stopovers?.[0].album?.name).toBe("Northvale loop · Eastport");
  });

  it("never asks the night plan about a stopover's stations", async () => {
    // A night that names a stopover station is no night the plan knows: stopover
    // stations travel in no area and in no `nights` record.
    const nights = { ...body().nights, "2031-05-04": TOWN_KEY };
    const refused = await refusal(
      prepareCommit(USER, draft(), body({ ...toggled(true, false), nights }))
    );
    expect([refused.statusCode, refused.code]).toEqual([400, "NIGHT_PLAN_INVALID"]);
    expect(refused.extra).toMatchObject({ reason: "unknownStation" });
  });

  it("refuses a stopover key the draft never offered, as 400 DRAFT_MISMATCH", async () => {
    const unknown = await refusal(
      prepareCommit(
        USER,
        draft(),
        body({
          stopovers: [
            {
              key: "0f0f0f0f-0000-4000-8000-000000000000#1f1f1f1f-0000-4000-8000-000000000000",
              roadtrip: true,
              album: false,
            },
          ],
        })
      )
    );
    expect([unknown.statusCode, unknown.code, unknown.field]).toEqual([
      400,
      "DRAFT_MISMATCH",
      "stopovers",
    ]);
  });

  it("plans nothing for an offered stopover whose roadtrip switch is off", async () => {
    const plan = await prepareCommit(USER, draft(), body(toggled(false, false)));
    expect(plan.stopovers).toEqual([]);
  });

  it("refuses 409 ROADTRIPS_HIDDEN for a toggled stopover while roadtrips are hidden", async () => {
    mockDomains.mockResolvedValue(["flight"]);
    const hidden = await refusal(
      prepareCommit(USER, draft(), body({ areas: [], nights: {}, ...toggled(true, false) }))
    );
    expect([hidden.statusCode, hidden.code]).toEqual([409, "ROADTRIPS_HIDDEN"]);
  });

  it("refuses 400 STATIONS_INVALID for a stopover the draft left under two stations", async () => {
    const short = draft({ stopovers: [{ ...STOPOVER, stations: [STOPOVER.stations[0]] }] });
    const refused = await refusal(prepareCommit(USER, short, body(toggled(true, false))));
    expect([refused.statusCode, refused.code, refused.field]).toEqual([
      400,
      "STATIONS_INVALID",
      "stopovers.0",
    ]);
  });
});
