/**
 * Which photos the trip builder reads, and which of them may move a station
 * (spec 2026-10-09 §C.2, decision 8).
 *
 * One fetch gives two lists. The ALBUM is every own photo and video whose
 * own day lies in [S, E]: with or without GPS, archived, duplicated,
 * misdated, airborne or at sea — what the user took on the trip. MOVEMENT is
 * the part of it that may place a station: located, one copy per Immich
 * duplicate group, and not flagged by `flagMisdated`, `flagAtSea` or the
 * flight steps. A partner's photos and the hidden motion half of a Live
 * Photo are in neither.
 *
 * Pure. The one impure input, `flagMisdated`'s filename lookup, is injected.
 */
import { GPS_ZERO_EPSILON } from "./thresholds";
import type { CleanResult, ExcludedCounts, PhotoFlags, PhotoPoint, ScanWindow } from "./types";
import { inWindow } from "./window";

/** GPS present, on the globe, and not the 0,0 that means "none" (within GPS_ZERO_EPSILON). */
export function hasGps(lat: number | null, lon: number | null): boolean {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return Math.abs(lat) >= GPS_ZERO_EPSILON || Math.abs(lon) >= GPS_ZERO_EPSILON;
}

/** May this photo place or stretch a station? */
export function isMovementPhoto(p: PhotoPoint): boolean {
  const f = p.flags;
  return f.located && !f.duplicate && f.misdated === null && !f.atSea && !f.inFlight && !f.layover;
}

/** The photos with each patch merged into its photo's flags; an unpatched photo comes back as it was. */
export function markPhotos(
  photos: readonly PhotoPoint[],
  patches: ReadonlyMap<string, Partial<PhotoFlags>>
): PhotoPoint[] {
  return photos.map((p) => {
    const patch = patches.get(p.id);
    return patch ? { ...p, flags: { ...p.flags, ...patch } } : p;
  });
}

/** By instant; the id breaks a tie, so the order never depends on Immich's paging. */
function byTime(a: PhotoPoint, b: PhotoPoint): number {
  if (a.tMs !== b.tMs) return a.tMs - b.tMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Marks every copy of an Immich duplicate group as `duplicate` except one.
 * The one kept is the first located copy by instant, or the first copy if
 * none is located, so a group never loses the one GPS fix it has. It writes
 * into the fresh copies `cleanAssets` made, already sorted by instant.
 */
function markDuplicates(photos: readonly PhotoPoint[]): void {
  const keepers = new Map<string, PhotoPoint>();
  for (const p of photos) {
    if (p.duplicateId === null) continue;
    const kept = keepers.get(p.duplicateId);
    if (kept === undefined || (!kept.flags.located && p.flags.located)) {
      keepers.set(p.duplicateId, p);
    }
  }
  for (const p of photos) {
    if (p.duplicateId !== null) p.flags.duplicate = keepers.get(p.duplicateId) !== p;
  }
}

/**
 * Splits one fetch into the trip's photos and their context (§C.2). Assets
 * are excluded in this order: a partner's asset, then a hidden Live Photo
 * half, then the photo's own day. An asset with no owner id cannot be shown
 * to be the caller's, so it counts as a partner's: the album must never take
 * someone else's photo. Nothing it is given is changed.
 */
export function cleanAssets(
  photos: readonly PhotoPoint[],
  opts: { ownerId: string; window: ScanWindow }
): CleanResult {
  const excluded: ExcludedCounts = {
    partner: 0,
    hiddenLivePart: 0,
    misdated: 0,
    inFlight: 0,
    atSea: 0,
    unlocated: 0,
    dayGuessed: 0,
  };
  const inside: PhotoPoint[] = [];
  const context: PhotoPoint[] = [];
  for (const p of photos) {
    if (p.ownerId !== opts.ownerId) {
      excluded.partner += 1;
      continue;
    }
    if (p.visibility === "hidden") {
      excluded.hiddenLivePart += 1;
      continue;
    }
    const flags = { ...p.flags, located: hasGps(p.lat, p.lon), duplicate: false };
    (inWindow(p.day, opts.window) ? inside : context).push({ ...p, flags });
  }
  inside.sort(byTime);
  context.sort(byTime);
  markDuplicates(inside);
  markDuplicates(context);
  for (const p of inside) {
    if (!p.flags.located) excluded.unlocated += 1;
    if (p.flags.dayGuessed) excluded.dayGuessed += 1;
  }
  return { photos: inside, context, albumAssetIds: inside.map((p) => p.id), excluded };
}
