import type { RoadtripPhase } from "./roadtrip/roadtripView";

/**
 * The colour the status pill beside a detail page's title carries, or `null`
 * for a phase that draws NO pill.
 *
 * The roadtrip detail page and the flight journey page answer the same
 * question — is this ahead, happening, or over — with the same `roadtripPhase`
 * fold, so which phases earn a pill, and its colour, is decided here once and
 * read by both. The WORDING stays with each page: "On the road · day 3 of 12"
 * measures a roadtrip, while a journey says only "Underway".
 *
 * PLANNED is `info`, UNDERWAY is `good`, and PAST and UNDATED draw nothing —
 * that is the roadtrip page's own rule (the reference the owner pointed at),
 * and the journey page now follows it. The journey page used to add a grey
 * "PAST" pill the roadtrip page has never had; a difference the owner can see
 * is one he asks about again, and the reference shows none (owner, 2026-10-08).
 * A past roadtrip already read its state from "10/27 – 11/10/2023" in the
 * subtitle, and a past journey reads it from its own date span.
 */
export function phasePillColor(phase: RoadtripPhase): string | null {
  if (phase === "planned") return "var(--ts-info)";
  if (phase === "underway") return "var(--ts-good)";
  return null;
}
