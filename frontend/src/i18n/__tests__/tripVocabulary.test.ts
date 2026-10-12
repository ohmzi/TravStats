import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import deCommon from "../resources/de/common.json";
import deDashboard from "../resources/de/dashboard.json";
import deRental from "../resources/de/rental.json";
import deRoadtrips from "../resources/de/roadtrips.json";
import deSettings from "../resources/de/settings.json";
import deTripBuilder from "../resources/de/tripBuilder.json";
import deTrips from "../resources/de/trips.json";
import enAdmin from "../resources/en/admin.json";
import enCommon from "../resources/en/common.json";
import enDashboard from "../resources/en/dashboard.json";
import enRental from "../resources/en/rental.json";
import enRoadtrips from "../resources/en/roadtrips.json";
import enSettings from "../resources/en/settings.json";
import enTripBuilder from "../resources/en/tripBuilder.json";
import enTrips from "../resources/en/trips.json";

/**
 * The vocabulary of the shared template (design 2026-10-12 §7): the top level
 * is a Journey, the nested car entry a **Trip** — so no surface may still say
 * Roadtrip for the nested entry. This guard is the sweep's proof and its
 * ratchet: it walks EVERY string value of both resource trees.
 *
 * A value may still say the word in exactly four places, and for reasons that
 * are not the entity's name:
 * - `whatsNew.json` — historic release notes; rewriting them would falsify
 *   what shipped.
 * - `xlsx.json` — the spreadsheet's sheet and column names are a data
 *   contract (an export from before the rename must still read back), and the
 *   journey sheet is already called "Trips".
 * - `roadtrips.json` `kind.*` and `review.*` — the DB-level kind (`roadtrip`
 *   vs `tour`) and the 2.7 review that assigns it: the genuinely semantic
 *   string family the sweep leaves untouched.
 * - `tripBuilder.json` `timeline.roadtrip`, `review.area.kinds.roadtrip`,
 *   `review.stopovers.roadtrip` — the same kind axis inside the builder.
 *
 * The set of files that still carry the word is compared per locale too:
 * losing a file's last kept occurrence in one locale drops that locale's file
 * out of the list and fails this suite until the list below is edited
 * deliberately.
 */

const RESOURCES = path.resolve(__dirname, "..", "resources");
const LOCALES = ["de", "en"] as const;
const MATCH = /road\s?trips?/i;

/** File base name → the key paths (or "*", every key) allowed to keep the word. */
const KEPT: Record<string, "*" | readonly string[]> = {
  "whatsNew.json": "*",
  "xlsx.json": "*",
  "roadtrips.json": [
    "kind.roadtrip",
    "review.intro",
    "review.isNow.roadtrip",
    "review.moveTo.roadtrip",
  ],
  "tripBuilder.json": [
    "timeline.roadtrip",
    "review.area.kinds.roadtrip",
    "review.stopovers.roadtrip",
  ],
};

function collectedHits(): Record<string, string[]> {
  const hits: Record<string, string[]> = {};
  for (const locale of LOCALES) {
    const dir = path.join(RESOURCES, locale);
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as unknown;
      const found: string[] = [];
      const walk = (node: unknown, keyPath: string): void => {
        if (typeof node === "string") {
          if (MATCH.test(node)) found.push(keyPath);
          return;
        }
        if (node !== null && typeof node === "object") {
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            walk(value, keyPath ? `${keyPath}.${key}` : key);
          }
        }
      };
      walk(json, "");
      if (found.length > 0) hits[`${locale}/${file}`] = found.sort();
    }
  }
  return hits;
}

