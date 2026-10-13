import { describe, it, expect } from "vitest";

import { germanT } from "../../__tests__/helpers/germanT";
import { routeFallbackMessage } from "../routeFallbackCopy";

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

  it("leaves the reason standing alone when the server sent no numbers", () => {
    expect(routeFallbackMessage("untrustworthy", null, germanT, "de")).toBe(
      "Die Antwort des Routing-Anbieters passte nicht zu den beiden Orten und wurde verworfen."
    );
    expect(routeFallbackMessage("point_not_near_road", null, germanT, "de")).toBe(
      "Ein Ort liegt mehr als einen Kilometer von der nächsten Straße entfernt — Ort der Station prüfen."
    );
  });
});
