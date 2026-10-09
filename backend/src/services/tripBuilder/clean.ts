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
import { isLocalDate, toDbDate } from "../../shared/time/localDate";
import {
  AT_SEA_BUFFER_KM,
  AT_SEA_RING_POINTS,
  COUNTER_WRAP_MAX_DAYS,
  GPS_ZERO_EPSILON,
  MISDATED_COUNTER_DAYS,
  MISDATED_COUNTER_WINDOW,
  MISDATED_FILENAME_H,
  MISDATED_LOOKUPS,
  MISDATED_MIN_NEIGHBOURS,
} from "./thresholds";
import type {
  CleanResult,
  CountryAt,
  ExcludedCounts,
  FileNameLookup,
  MisdatedReason,
  PhotoFlags,
  PhotoPoint,
  ScanWindow,
} from "./types";
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

// ─── Misdated: the filename clock check (§C.2, check 3) ──────────────────────

const HOUR_MS = 3_600_000;
/** Samsung's camera writes the local wall clock into the name: `20310503_142233.jpg`. */
const SAMSUNG_STAMP = /^(\d{8})_(\d{6})/;
/** Pixel's camera writes UTC into the name: `PXL_20310503_022233456.jpg`. */
const PIXEL_STAMP = /^PXL_(\d{8})_(\d{6})/;

/** A `YYYYMMDD` + `HHMMSS` stamp as a wall clock read as UTC; null when it names no real time. */
function stampMs(ymd: string, hms: string): number | null {
  const day = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const [hour, minute, second] = [hms.slice(0, 2), hms.slice(2, 4), hms.slice(4, 6)].map(Number);
  if (!isLocalDate(day) || hour > 23 || minute > 59 || second > 59) return null;
  return toDbDate(day).getTime() + ((hour * 60 + minute) * 60 + second) * 1000;
}

/** A photo's `local` read as UTC — the same arithmetic form as a Samsung stamp. */
const localAsUtcMs = (local: string): number => Date.parse(`${local.replace(" ", "T")}:00Z`);

/**
 * Flags a photo whose camera wrote a clock into the file name that differs
 * from the photo's own by more than MISDATED_FILENAME_H. A Samsung name is
 * compared with local(p); a Pixel name, which is UTC, with t(p). A photo
 * flagged here was re-dated somewhere along the way.
 */
export function flagFilenameClocks(photos: readonly PhotoPoint[]): Set<string> {
  const flagged = new Set<string>();
  for (const photo of photos) {
    if (!judged(photo)) continue;
    const pixel = PIXEL_STAMP.exec(photo.originalFileName);
    const stamp = pixel ?? SAMSUNG_STAMP.exec(photo.originalFileName);
    if (!stamp) continue;
    const namedMs = stampMs(stamp[1], stamp[2]);
    const actualMs = pixel ? photo.tMs : localAsUtcMs(photo.local);
    if (namedMs !== null && Math.abs(namedMs - actualMs) > MISDATED_FILENAME_H * HOUR_MS) {
      flagged.add(photo.id);
    }
  }
  return flagged;
}

// ─── Misdated: the batch check (§C.2, check 2) and all three together ────────

interface CounterRun {
  camera: string;
  members: Counted[];
}

/**
 * The window's photos that have a counter, grouped by camera and cut where
 * consecutive counters are more than MISDATED_COUNTER_WINDOW apart.
 */
function counterRuns(photos: readonly PhotoPoint[]): CounterRun[] {
  const runs: CounterRun[] = [];
  for (const [camera, members] of byCamera(photos)) {
    let current: Counted[] = [];
    for (const member of members) {
      const last = current[current.length - 1];
      if (last !== undefined && member.counter - last.counter > MISDATED_COUNTER_WINDOW) {
        runs.push({ camera, members: current });
        current = [];
      }
      current.push(member);
    }
    if (current.length > 0) runs.push({ camera, members: current });
  }
  return runs;
}

/** The nearest counter below `counter`, within MISDATED_COUNTER_WINDOW, that is not in the run. */
function nearestBelow(
  members: readonly Counted[],
  counter: number,
  run: ReadonlySet<string>
): Counted | null {
  const found = inCounterRange(members, counter - MISDATED_COUNTER_WINDOW, counter - 1);
  return found.filter((n) => !run.has(n.photo.id)).pop() ?? null;
}

/** The nearest counter above `counter`, within MISDATED_COUNTER_WINDOW, that is not in the run. */
function nearestAbove(
  members: readonly Counted[],
  counter: number,
  run: ReadonlySet<string>
): Counted | null {
  const found = inCounterRange(members, counter + 1, counter + MISDATED_COUNTER_WINDOW);
  return found.find((n) => !run.has(n.photo.id)) ?? null;
}

/** The fragment `searchByFileName` is asked for a counter: `IMG_` and its first two digits (`IMG_73`). */
const lookupFragment = (counter: number): string =>
  `IMG_${String(counter).padStart(4, "0").slice(0, 2)}`;

/** `lookup` limited to the scan's budget of MISDATED_LOOKUPS calls, asking each fragment only once. */
function budgeted(lookup: FileNameLookup): FileNameLookup {
  const answers = new Map<string, readonly PhotoPoint[]>();
  let spent = 0;
  return async (fragment) => {
    const known = answers.get(fragment);
    if (known !== undefined) return known;
    if (spent >= MISDATED_LOOKUPS) return [];
    spent += 1;
    const found = await lookup(fragment);
    answers.set(fragment, found);
    return found;
  };
}

