import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { alpha } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "danger";

/**
 * `toolbar`: the shared row height (46) even for a primary. A row of controls
 * reads as one size when every control in it draws these metrics; only a
 * control that stands alone keeps the taller primary (52).
 */
export type ButtonSize = "default" | "toolbar";

/**
 * The one size a control in a row draws, whatever its skin and whatever its
 * element: the secondary height, the shared padding, radius and label.
 *
 * Exported because half the controls in these rows are not `<button>`s — the
 * outline `ActionLink`, the re-sync link, the key-settings link in the blocked
 * panel. Each of them used to copy the numbers by hand, which is exactly how
 * a row ends up 44|46|52 (owner, 2026-10-11: "all these should be same size").
 * They spread this constant instead, so they cannot drift again.
 */
export const TOOLBAR_CONTROL_STYLE = {
  height: "var(--ts-size-button-secondary)",
  padding: "0 var(--ts-space-xl)",
  borderRadius: "var(--ts-radius-button)",
  fontFamily: "var(--ts-font-ui)",
  fontSize: 16,
  fontWeight: 700,
} as const;

/**
 * The colour skin of each variant, shared by `Button` and by the outline
 * `ActionLink`, so a link and a button of the same variant cannot drift apart.
 */
export const BUTTON_SKIN: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--ts-accent)",
    color: "var(--ts-accent-text)",
    border: "1px solid var(--ts-accent)",
  },
  secondary: {
    background: "transparent",
    color: "var(--ts-text)",
    border: "1px solid var(--ts-border-button)",
  },
  danger: {
    background: alpha("var(--ts-bad)", 12),
    color: "var(--ts-bad)",
    border: `1px solid ${alpha("var(--ts-bad)", 45)}`,
  },
};

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  /** `toolbar` joins a row's shared height; a lone CTA keeps `default`. */
  size?: ButtonSize;
  children: ReactNode;
  /** Full-width in a form footer or a sheet. */
  block?: boolean;
  /** Leading icon slot. Trailing icons are not a thing here. */
  icon?: ReactNode;
  className?: string;
}

/**
 * Three variants, chosen by WHAT THE ACTION DOES — and all three may stand
 * wherever the action belongs.
 *
 * The app has 597 `<button>` elements and 464 of them style themselves, which
 * is why no two amber buttons are the same amber. The rule (owner,
 * 2026-10-15: "all the edit buttons should be yellow … delete red and others
 * black, should be same design and size"):
 *
 * - `primary` — Edit, Save, Done: the action that commits, or opens the edit.
 * - `danger` — Delete, Remove: red as a TINTED OUTLINE, never a fill, so it
 *   reads as "this is the one that removes something" without turning a page
 *   into an alarm.
 * - `secondary` — everything else: the black outline.
 *
 * `danger` used to be confined to confirm dialogs ("a destructive action is
 * confirmed, not offered"). This branch puts it in page headers — the edit
 * pages' Delete, the cover row's Remove — because the owner asked for delete
 * to stand at the right of the title. It is still confirmed rather than
 * performed: what makes offering it safe is the dialog it opens, which states
 * object, reach and consequence.
 *
 * The heights follow the PLACE, not the variant: `size="toolbar"` is the 46
 * every control in a row draws, and the 52 default belongs to a lone CTA
 * outside one (sign-in, an empty state). The label is 16/700 and never mono —
 * a button is an instruction, not a measurement.
 */
export default function Button({
  variant = "secondary",
  size = "default",
  children,
  block = false,
  icon,
  className,
  style,
  disabled,
  ...rest
}: ButtonProps): JSX.Element {
  const height =
    variant === "primary" && size === "default"
      ? "var(--ts-size-button-primary)"
      : TOOLBAR_CONTROL_STYLE.height;

  return (
    <button
      type="button"
      disabled={disabled}
      data-variant={variant}
      className={`ts-button ${className ?? ""}`.trim()}
      style={{
        ...TOOLBAR_CONTROL_STYLE,
        height,
        display: block ? "flex" : "inline-flex",
        width: block ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--ts-space-sm)",
        whiteSpace: "nowrap",
        // 0.5 everywhere; the create button's 0.3 belongs to the form-error
        // recipe, not to every disabled button.
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
        ...BUTTON_SKIN[variant],
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
