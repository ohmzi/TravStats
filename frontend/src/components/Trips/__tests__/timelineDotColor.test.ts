import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../../lib/tripTimelineEvents";
import { dotColor } from "../timelineDotColor";

type Kind = TimelineEvent["kind"];

const EXPECTED: Record<Kind, string> = {
  flight: "var(--domain-flight)",
  cruise: "var(--domain-cruise)",
  rail: "var(--domain-rail)",
  "rental-pickup": "var(--ts-domain-rental)",
  "rental-return": "var(--ts-domain-rental)",
  stop: "var(--domain-poi)",
  "place-visit": "var(--domain-poi)",
  journal: "var(--ts-info)",
  "lodging-checkin": "var(--domain-lodging)",
  "lodging-checkout": "var(--domain-lodging)",
};

describe("timeline dot colours", () => {
  it.each(Object.entries(EXPECTED))("%s reads %s", (kind, colour) => {
    expect(dotColor({ kind: kind as Kind })).toBe(colour);
  });

  it("reads a token for every kind, never a literal colour", () => {
    for (const kind of Object.keys(EXPECTED)) {
      expect(dotColor({ kind: kind as Kind })).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });
});