/**
 * The batch check. A batch re-stamped weeks after it was taken is its own
 * majority, so the straggler check cannot see it.
 *
 * - For each run it finds the counter predecessor, and then the successor.
 *   Each comes from the context first, else from the budgeted lookup of the
 *   counter just outside the run; only the same owner's same camera counts.
 * - The whole run is misdated when both exist, they lie within
 *   MISDATED_COUNTER_DAYS of each other, and the run's median instant lies
 *   more than MISDATED_COUNTER_DAYS outside them.
 * - The smallest runs go first. A batch is smaller than the trip's own run,
 *   whose edge neighbours also cost lookups and never flag it.
 * - A run that touches 0000 or 9999 is not judged.
 */
async function flagBatches(
  photos: readonly PhotoPoint[],
  context: readonly PhotoPoint[],
  lookup: FileNameLookup
): Promise<Set<string>> {
  const ask = budgeted(lookup);
  const contextCameras = byCamera(context);
  const limitMs = MISDATED_COUNTER_DAYS * DAY_MS;
  const flagged = new Set<string>();
  const runs = counterRuns(photos).sort((a, b) => a.members.length - b.members.length);
  for (const run of runs) {
    if (!run.members.some((m) => judged(m.photo))) continue;
    const ids = new Set(run.members.map((m) => m.photo.id));
    const first = run.members[0];
    const last = run.members[run.members.length - 1];
    const known = contextCameras.get(run.camera) ?? [];
    const asked = async (counter: number): Promise<Counted[]> => {
      const found = await ask(lookupFragment(counter));
      const same = found.filter(
        (p) => p.ownerId === first.photo.ownerId && cameraOf(p) === run.camera
      );
      return byCamera(same).get(run.camera) ?? [];
    };
    const before =
      nearestBelow(known, first.counter, ids) ??
      (first.counter > 0 ? nearestBelow(await asked(first.counter - 1), first.counter, ids) : null);
    if (before === null) continue;
    const after =
      nearestAbove(known, last.counter, ids) ??
      (last.counter < COUNTER_SPAN - 1
        ? nearestAbove(await asked(last.counter + 1), last.counter, ids)
        : null);
    if (after === null) continue;
    const lo = Math.min(before.photo.tMs, after.photo.tMs);
    const hi = Math.max(before.photo.tMs, after.photo.tMs);
    const middle = median(run.members.map((m) => m.photo.tMs));
    if (hi - lo > limitMs || (middle >= lo - limitMs && middle <= hi + limitMs)) continue;
    for (const member of run.members) {
      if (judged(member.photo)) flagged.add(member.photo.id);
    }
  }
  return flagged;
}

/**
 * Every in-window photo kept out of movement because of its date (§C.2),
 * with the first check that caught it: straggler, then batch, then filename
 * clock. `lookup` is called at most MISDATED_LOOKUPS times. A lookup that
 * throws fails the scan rather than quietly judging fewer photos.
 */
export async function flagMisdated(
  photos: readonly PhotoPoint[],
  context: readonly PhotoPoint[],
  lookup: FileNameLookup
): Promise<Map<string, MisdatedReason>> {
  const reasons = new Map<string, MisdatedReason>();
  const add = (ids: ReadonlySet<string>, reason: MisdatedReason): void => {
    for (const id of ids) {
      if (!reasons.has(id)) reasons.set(id, reason);
    }
  };
  add(flagStragglers(photos, context), "straggler");
  add(await flagBatches(photos, context, lookup), "batch");
  add(flagFilenameClocks(photos), "filenameClock");
  return reasons;
}

// ─── At sea (§C.2) ───────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * `points` points `km` from (lat, lon), spaced evenly round from due north.
 * Longitudes stay within ±180° when the ring crosses the antimeridian.
 */
export function ringAround(
  lat: number,
  lon: number,
  km: number,
  points: number
): Array<{ lat: number; lon: number }> {
  const angle = km / EARTH_RADIUS_KM;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  return Array.from({ length: points }, (_, i) => {
    const bearing = (2 * Math.PI * i) / points;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angle) + Math.cos(lat1) * Math.sin(angle) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angle) * Math.cos(lat1),
        Math.cos(angle) - Math.sin(lat1) * Math.sin(lat2)
      );
    return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
  });
}

/**
 * A photo is at sea when there is no country at it and none at any of the
 * AT_SEA_RING_POINTS points AT_SEA_BUFFER_KM round it. The ring is the
 * buffer the 1:10m coastline needs, because a harbour-front photo can fall
 * just outside its country's polygon. Only located photos are asked. An
 * at-sea photo leaves the clusters but stays in the album, as ferry and
 * night evidence.
 */
export function flagAtSea(photos: readonly PhotoPoint[], countryAt: CountryAt): Set<string> {
  const atSea = new Set<string>();
  for (const photo of photos) {
    if (!photo.flags.located || photo.lat === null || photo.lon === null) continue;
    if (countryAt(photo.lat, photo.lon) !== null) continue;
    const ring = ringAround(photo.lat, photo.lon, AT_SEA_BUFFER_KM, AT_SEA_RING_POINTS);
    if (ring.every((point) => countryAt(point.lat, point.lon) === null)) atSea.add(photo.id);
  }
  return atSea;
}
