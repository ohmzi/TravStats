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
import {
  COUNTER_WRAP_MAX_DAYS,
  GPS_ZERO_EPSILON,
  MISDATED_COUNTER_DAYS,
  MISDATED_COUNTER_WINDOW,
  MISDATED_MIN_NEIGHBOURS,
} from "./thresholds";
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

// ─── Misdated: the straggler check (§C.2, check 1) ───────────────────────────

const DAY_MS = 86_400_000;
/** An iPhone's DCIM counter runs 0000 … 9999. */
const COUNTER_SPAN = 10_000;
/** iPhone's `IMG_1234` (`IMG_E1234` for an edit). A dated Android `IMG_20310503_…` is not a counter. */
const IPHONE_COUNTER = /^IMG_E?(\d{4})(?!\d)/i;

/** The iPhone counter in a file name, or null. */
export function counterOf(fileName: string): number | null {
  const match = IPHONE_COUNTER.exec(fileName);
  return match ? Number(match[1]) : null;
}

interface Counted {
  photo: PhotoPoint;
  counter: number;
}

/** A counter belongs to one camera: one model's sequence says nothing about another's. */
const cameraOf = (p: PhotoPoint): string => `${p.make ?? ""}|${p.model ?? ""}`;

/** Only a photo that could otherwise move a station is judged; any photo may be a neighbour. */
const judged = (p: PhotoPoint): boolean => p.flags.located && !p.flags.duplicate;

/** The photos that have a counter, grouped by camera, each group sorted by counter. */
function byCamera(photos: readonly PhotoPoint[]): Map<string, Counted[]> {
  const cameras = new Map<string, Counted[]>();
  for (const photo of photos) {
    const counter = counterOf(photo.originalFileName);
    if (counter === null) continue;
    const members = cameras.get(cameraOf(photo)) ?? [];
    members.push({ photo, counter });
    cameras.set(cameraOf(photo), members);
  }
  for (const members of cameras.values()) members.sort((a, b) => a.counter - b.counter);
  return cameras;
}

/** The members with a counter in [lo, hi], from a list sorted by counter. */
function inCounterRange(members: readonly Counted[], lo: number, hi: number): Counted[] {
  let start = 0;
  let end = members.length;
  while (start < end) {
    const mid = (start + end) >> 1;
    if (members[mid].counter < lo) start = mid + 1;
    else end = mid;
  }
  const found: Counted[] = [];
  for (let i = start; i < members.length && members[i].counter <= hi; i += 1) {
    found.push(members[i]);
  }
  return found;
}

/**
 * A photo's counter neighbours: its camera's other photos within
 * ±MISDATED_COUNTER_WINDOW counter positions. Neighbours across the
 * 9999 → 0000 wrap count only when the photos are at most
 * COUNTER_WRAP_MAX_DAYS apart, because two phones of one model can sit at
 * the two ends of the counter at once.
 */
function counterNeighbours(members: readonly Counted[], target: Counted): Counted[] {
  const reach = MISDATED_COUNTER_WINDOW;
  const { counter } = target;
  const wrapped = [
    ...(counter - reach < 0
      ? inCounterRange(members, COUNTER_SPAN + counter - reach, COUNTER_SPAN - 1)
      : []),
    ...(counter + reach >= COUNTER_SPAN
      ? inCounterRange(members, 0, counter + reach - COUNTER_SPAN)
      : []),
  ].filter((n) => Math.abs(n.photo.tMs - target.photo.tMs) <= COUNTER_WRAP_MAX_DAYS * DAY_MS);
  return [...inCounterRange(members, counter - reach, counter + reach), ...wrapped].filter(
    (n) => n.photo.id !== target.photo.id
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The recipe's straggler check. A judged photo is flagged when it has at
 * least MISDATED_MIN_NEIGHBOURS counter neighbours, in the window or its
 * context days, and its instant lies more than MISDATED_COUNTER_DAYS from
 * their median.
 */
export function flagStragglers(
  photos: readonly PhotoPoint[],
  context: readonly PhotoPoint[]
): Set<string> {
  const cameras = byCamera([...photos, ...context]);
  const flagged = new Set<string>();
  for (const photo of photos) {
    const counter = counterOf(photo.originalFileName);
    if (counter === null || !judged(photo)) continue;
    const neighbours = counterNeighbours(cameras.get(cameraOf(photo)) ?? [], { photo, counter });
    if (neighbours.length < MISDATED_MIN_NEIGHBOURS) continue;
    const middle = median(neighbours.map((n) => n.photo.tMs));
    if (Math.abs(photo.tMs - middle) > MISDATED_COUNTER_DAYS * DAY_MS) flagged.add(photo.id);
  }
  return flagged;
}
