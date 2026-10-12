/**
 * Who wrote a trip's summary (forgejo#132 item 8). The summarize route and a
 * person both write `Trip.summary`; these three columns say which, and for the
 * model's text when and from how many entries — the design's "maschinell · aus
 * n Einträgen · Datum". NULL in all three is "unknown", which is what every
 * summary written before the columns existed stays: it may have been either.
 *
 * The roadtrip's own summary (spec 2026-10-12 §6) carries the same two
 * columns on `trip_routes`, written by its regenerate route alone — nobody
 * types a roadtrip summary, so nothing there ever says "user".
 */
import { now } from "../shared/time/clock";

export interface SummaryProvenance {
  summarySource: "llm" | "user" | null;
  summaryGeneratedAt: Date | null;
  summaryEntryCount: number | null;
}

const NONE: SummaryProvenance = {
  summarySource: null,
  summaryGeneratedAt: null,
  summaryEntryCount: null,
};

/** The model wrote it now, from `entryCount` entries. */
export function llmProvenance(entryCount: number, at: Date = new Date()): SummaryProvenance {
  return { summarySource: "llm", summaryGeneratedAt: at, summaryEntryCount: entryCount };
}

/* ─────────── the roadtrip's own summary (spec 2026-10-12 §6) ─────────── */

/**
 * The roadtrip's provenance: the two columns `trip_routes` gained, written by
 * its regenerate route alone — nobody types a roadtrip summary, so nothing
 * there ever says "user". There is no entry-count column, which is why
 * `llmProvenance`'s third field has no twin and this is the whole of it.
 */
export interface RoadtripSummaryProvenance {
  summarySource: "llm";
  summaryGeneratedAt: Date;
}

/** The model wrote it now; the shared clock, so a test can pin the instant. */
export function roadtripLlmProvenance(at: Date = now()): RoadtripSummaryProvenance {
  return { summarySource: "llm", summaryGeneratedAt: at };
}

/**
 * The provenance a create or PATCH writes alongside `summary`, or nothing.
 *
 * Only a CHANGED text is a person's: the trip form sends every field on save,
 * so a model's summary sent back untouched with a new trip name must stay the
 * model's — and an unknown one must stay unknown rather than become "user".
 * An emptied summary takes its provenance with it.
 */
export function provenanceForWrite(
  next: string | null | undefined,
  stored: string | null
): Partial<SummaryProvenance> {
  if (next === undefined || next === stored) return {};
  if (next === null || next.trim() === "") return NONE;
  return { ...NONE, summarySource: "user" };
}
