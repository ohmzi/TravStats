import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useToastStore, type Toast, type ToastType } from "../store/toastStore";
import { useTranslation } from "../hooks/useTranslation";
import { Icon, type IconName } from "./ui/Icon";
import { alpha } from "./ui/tokens";

/**
 * The hue a toast is drawn in, and the glyph beside its message.
 *
 * A confirmation is the app's own amber in its SECONDARY form — the tinted
 * recipe a status pill uses (12 % fill, 45 % border, the colour itself on the
 * glyph) rather than the solid fill a primary button owns (owner, 2026-10-16).
 * The green border it had before belonged to no part of the design system.
 * A failure stays red: an amber "Speichern fehlgeschlagen" would read as done.
 */
const TONE: Record<ToastType, { color: string; icon: IconName }> = {
  success: { color: "var(--ts-accent)", icon: "check" },
  info: { color: "var(--ts-accent)", icon: "info" },
  warning: { color: "var(--ts-warn)", icon: "triangle-alert" },
  error: { color: "var(--ts-bad)", icon: "triangle-alert" },
};

function toneStyle(type: ToastType): CSSProperties {
  const { color } = TONE[type];
  return {
    // Opaque: a toast sits over the map, and a see-through tint over a busy
    // globe is a toast nobody can read.
    background: `color-mix(in srgb, ${color} 12%, var(--ts-surface2))`,
    border: `1px solid ${alpha(color, 45)}`,
  };
}

const ToastItem = ({ toast }: { toast: Toast }) => {
  const removeToast = useToastStore((state) => state.removeToast);
  const { t } = useTranslation("common");
  const tone = TONE[toast.type];

  return (
    <div
      className="ts-toast"
      data-tone={toast.type}
      style={toneStyle(toast.type)}
      role={toast.type === "error" ? "alert" : "status"}
    >
      <Icon name={tone.icon} size={18} style={{ color: tone.color, marginTop: 1 }} />
      <div className="flex min-w-0 flex-1 flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        <p className="wrap-break-word" style={{ margin: 0, lineHeight: 1.35 }}>
          {toast.message}
        </p>
        {toast.action && (
          <Link
            to={toast.action.to}
            onClick={() => removeToast(toast.id)}
            style={{ color: "var(--ts-accent)", fontWeight: 700, textDecoration: "none" }}
          >
            {toast.action.label}
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => removeToast(toast.id)}
        className="flex shrink-0 cursor-pointer items-center justify-center"
        style={{
          width: 32,
          height: 32,
          margin: "-6px 0",
          border: "none",
          borderRadius: "var(--ts-radius-button)",
          background: "transparent",
          color: "var(--ts-muted)",
        }}
        aria-label={t("buttons.close")}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
};

/**
 * The toast stack. Placement lives in `theme/ui.css` (`.ts-toast-stack`):
 * bottom-right on a desktop, the full width less the gutters on a phone, so
 * every popup on a phone — sheets and toasts alike — comes from the same edge.
 */
export default function Toast(): JSX.Element | null {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="ts-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
