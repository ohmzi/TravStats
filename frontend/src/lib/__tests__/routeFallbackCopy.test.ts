import i18next, { type TFunction } from "i18next";
import { describe, it, expect } from "vitest";

import { germanT } from "../../__tests__/helpers/germanT";
import enTrips from "../../i18n/resources/en/trips.json";
import { routeFallbackMessage } from "../routeFallbackCopy";

/**
 * The English counterpart of `germanT` for the cases below: a real i18next
 * over the real English words, so an assertion on the English sentence
 * cannot pass on a key echoed back.
 */
const englishInstance = i18next.createInstance();
void englishInstance.init({
  lng: "en",
  fallbackLng: false,
  ns: ["trips"],
  defaultNS: "trips",
  resources: { en: { trips: enTrips } },
  interpolation: { escapeValue: false },
  initAsync: false,
});
const englishT = englishInstance.t.bind(englishInstance) as TFunction;

/**
 * 2026-10-13, the owner's Muscat roadtrip: "The routing provider's answer
 * did not fit the two places and was discarded" was all the message said,
 * and it is misleading — the provider was answering from a road graph with
 * no data for Oman at all, its line snapped ~9,500 km away. The numbers make
 * that visible; this pins what a German reader actually reads (the global
 * test mock returns the key, so only the real German text can catch a
 * forgotten interpolation).
 */
describe("routeFallbackMessage — the reason, with the numbers that refused the answer", () => {
  it("says how far off the provider's line began and ended, in the reader's numbers", () => {
    expect(
      routeFallbackMessage(
        "untrustworthy",
        { kind: "anchors", headOffKm: 9533, tailOffKm: 9551.2 },
        germanT,
        "de"
      )
    ).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen. " +
        "Die Linie beginnt 9.533 km vom ersten Ort entfernt und endet 9.551,2 km vom zweiten."
    );
  });

  it("carries the provider's own distance against the chord when that is what refused it", () => {
    expect(
      routeFallbackMessage(
        "untrustworthy",
        { kind: "distance", distanceKm: 812, chordKm: 30 },
        germanT,
        "de"
      )
    ).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen. " +
        "Die Linie ist 812 km lang, die Luftlinie beträgt 30 km."
    );
  });

  it("falls back to the headline for a kind this build does not know — never NaN", () => {
    // A newer server could add a third kind; this build must say the reason
    // it always did rather than formatting fields it cannot read.
    const unknown = { kind: "mystery" } as unknown as Parameters<typeof routeFallbackMessage>[1];
    const message = routeFallbackMessage("untrustworthy", unknown, germanT, "de");
    expect(message).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen."
    );
    expect(message).not.toContain("NaN");
  });

  it("leaves the reason standing alone when the server sent no numbers", () => {
    expect(routeFallbackMessage("untrustworthy", null, germanT, "de")).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen."
    );
    expect(routeFallbackMessage("point_not_near_road", null, germanT, "de")).toBe(
      "Ein Ort liegt mehr als einen Kilometer von der nächsten Straße entfernt — Ort der Station prüfen."
    );
  });
});

/**
 * 2026-10-13, the auto-fetch (spec 2026-10-13-osrm-autofetch-design §2.4): a
 * wrong-region refusal is no longer a dead end — the self-hosted OSRM's
 * covering extract is being fetched in the background. The refusal still
 * stands, but its message must say the map is on its way and roughly when,
 * or the reader re-clicks and reads the same refusal as a broken button.
 * Only `started`/`running` say the downloading sentence, only `no_map_data`
 * says its short line, and every other answer — `covered` above all, where
 * the refusal had a DIFFERENT cause — adds nothing: an extra sentence about
 * maps there would blame the wrong thing.
 */
describe("routeFallbackMessage — the map for the region is downloading", () => {
  const REFUSED = { kind: "anchors", headOffKm: 671.3, tailOffKm: 517.9 } as const;

  it("says the map for the region is downloading while the auto-fetch runs", () => {
    expect(
      routeFallbackMessage("untrustworthy", REFUSED, germanT, "de", {
        status: "started",
        region: "Tennessee",
        etaMinutes: 25,
      })
    ).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen. " +
        "Die Linie beginnt 671,3 km vom ersten Ort entfernt und endet 517,9 km vom zweiten. " +
        "Kartendaten für Tennessee werden gerade geladen (~25 Min.) – versuch es danach erneut."
    );
  });

  it("says the same for a job already running, in the reader's own language", () => {
    expect(
      routeFallbackMessage("untrustworthy", null, englishT, "en", {
        status: "running",
        region: "Iceland",
        etaMinutes: 20,
      })
    ).toBe(
      "The routing provider's answer did not fit the two places and was discarded. " +
        "Map data for Iceland is downloading (~20 min) — try again after."
    );
  });

  it("adds nothing for covered/blocked/unavailable, and nothing for no_map_data beyond its line", () => {
    const base = routeFallbackMessage("untrustworthy", null, germanT, "de");
    expect(routeFallbackMessage("untrustworthy", null, germanT, "de", { status: "covered" })).toBe(
      base
    );
    expect(routeFallbackMessage("untrustworthy", null, germanT, "de", { status: "blocked" })).toBe(
      base
    );
    expect(
      routeFallbackMessage("untrustworthy", null, germanT, "de", { status: "unavailable" })
    ).toBe(base);
    expect(
      routeFallbackMessage("untrustworthy", null, germanT, "de", { status: "no_map_data" })
    ).toBe(base + " Für diese Gegend sind keine Kartendaten verfügbar.");
    expect(
      routeFallbackMessage("untrustworthy", null, englishT, "en", { status: "no_map_data" })
    ).toBe(
      "The routing provider's answer did not fit the two places and was discarded. " +
        "No map data is available for this area."
    );
  });

  it("says nothing about a download when the answer names no region", () => {
    // "Map data for null is downloading" would be worse than today's message.
    const base = routeFallbackMessage("untrustworthy", null, germanT, "de");
    expect(
      routeFallbackMessage("untrustworthy", null, germanT, "de", {
        status: "started",
        region: null,
      })
    ).toBe(base);
    expect(routeFallbackMessage("untrustworthy", null, germanT, "de", { status: "started" })).toBe(
      base
    );
  });

  it("uses the ~25 min default when the answer carries no estimate", () => {
    expect(
      routeFallbackMessage("untrustworthy", null, germanT, "de", {
        status: "started",
        region: "Tennessee",
        etaMinutes: null,
      })
    ).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen. " +
        "Kartendaten für Tennessee werden gerade geladen (~25 Min.) – versuch es danach erneut."
    );
  });

  it("leaves a null/absent answer reading exactly as before the feature", () => {
    expect(routeFallbackMessage("untrustworthy", null, germanT, "de", null)).toBe(
      routeFallbackMessage("untrustworthy", null, germanT, "de")
    );
    expect(routeFallbackMessage("no_route", null, germanT, "de", undefined)).toBe(
      "Der Routing-Anbieter kennt keinen Weg zwischen diesen beiden Orten."
    );
  });
});
