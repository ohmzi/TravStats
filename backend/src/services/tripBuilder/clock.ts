/**
 * One clock for every photo (spec 2026-10-09 §C.1).
 *
 * Immich's `localDateTime` is a true wall clock only when Immich knew the
 * zone (immich server metadata.service.ts:1020-1061). A screenshot without an
 * EXIF date gets its file time written as UTC, and a video is read as UTC.
 * So every asset gets a real instant t(p) and a zone z(p), and its wall clock
 * is read off those two:
 *
 * - case A, EXIF names a zone: `fileCreatedAt` is the instant;
 * - case B, no zone, and the asset looks like a file-time fallback (no camera
 *   make or model, or created = modified): `fileCreatedAt` is the instant;
 * - case C, no zone otherwise: `localDateTime` is the camera's naive wall
 *   clock, and t(p) = toInstant(wall, z(p)).
 *
 * The zone z(p) comes from the first rule that matches: 1 the zone of the
 * photo's own GPS fix; 2 an EXIF zone other than UTC; 3 the zone of the
 * nearest located photo within ZONE_NEIGHBOUR_H; 4 the dominant zone of the
 * photo's flight-bounded stretch (`areaZoneSpans`); 5 the home zone; 6 UTC.
 * Rules 3–6 borrow a zone, so the photo's day is a guess.
 *
 * Durations, ordering and the in-flight tests read t(p) alone. The local
 * strings serve days, nights and notes. Every zone conversion goes through
 * shared/time.
 */
import { machineInstant, toInstant, toLocal } from "../../shared/time/instant";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import { isValidZone } from "../../shared/time/zonedParts";
import { addDays } from "../../shared/tour/builderNightPlan";
import type { ImmichAssetDetail } from "../immich/types";
import { hasGps } from "./clean";
import { NIGHT_BOUNDARY_H, ZONE_NEIGHBOUR_H } from "./thresholds";
import type {
  ClockCase,
  ClockContext,
  Day,
  FlightAnchor,
  LocalMinute,
  PhotoPoint,
  ZoneSource,
  ZoneSpan,
} from "./types";

/** `YYYY-MM-DD HH:MM` of an instant on a zone's clock. The seconds are dropped, not rounded. */
export function localMinuteOf(tMs: number, zone: string): LocalMinute {
  return toLocal(new Date(tMs), zone).local.slice(0, 16).replace("T", " ");
}

/**
 * The night a photo belongs to: the day of local(p) − NIGHT_BOUNDARY_H,
 * worked out on the string alone. 00:00–03:59 is still the evening before,
 * so a night drive that arrives at 02:53 stays on the night it started.
 */
export function nightDayOf(local: LocalMinute): Day {
  const day = local.slice(0, 10);
  return Number(local.slice(11, 13)) < NIGHT_BOUNDARY_H ? addDays(day, -1) : day;
}

/** Minutes since local midnight: "2031-05-03 18:05" → 1085. */
export function minutesOfDay(local: LocalMinute): number {
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}

const HOUR_MS = 3_600_000;
const NEIGHBOUR_MS = ZONE_NEIGHBOUR_H * HOUR_MS;

// ─── Zone rule 2: what an EXIF `timeZone` names ──────────────────────────────

/** Immich's spellings of UTC itself — its video default, never a place's zone. */
const UTC_NAMES: ReadonlySet<string> = new Set(["UTC", "Etc/UTC", "Etc/GMT"]);
/** exiftool's offset names: `UTC`, `UTC+0`, `UTC-4`, `UTC+5:30`. */
const UTC_OFFSET = /^UTC(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/;
/**
 * The zones that keep a fractional offset. `isValidZone` refuses a raw
 * offset on purpose (shared/time/zonedParts.ts:51-58), so a `UTC±H:MM`
 * borrows the first zone here that shows that offset at t. Only that zone's
 * clock at that instant is read, never its place.
 */
const FRACTIONAL_OFFSET_ZONES = [
  "Pacific/Marquesas", // −09:30
  "America/St_Johns", // −03:30, −02:30 in summer
  "Asia/Tehran", // +03:30
  "Asia/Kabul", // +04:30
  "Asia/Kolkata", // +05:30
  "Asia/Kathmandu", // +05:45
  "Asia/Yangon", // +06:30
  "Australia/Eucla", // +08:45
  "Australia/Darwin", // +09:30
  "Australia/Adelaide", // +09:30, +10:30 in summer
  "Australia/Lord_Howe", // +10:30, +11:00 in summer
  "Pacific/Chatham", // +12:45, +13:45 in summer
];

/** `UTC±H[:MM]` as minutes east of UTC; null for anything else, an IANA name included. */
function utcOffsetMinutes(timeZone: string): number | null {
  const match = UTC_OFFSET.exec(timeZone);
  if (!match) return null;
  const [, sign, hours, minutes = "0"] = match;
  if (sign === undefined) return 0;
  const total = Number(hours) * 60 + Number(minutes);
  if (Number(minutes) > 59 || total > 14 * 60) return null;
  return sign === "-" ? -total : total;
}

/** The offset a zone shows at an instant, in minutes east of UTC. */
function offsetMinutesAt(tMs: number, zone: string): number {
  const offset = toLocal(new Date(tMs), zone).offset;
  const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6));
  return offset.startsWith("-") ? -minutes : minutes;
}

