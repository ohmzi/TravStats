import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useDialogChrome } from "./useDialogChrome";
import { useScrimDismiss } from "./useScrimDismiss";

/** How far the sheet must be pulled down before letting go closes it. */
export const SHEET_DISMISS_DRAG_PX = 72;

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** The heading. A string also names the dialog for a screen reader. */
  title: ReactNode;
  /** The dialog's accessible name when `title` is not plain text. */
  ariaLabel?: string;
  /** Beside the title, before "Fertig" — a count, a quick action. */
  headerExtra?: ReactNode;
  /** The dismiss label; "Fertig" by default. */
  doneLabel?: string;
  /** Applied to the scrolling body, for a caller whose rows bring their own inset. */
  bodyStyle?: CSSProperties;
  children: ReactNode;
}

/**
 * The phone's one popup: a sheet docked to the bottom edge.
 *
 * Before this the dashboard had five popups and five behaviours on a phone —
 * the add menu dropped down from the top-right corner, the domain filter and
 * the key opened sheets of their own (two copies of the same scrim, radius and
 * z-index), the "Sichtbar" card unfolded in place, and the map panel grew
 * upwards over the map until it hit the right column. Each was reasonable on
 * its own; together a reader had to learn where every one of them would open
 * and how to shut it (owner, 2026-10-16: "make it uniform … ideally at the
 * bottom of screen").
 *
 * So a popup on a phone is this, whatever opened it: the dialog shell
 * (`.ts-dialog-scrim` / `.ts-dialog-panel` — scrim, `surface2`, radius 26, the
 * sheet shadow), docked to the bottom at any width, a grip, a title row with
 * "Fertig", and a body that scrolls on its own. It closes four ways, all of
 * them the same everywhere: "Fertig", a tap on the scrim, Escape, and pulling
 * the grip down. `useDialogChrome` brings the keyboard contract every dialog
 * already keeps (focus trap, the page behind does not scroll, focus returns).
 *
 * The desktop keeps its anchored popovers; a caller renders this only where
 * `useIsPhoneViewport()` says so.
 */
export default function Sheet({
  open,
  onClose,
  title,
  ariaLabel,
  headerExtra,
  doneLabel,
  bodyStyle,
  children,
}: SheetProps): JSX.Element | null {
  const { t } = useTranslation("common");
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogChrome({ open, onClose, panelRef });
  const scrim = useScrimDismiss(panelRef, onClose);
  const drag = useRef<{ startY: number; dy: number } | null>(null);

  if (!open) return null;

  // Pull-to-dismiss on the grip and the title row. Written to the panel's own
  // style rather than through state, so a drag does not re-render the body
  // (the domain filter's rows, the whole map panel) sixty times a second.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest("button, a, input, select")) return;
    drag.current = { startY: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (panelRef.current) panelRef.current.style.transition = "none";
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    const panel = panelRef.current;
    if (!state || !panel) return;
    state.dy = Math.max(0, event.clientY - state.startY);
    panel.style.transform = state.dy > 0 ? `translateY(${state.dy}px)` : "";
  };
  const onPointerEnd = (): void => {
    const state = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!state || !panel) return;
    panel.style.transition = "transform var(--ts-motion-base) var(--ts-ease-standard)";
    if (state.dy >= SHEET_DISMISS_DRAG_PX) onClose();
    else panel.style.transform = "";
  };

  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);

  return createPortal(
    <div className="ts-dialog-scrim" data-placement="sheet" {...scrim}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="ts-dialog-panel"
        data-layout="sheet"
      >
        <div
          className="ts-sheet-head"
          data-testid="sheet-grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <span className="ts-sheet-grip" aria-hidden="true" />
          <div className="ts-sheet-titlebar">
            <span className="ts-sheet-title">{title}</span>
            <span className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
              {headerExtra}
              <button type="button" className="ts-sheet-done" onClick={onClose}>
                {doneLabel ?? t("common:buttons.done")}
              </button>
            </span>
          </div>
        </div>
        <div className="ts-sheet-body" style={bodyStyle}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * One row of a menu inside a sheet: the whole width, a finger high, icon and
 * label on the left, an optional trailing note. A plain `<button>`, so a
 * caller that needs a link wraps its own `<Link className="ts-sheet-item">`.
 */
export function SheetItem({
  icon,
  label,
  trailing,
  onSelect,
  active = false,
  disabled = false,
  role = "menuitem",
}: {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
  role?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role={role}
      className="ts-sheet-item"
      data-active={active || undefined}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
    >
      <span className="flex items-center" style={{ gap: "var(--ts-space-md)", minWidth: 0 }}>
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {trailing}
    </button>
  );
}