describe("the trip vocabulary (design 2026-10-12 §7)", () => {
  const hits = collectedHits();

  it("leaves no Roadtrip outside the kind, history and spreadsheet exceptions", () => {
    const unexpected: string[] = [];
    for (const [entry, keys] of Object.entries(hits)) {
      const allowed = KEPT[entry.split("/")[1]];
      if (allowed === undefined) unexpected.push(...keys.map((key) => `${entry}:${key}`));
      else if (allowed !== "*") {
        unexpected.push(
          ...keys.filter((key) => !allowed.includes(key)).map((key) => `${entry}:${key}`)
        );
      }
    }
    expect(
      unexpected,
      `Roadtrip copy left outside the allow-list (${unexpected.length}):\n${unexpected.join("\n")}`
    ).toEqual([]);
  });

  it("keeps every allowed occurrence, so the allow-list cannot rot silently", () => {
    const expected = LOCALES.flatMap((l) => Object.keys(KEPT).map((f) => `${l}/${f}`)).sort();
    expect(Object.keys(hits).sort()).toEqual(expected);
  });

  it("names the nested entity Trip in both locales' own surfaces", () => {
    expect(enRoadtrips.pageTitle).toBe("Trips");
    expect(deRoadtrips.pageTitle).toBe("Trips");
    expect(enCommon.domain.roadtrip).toBe("Trips");
    expect(deCommon.domain.roadtrip).toBe("Trips");
    expect(enDashboard.tabStrip.tabs.roadtrip).toBe("Trips");
    expect(deDashboard.tabStrip.tabs.roadtrip).toBe("Trips");
  });

  it("names the parent a journey, in the roadtrip's own link back", () => {
    // "Part of the trip “{{name}}”" named the parent with the word the nested
    // entity now carries; only EN said it that way (DE already said "Reise").
    expect(enRoadtrips.inTrip).toBe("Part of the journey “{{name}}”");
    expect(deRoadtrips.inTrip).toBe("Teil der Reise „{{name}}“");
  });

  it("names the parent a journey wherever the two levels share a surface", () => {
    // Fix round 1: renaming the nested entity made every EN string that still
    // called the parent "trip" read as if it named the nested one — the rental
    // banner offering both links in one card, the entry picker, the builder's
    // review and problems list, and the settings that configure the journey.
    // DE always said "Reise" for the parent; these pins hold EN to the same
    // two-level split and pin the nested side that must NOT move.
    expect(enRental.suggest.trip).toBe("Fits the journey “{{name}}”.");
    expect(enRental.suggest.linkTrip).toBe("Link to the journey");
    expect(enTrips.addExisting.attachTimeout).toBe(
      "The server did not answer in time. Whether the entry was added is unknown – close the dialog and check the journey."
    );
    expect(enTrips.addExisting.failure.notFound).toBe(
      "The entry or the journey no longer exists. Reload the page."
    );
    expect(enTrips.addExisting.failure.conflict).toBe(
      "This entry cannot be moved to another journey."
    );
    expect(enTripBuilder.page.title).toBe("Journey from photos");
    expect(enTripBuilder.review.problems.blankTripName).toBe("Give the journey a name.");
    expect(enTripBuilder.review.header.name).toBe("Journey name");
    expect(enTripBuilder.review.titleNew).toBe("Review your journey");
    expect(enSettings.groups.trips).toBe("Journeys");
    expect(enAdmin.instance.fields.betaFeatures.features.roadtrips.what).toContain("on a journey");
    // The nested side of the same pairs, which the sweep already set right.
    expect(enTrips.addExisting.failure.roadtripPhotos).toBe(
      "This trip's stations hold photos of its current journey, so it cannot be moved from here."
    );
    expect(enTripBuilder.review.area.name).toBe("Trip name");
    expect(enTripBuilder.timeline.open).toBe("Open trip");
    // DE is the oracle for the split and keeps it.
    expect(deRental.suggest.trip).toBe("Passt zur Reise „{{name}}“.");
    expect(deTripBuilder.page.title).toBe("Reise aus Fotos");
    expect(deSettings.groups.trips).toBe("Reisen");
  });

  it("lands the Tours→Trips rename: the tab key is trips, tours is gone", () => {
    const enTabs = (enTrips as { detail: { tabs: Record<string, unknown> } }).detail.tabs;
    const deTabs = (deTrips as { detail: { tabs: Record<string, unknown> } }).detail.tabs;
    expect(enTabs.trips).toBe("Trips");
    expect(deTabs.trips).toBe("Trips");
    expect("tours" in enTabs).toBe(false);
    expect("tours" in deTabs).toBe(false);
  });
});
