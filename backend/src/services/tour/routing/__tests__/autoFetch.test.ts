import { describe, expect, it } from "@jest/globals";

import { AUTOFETCH_MIN_OFF_KM, maybeAutoFetch, shouldAutoFetch } from "../autoFetch";

/**
 * Task 6 of the osrm-autofetch plan (2026-10-13): the TravStats side's one
 * outbound call. When a refusal is a wrong-region one — the provider's line
 * snapped hundreds of km away, which is what a routing graph without map data
 * for that area does — the app asks the host's `osrm-autofetch` service to
 * fetch and build the missing region, and carries its answer beside the
 * refusal so the client can say a download is running.
 *
 * Every failure mode of this call must end in `null`, never a throw: the
 * response of a refusal must stay exactly what it was before this feature
 * existed when the service is off, unreachable, or answers nonsense
 * (spec 2026-10-13 §5 — "Service down/unreachable → the app's ensure call
 * times out → the routing message is byte-identical to today").
 */

/** A `fetch` stand-in that records its calls; `reply` decides each answer. */
function recordingFetch(reply: (url: string, init: RequestInit) => Promise<unknown>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return await reply(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const okJson = (body: unknown) => async () => ({ ok: true, json: async () => body });

describe("maybeAutoFetch", () => {
  it("posts the leg's two points to .../ensure as [lat, lon] pairs and returns the answer", async () => {
    const { impl, calls } = recordingFetch(
      okJson({ status: "started", region: "Tennessee", etaMinutes: 25 })
    );

    const res = await maybeAutoFetch(
      "http://10.86.15.1:5013",
      { lat: 36.1, lon: -86.6 },
      { lat: 35.6, lon: -83.4 },
      impl
    );

    expect(res).toEqual({ status: "started", region: "Tennessee", etaMinutes: 25 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://10.86.15.1:5013/ensure");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      points: [
        [36.1, -86.6],
        [35.6, -83.4],
      ],
    });
    // Without a signal a hung service would hold the routing response open
    // indefinitely — the refusal path must answer regardless (2.5 s timeout).
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null when the service is unreachable or times out", async () => {
    const res = await maybeAutoFetch(
      "http://x:1",
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch
    );

    expect(res).toBeNull();
  });

  it("returns null for a non-200 answer and for a junk body", async () => {
    const { impl: notOk } = recordingFetch(async () => ({ ok: false }));

    expect(
      await maybeAutoFetch("http://x", { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, notOk)
    ).toBeNull();

    // A 200 whose body is not the expected object shape (a proxy error page
    // parsed as JSON, a future service answering a different contract) is
    // treated the same as no answer — it must never leak into the response.
    const { impl: wrongShape } = recordingFetch(okJson({ nope: 1 }));
    expect(
      await maybeAutoFetch("http://x", { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, wrongShape)
    ).toBeNull();

    const { impl: unknownStatus } = recordingFetch(okJson({ status: "elsewhere" }));
    expect(
      await maybeAutoFetch("http://x", { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, unknownStatus)
    ).toBeNull();
  });

  it("tolerates a trailing slash and a missing url", async () => {
    const { impl, calls } = recordingFetch(okJson({ status: "covered" }));

    await maybeAutoFetch("http://x:1/", { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, impl);

    expect(calls[0].url).toBe("http://x:1/ensure");
    // An unset setting means the feature is off — no call at all, so the
    // response is byte-identical to today's (Review Focus 3).
    expect(await maybeAutoFetch(null, { lat: 0, lon: 0 }, { lat: 1, lon: 1 })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("shouldAutoFetch", () => {
  it("fires only when the refusal is an anchors one and its smallest offset is beyond the threshold", () => {
    // The owner's Muscat roadtrip: a graph with no data for the region snapped
    // both stops ~500-700 km away. A pin-sized error is ~1.3 km, and a
    // genuine distance mismatch carries no wrong-region signal at all — only
    // the former is worth a download.
    expect(shouldAutoFetch({ kind: "anchors", headOffKm: 671.3, tailOffKm: 517.9 })).toBe(true);
    expect(shouldAutoFetch({ kind: "anchors", headOffKm: 1.3, tailOffKm: 0.4 })).toBe(false);
    expect(shouldAutoFetch({ kind: "distance", distanceKm: 500, chordKm: 5 })).toBe(false);
    expect(shouldAutoFetch(null)).toBe(false);
  });

  it("takes the SMALLEST of the two offsets, strictly above the threshold", () => {
    // One end near its stop means the line did anchor there — not a
    // wrong-region refusal, however far the other end drifted.
    expect(shouldAutoFetch({ kind: "anchors", headOffKm: 671.3, tailOffKm: 0.4 })).toBe(false);
    // The threshold is exclusive: exactly AUTOFETCH_MIN_OFF_KM does not fire.
    expect(
      shouldAutoFetch({
        kind: "anchors",
        headOffKm: AUTOFETCH_MIN_OFF_KM,
        tailOffKm: AUTOFETCH_MIN_OFF_KM,
      })
    ).toBe(false);
    expect(
      shouldAutoFetch({
        kind: "anchors",
        headOffKm: AUTOFETCH_MIN_OFF_KM + 0.1,
        tailOffKm: AUTOFETCH_MIN_OFF_KM + 0.1,
      })
    ).toBe(true);
  });
});
