import type { ReactNode } from "react";
import { dayInput } from "../../lib/api/timeInput";

/**
 * The pieces the two journey forms share — the modal (`TripModal`) and the
 * edit page (`pages/TripEditPage`). They are the same form: the page IS the
 * modal's fields as page content, so the label wrapper, the cover preview and
 * the two date conversions live here once and neither copy can drift.
 */

// Convert ISO date string ↔ <input type="date"> "YYYY-MM-DD" form. Local
// timezone is fine here — trip dates are calendar dates, not instants.
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Sent as the bare day, `YYYY-MM-DD` (ADR 0002) — a trip's first and last
// day are dates, not instants.
export function fromDateInput(value: string): string | null {
  return dayInput(value);
}

export interface FieldProps {
  label: string;
  hint?: string;
  /** The cover picker steps aside during a photo scan: a buffered file cannot cross the hand-off. */
  hidden?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, hidden, children }: FieldProps): JSX.Element | null {
  if (hidden) return null;
  return (
    <div>
      <label
        className="block text-xs font-medium uppercase tracking-wide mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface CoverPreviewProps {
  url: string;
  accent: string;
  title: string;
  onClick?: () => void;
}

export function CoverPreview({ url, accent, title, onClick }: CoverPreviewProps): JSX.Element {
  const trimmed = url.trim();
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`rounded-lg overflow-hidden h-32 relative flex items-end p-3${onClick ? " cursor-pointer" : ""}`}
      style={{
        background: trimmed
          ? `url(${JSON.stringify(trimmed)}) center/cover`
          : `linear-gradient(135deg, ${accent}40, ${accent}10)`,
        border: "1px solid var(--color-border)",
      }}
    >
      {!trimmed && (
        <div
          className="absolute inset-0 flex items-center justify-center text-3xl opacity-40"
          aria-hidden
        >
          🌍
        </div>
      )}
      <div
        className="relative font-display font-bold text-lg drop-shadow-lg"
        style={{ color: trimmed ? "#fff" : "var(--text-primary)" }}
      >
        {title}
      </div>
    </div>
  );
}
