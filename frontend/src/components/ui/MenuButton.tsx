import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { useClickOutside } from "../../hooks/useClickOutside";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";
import { BUTTON_SKIN, TOOLBAR_CONTROL_STYLE } from "./Button";
import Sheet from "./Sheet";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown under a disabled item's label — why it cannot be chosen. */
  reason?: string;
}

/**
 * One black control that opens a short list of ways to do the same thing.
 *
 * Built for the recordings section (owner, 2026-10-15, choosing between one
 * menu and three buttons: "one menu button"): upload a file, pull from
 * Dawarich and import from Strava are three SOURCES for one action, and three
 * equal buttons beside "Route the whole tour" read as three actions. The
 * trigger is the secondary skin at the row's 46, so it lines up with every
 * other control in a section header.
 *
 * A source that cannot be used stays in the list, disabled, with its reason
 * printed under it — a hidden option is a question ("does this app do
 * Dawarich?") and a tooltip is invisible on a tablet, which is the web build's
 * target device.
 *
 * On a phone the list opens as the shared bottom sheet (`./Sheet`), like every
 * other popup there.
 */
export default function MenuButton({
  label,
  items,
  disabled = false,
}: {
  label: string;
  items: readonly MenuItem[];
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const phone = useIsPhoneViewport();

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // The sheet is portalled outside `rootRef`; its scrim closes it instead.
  useClickOutside(rootRef, () => {
    if (!phone) setOpen(false);
  });

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = items.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[current >= last ? 0 : current + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[current <= 0 ? last : current - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-variant="secondary"
        className="ts-button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...TOOLBAR_CONTROL_STYLE,
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--ts-space-sm)",
          whiteSpace: "nowrap",
          ...BUTTON_SKIN.secondary,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {phone && (
        <Sheet open={open} onClose={() => close(false)} title={label}>
          <div id={menuId} role="menu" aria-label={label} className="flex flex-col">
            {items.map((item, index) => (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                className="ts-sheet-item"
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  justifyContent: "center",
                }}
                onClick={() => {
                  if (item.disabled) return;
                  close(false);
                  item.onSelect();
                }}
              >
                {item.label}
                {item.disabled && item.reason ? (
                  <span className="t-caption" style={{ fontWeight: 400 }}>
                    {item.reason}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {open && !phone && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-40 flex flex-col"
          style={{
            marginTop: "var(--ts-space-xs)",
            minWidth: 240,
            padding: "var(--ts-space-xs)",
            background: "var(--ts-surface2)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-card)",
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              className="flex flex-col items-start text-left hover:bg-(--ts-row-hover)"
              onClick={() => {
                if (item.disabled) return;
                close(true);
                item.onSelect();
              }}
              style={{
                padding: "var(--ts-space-sm) var(--ts-space-md)",
                borderRadius: "var(--ts-radius-button)",
                color: item.disabled ? "var(--ts-muted)" : "var(--ts-text)",
                cursor: item.disabled ? "not-allowed" : "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {item.label}
              {item.disabled && item.reason ? (
                <span className="t-caption" style={{ fontWeight: 400 }}>
                  {item.reason}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
