import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

interface ChromePillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  icon?: IconName;
  label: ReactNode;
  /** A number beside the label, muted — how much is behind the pill. */
  count?: number | string | null;
  /**
   * Draws the trailing chevron of a pill that opens something. Up, because on
   * a phone every one of them opens a sheet from the bottom edge.
   */
  opens?: boolean;
  className?: string;
}

/**
 * The one trigger over the dashboard map — Aktivität, Karte, Legende,
 * Sichtbar, Domänen. They used to be five shapes (a pill, a full-width card
 * header, two cards with a mono label, a pill again) at four heights, which is
 * why the bottom of the phone map read as clutter rather than as a toolbar.
 * The shape lives in `theme/ui.css` (`.ts-chrome-pill`): a finger high on a
 * coarse pointer or a phone, the compact 34 under a mouse.
 */
const ChromePill = forwardRef<HTMLButtonElement, ChromePillProps>(function ChromePill(
  { icon, label, count, opens = false, className, type = "button", ...rest },
  ref
) {
  return (
    <button ref={ref} type={type} className={`ts-chrome-pill ${className ?? ""}`.trim()} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
      {count !== undefined && count !== null && (
        <span className="ts-chrome-pill-count">{count}</span>
      )}
      {opens && <Icon name="chevron-up" size={14} style={{ opacity: 0.7 }} />}
    </button>
  );
});

export default ChromePill;
