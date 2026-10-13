import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { formatBytes } from "../../lib/fileSize";

/**
 * The facts the open photo's details show, in Immich's own info-panel spirit.
 *
 * Every field is optional: what the proxy did not serve (an imported copy has
 * no EXIF block, a picture without a lens in its metadata) simply does not
 * render a row — nothing is invented, and an empty panel says so.
 *
 * `albumId` is the one non-display field: it, plus the owner-configured Immich
 * web URL, is what the viewer's "Open in Immich" link is built from. It is only
 * set for a live asset of a linked album — a locally uploaded photo has no
 * Immich twin to open.
 */
export interface PhotoDetails {
  albumName?: string | null;
  albumId?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  takenAt?: string | null;
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  focalLength?: number | null;
  fNumber?: number | null;
  exposureTime?: string | null;
  iso?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Whether an instant is a capture time at all.
 *
 * The backend stores the epoch as its "Immich sent no date" marker
 * (`NO_CAPTURE_TIME` in `immichClient.ts`), so a 1970 timestamp is the absence
 * of a date, not a 1970 photograph.
 */
function hasCaptureTime(iso: string): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms !== 0;
}

/** Join the parts a camera actually sent, so "Kestrel" alone or "K1 Pro" alone both read well. */
function join(parts: Array<string | null | undefined>, separator: string): string | null {
  const present = parts.filter((part): part is string => typeof part === "string" && part !== "");
  return present.length > 0 ? present.join(separator) : null;
}

function DetailRow({ label, value }: { label: string; value: string | null }): JSX.Element | null {
  if (value === null) return null;
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words" style={{ color: "var(--text-primary)" }}>
        {value}
      </dd>
    </div>
  );
}

/** The open photo's metadata, laid out like Immich's info panel. */
export default function PhotoDetailsPanel({ details }: { details?: PhotoDetails }): JSX.Element {
  const { t, i18n } = useTranslation("immich");
  // The app's one date/time formatter: it reads the user's chosen date format
  // and profile zone (ADR 0002 Q1) rather than whatever zone the reader's
  // browser happens to sit in.
  const fmt = useDisplayFormat();
  const d = details ?? {};

  const taken = d.takenAt && hasCaptureTime(d.takenAt) ? fmt.dateTime(d.takenAt) : null;
  const place = join([d.city, d.state, d.country], ", ");
  const coordinates =
    d.lat !== null && d.lat !== undefined && d.lon !== null && d.lon !== undefined
      ? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`
      : null;
  const size =
    d.sizeBytes !== null && d.sizeBytes !== undefined
      ? formatBytes(d.sizeBytes, i18n.language)
      : null;
  const dimensions =
    d.width !== null && d.width !== undefined && d.height !== null && d.height !== undefined
      ? `${d.width} × ${d.height}`
      : null;
  const camera = join([d.make, d.model], " ");
  const focalLength =
    d.focalLength !== null && d.focalLength !== undefined ? `${d.focalLength} mm` : null;
  const aperture = d.fNumber !== null && d.fNumber !== undefined ? `f/${d.fNumber}` : null;
  const exposure = d.exposureTime ? `${d.exposureTime} s` : null;
  const iso = d.iso !== null && d.iso !== undefined ? String(d.iso) : null;

  // `||`, not `??`: an empty string from the wire is an absent value here.
  const album = d.albumName || null;
  const filename = d.filename || null;
  const mimeType = d.mimeType || null;
  const lens = d.lensModel || null;

  const rows: Array<[string, string | null]> = [
    [t("gallery.taken"), taken],
    [t("gallery.place"), place],
    [t("gallery.coordinates"), coordinates],
    [t("gallery.album"), album],
    [t("gallery.filename"), filename],
    [t("gallery.format"), mimeType],
    [t("gallery.fileSize"), size],
    [t("gallery.dimensions"), dimensions],
    [t("gallery.camera"), camera],
    [t("gallery.lens"), lens],
    [t("gallery.focalLength"), focalLength],
    [t("gallery.aperture"), aperture],
    [t("gallery.exposure"), exposure],
    [t("gallery.iso"), iso],
  ];
  const present = rows.filter(([, value]) => value !== null);

  return (
    <div data-testid="photo-details">
      {present.length > 0 ? (
        <dl className="flex flex-col gap-2">
          {present.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} />
          ))}
        </dl>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("gallery.noDetails")}
        </p>
      )}
    </div>
  );
}