/**
 * Zone rule 2: the zone an EXIF `timeZone` names at t.
 * - an IANA name is used as it is;
 * - a whole-hour `UTC±H` becomes `Etc/GMT∓H` (POSIX signs: `Etc/GMT-12` is UTC+12);
 * - a fractional `UTC±H:MM` becomes the first of FRACTIONAL_OFFSET_ZONES that shows it at t.
 * Null for no zone, for UTC itself, and for a name this runtime does not know.
 */
export function exifZoneAt(timeZone: string | null, tMs: number): string | null {
  if (timeZone === null || UTC_NAMES.has(timeZone)) return null;
  const minutes = utcOffsetMinutes(timeZone);
  if (minutes === null) return isValidZone(timeZone) ? timeZone : null;
  if (minutes === 0) return null;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    const etc = `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
    return isValidZone(etc) ? etc : null;
  }
  return (
    FRACTIONAL_OFFSET_ZONES.find(
      (zone) => isValidZone(zone) && offsetMinutesAt(tMs, zone) === minutes
    ) ?? null
  );
}

// ─── The clock of one asset ──────────────────────────────────────────────────

/** Zone rules 3–6 borrow a zone, so the day is a guess. */
const BORROWED: ReadonlySet<ZoneSource> = new Set(["neighbour", "area", "home", "utc"]);

interface AssetRead {
  asset: ImmichAssetDetail;
  clockCase: ClockCase;
  /** Case C: the camera's naive wall clock. Null for cases A and B. */
  wall: string | null;
  /** Zone rule 1: the zone of the asset's own GPS fix. */
  gpsZone: string | null;
}

interface Clocked {
  tMs: number;
  zone: string;
  local: LocalMinute;
  source: ZoneSource;
}

const fileMsOf = (asset: ImmichAssetDetail): number => Date.parse(asset.fileCreatedAt);

/** §C.1's case. Case C needs a wall clock shared/time can read; without one only the file time is left. */
function clockCaseOf(asset: ImmichAssetDetail): ClockCase {
  if (asset.timeZone !== null) return "A";
  if (!asset.make && !asset.model) return "B";
  if (asset.fileModifiedAt !== null && asset.fileModifiedAt === asset.fileCreatedAt) return "B";
  return machineInstant(asset.localDateTime, "UTC") !== null ? "C" : "B";
}

/**
 * Reads an asset's clock case, its naive wall clock (case C only) and the
 * zone of its GPS fix. A zone lookup that cannot run at all throws
 * (zoneOf.ts:102-115). That is never read as "no zone": doing so is how local
 * clocks once came to be read as UTC.
 */
function readAsset(asset: ImmichAssetDetail): AssetRead {
  const clockCase = clockCaseOf(asset);
  const gps = hasGps(asset.lat, asset.lon) ? zoneOfCoordinates(asset.lat, asset.lon) : null;
  return {
    asset,
    clockCase,
    wall: clockCase === "C" ? asset.localDateTime : null,
    gpsZone: isValidZone(gps) ? gps : null,
  };
}

/**
 * Reads a wall clock (`T` or space form) as if it were UTC. The result can be
 * compared with another wall clock read the same way, never with an instant.
 */
function wallMsOf(local: string): number {
  return Date.parse(`${local.slice(0, 10)}T${local.slice(11, 16)}:00Z`);
}

/** t(p) in a zone: the file time for cases A and B, the naive clock through the zone for case C. */
function instantIn(read: AssetRead, zone: string): number {
  if (read.wall === null) return fileMsOf(read.asset);
  return machineInstant(read.wall, zone)?.getTime() ?? wallMsOf(read.wall);
}

/** The asset's instant and wall clock once its zone is known. */
function clockIn(read: AssetRead, zone: string, source: ZoneSource): Clocked {
  const tMs = instantIn(read, zone);
  // §C.1: an unlocated naive clock is its own wall clock; every other clock is read off the instant.
  const local =
    read.wall !== null && source !== "gps"
      ? `${read.wall.slice(0, 10)} ${read.wall.slice(11, 16)}`
      : localMinuteOf(tMs, zone);
  return { tMs, zone, local, source };
}

/** True when EXIF named a zone whose offset at t is not the GPS zone's. GPS wins, and the scan counts it. */
function exifDisagrees(read: AssetRead, clocked: Clocked): boolean {
  const exif = exifZoneAt(read.asset.timeZone, clocked.tMs);
  return (
    exif !== null &&
    offsetMinutesAt(clocked.tMs, exif) !== offsetMinutesAt(clocked.tMs, clocked.zone)
  );
}

// ─── Zone rules 3 and 4: borrowing a zone ────────────────────────────────────

interface Fix {
  key: number;
  zone: string;
}

/** The zone of the fix nearest `key`, within ZONE_NEIGHBOUR_H, from fixes sorted by key. */
function nearestZone(fixes: readonly Fix[], key: number): string | null {
  let lo = 0;
  let hi = fixes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid].key < key) lo = mid + 1;
    else hi = mid;
  }
  let best: Fix | null = null;
  for (const fix of [fixes[lo - 1], fixes[lo]]) {
    if (fix === undefined || Math.abs(fix.key - key) > NEIGHBOUR_MS) continue;
    if (best === null || Math.abs(fix.key - key) < Math.abs(best.key - key)) best = fix;
  }
  return best?.zone ?? null;
}

const inSpan = (span: ZoneSpan, ms: number): boolean => ms >= span.fromMs && ms < span.toMs;

/**
 * Zone rule 4. A naive clock has no instant yet. It takes the first span
 * whose own zone puts the clock inside that span; failing that, the span
 * that holds the clock read as UTC.
 */
function spanZone(spans: readonly ZoneSpan[], read: AssetRead): string | null {
  const wall = read.wall;
  if (wall === null) {
    const tMs = fileMsOf(read.asset);
    return spans.find((span) => inSpan(span, tMs))?.zone ?? null;
  }
  const consistent = spans.find((span) => inSpan(span, instantIn(read, span.zone)));
  return (consistent ?? spans.find((span) => inSpan(span, wallMsOf(wall))))?.zone ?? null;
}

/** Zone rules 2–6 for an asset with no GPS fix. */
function borrowedClock(
  read: AssetRead,
  ctx: ClockContext,
  byInstant: readonly Fix[],
  byWall: readonly Fix[]
): Clocked {
  if (read.clockCase === "A") {
    const exif = exifZoneAt(read.asset.timeZone, fileMsOf(read.asset));
    if (exif !== null) return clockIn(read, exif, "exif");
  }
  const neighbour =
    read.wall === null
      ? nearestZone(byInstant, fileMsOf(read.asset))
      : nearestZone(byWall, wallMsOf(read.wall));
  if (neighbour !== null) return clockIn(read, neighbour, "neighbour");
  const area = spanZone(ctx.areaZones, read);
  if (area !== null) return clockIn(read, area, "area");
  if (isValidZone(ctx.homeZone)) return clockIn(read, ctx.homeZone, "home");
  return clockIn(read, "UTC", "utc");
}

function toPhoto(read: AssetRead, clocked: Clocked): PhotoPoint {
  const { asset } = read;
  return {
    id: asset.id,
    type: asset.type,
    ownerId: asset.ownerId,
    visibility: asset.visibility,
    tMs: clocked.tMs,
    zone: clocked.zone,
    local: clocked.local,
    day: clocked.local.slice(0, 10),
    nightDay: nightDayOf(clocked.local),
    lat: asset.lat,
    lon: asset.lon,
    city: asset.city,
    state: asset.state,
    country: asset.country,
    make: asset.make,
    model: asset.model,
    originalFileName: asset.originalFileName,
    isFavorite: asset.isFavorite,
    duplicateId: asset.duplicateId,
    flags: {
      clockCase: read.clockCase,
      zoneSource: clocked.source,
      dayGuessed: BORROWED.has(clocked.source),
      exifZoneOverridden: clocked.source === "gps" && exifDisagrees(read, clocked),
      located: false,
      duplicate: false,
      misdated: null,
      atSea: false,
      inFlight: false,
      layover: false,
    },
  };
}

/**
 * Every asset with its instant, zone and wall clock (§C.1), sorted by
 * instant. Sets the clock flags. Every movement flag starts off;
 * `cleanAssets` and the later steps set them.
 */
export function clockAssets(assets: readonly ImmichAssetDetail[], ctx: ClockContext): PhotoPoint[] {
  const reads = assets.map(readAsset);
  const located = new Map<AssetRead, Clocked>();
  for (const read of reads) {
    if (read.gpsZone !== null) located.set(read, clockIn(read, read.gpsZone, "gps"));
  }
  // Rule 3 finds a neighbour by instant. A naive clock has no instant yet, so it searches by wall clock.
  const fixes = [...located.values()];
  const byInstant = fixes.map((c) => ({ key: c.tMs, zone: c.zone })).sort((a, b) => a.key - b.key);
  const byWall = fixes
    .map((c) => ({ key: wallMsOf(c.local), zone: c.zone }))
    .sort((a, b) => a.key - b.key);
  return reads
    .map((read) => toPhoto(read, located.get(read) ?? borrowedClock(read, ctx, byInstant, byWall)))
    .sort((a, b) => a.tMs - b.tMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ─── Zone rule 4's spans ─────────────────────────────────────────────────────

/** Where rule 4 cuts time at a flight: its departure, or noon of its departure day on the airport's clock. */
function cutMsOf(anchor: FlightAnchor): number {
  if (anchor.precise && anchor.depMs !== null) return anchor.depMs;
  const zone = isValidZone(anchor.depZone) ? anchor.depZone : "UTC";
  return toInstant(`${anchor.depDay}T12:00`, zone, { origin: "machine" }).utc.getTime();
}

/** The zone most fixes carry. On a tie, the zone that reached that count first. */
function dominantZone(zones: readonly string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const zone of zones) {
    const count = (counts.get(zone) ?? 0) + 1;
    counts.set(zone, count);
    if (best === null || count > (counts.get(best) ?? 0)) best = zone;
  }
  return best;
}

const validZoneOrNull = (zone: string | null | undefined): string | null =>
  isValidZone(zone) ? zone : null;

/**
 * Zone rule 4. The clock runs before any area exists, so the rule is built
 * on flights instead. Time is cut at every flight, and each stretch carries
 * the zone most of its located photos show. A stretch without such photos
 * takes the zone the flight before it landed in, or failing that, the zone
 * the flight after it leaves from. A stretch with none of these is left out.
 * The first stretch starts at −∞ and the last one ends at +∞.
 */
export function areaZoneSpans(
  assets: readonly ImmichAssetDetail[],
  anchors: readonly FlightAnchor[]
): ZoneSpan[] {
  const fixes = assets
    .map(readAsset)
    .flatMap((read) =>
      read.gpsZone === null ? [] : [{ tMs: instantIn(read, read.gpsZone), zone: read.gpsZone }]
    )
    .sort((a, b) => a.tMs - b.tMs);
  const cuts = anchors
    .map((anchor) => ({ anchor, cutMs: cutMsOf(anchor) }))
    .sort((a, b) => a.cutMs - b.cutMs);
  const bounds = [
    Number.NEGATIVE_INFINITY,
    ...cuts.map((cut) => cut.cutMs),
    Number.POSITIVE_INFINITY,
  ];
  const spans: ZoneSpan[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const fromMs = bounds[i];
    const toMs = bounds[i + 1];
    if (fromMs >= toMs) continue;
    const inside = fixes
      .filter((fix) => fix.tMs >= fromMs && fix.tMs < toMs)
      .map((fix) => fix.zone);
    const zone =
      dominantZone(inside) ??
      validZoneOrNull(cuts[i - 1]?.anchor.arrZone) ??
      validZoneOrNull(cuts[i]?.anchor.depZone);
    if (zone !== null) spans.push({ fromMs, toMs, zone });
  }
  return spans;
}
