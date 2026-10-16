// Single "+ hinzufügen" button, floating top-right over the map, that opens
// a small popover listing the enabled addable domains. Restores the
// pre-#folded-panel interaction (a single button → domain picker → modal)
// that commit 9f65eb83 replaced with two always-visible per-domain buttons
// inside the left control panel — moved back out to a map-overlay position
// per owner request.
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";
import { BORDER, PANEL_BG, TEXT } from "../map/controlPanelKit";
import { Icon, type IconName } from "../ui/Icon";
import { DOMAIN_ICON } from "../ui/domainIcons";
import Sheet, { SheetItem } from "../ui/Sheet";

/**
 * "tour" is in here and is NOT a domain in `shared/domains.ts`: it has no
 * domain toggle, no map colour mode and no modal. It is an entry in this
 * menu because a tour may belong to no trip since 2026-09-21, and the
 * reader asked for it where everything else is created (Alex, 2026-09-20).
 * The caller decides what a pick does — this one opens a page rather than
 * a modal.
 */
export type AddableDomain =
  "flight" | "cruise" | "lodging" | "poi" | "roadtrip" | "rail" | "rental" | "bus" | "tour";

interface AddDomainPickerProps {
  enabled: Record<AddableDomain, boolean>;
  onPick(domain: AddableDomain): void;
}

/** "tour" has no domain and therefore no entry in `DOMAIN_ICON`. */
const ADD_ICON: Record<AddableDomain, IconName> = { ...DOMAIN_ICON, tour: "route" };

export function AddDomainPicker({ enabled, onPick }: AddDomainPickerProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // On a phone the menu is the shared bottom sheet, like every other popup on
  // the map: a dropdown hanging from the top-right corner put the domains a
  // thumb has to reach for at the far end of the screen from the thumb.
  const phone = useIsPhoneViewport();

  useEffect(() => {
    // The sheet brings its own scrim; a document listener would race it.
    if (!open || phone) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, phone]);

  const options: { key: AddableDomain; label: string }[] = [];
  if (enabled.flight) options.push({ key: "flight", label: t("dashboard:addPicker.flight") });
  if (enabled.cruise) options.push({ key: "cruise", label: t("dashboard:addPicker.cruise") });
  if (enabled.lodging) options.push({ key: "lodging", label: t("dashboard:addPicker.lodging") });
  if (enabled.poi) options.push({ key: "poi", label: t("dashboard:addPicker.poi") });
  if (enabled.roadtrip) options.push({ key: "roadtrip", label: t("dashboard:addPicker.roadtrip") });
  if (enabled.tour) options.push({ key: "tour", label: t("dashboard:addPicker.tour") });
  // `enabled.rail` is the combined rule (beta switch AND domain) — see
  // DashboardLayout's `addableDomains`.
  if (enabled.rail) options.push({ key: "rail", label: t("dashboard:addPicker.rail") });
  // The same combined rule for rentals (beta switch AND domain).
  if (enabled.rental) options.push({ key: "rental", label: t("dashboard:addPicker.rental") });
  // And for bus rides: no import behind it, the pick opens the ride form.
  if (enabled.bus) options.push({ key: "bus", label: t("dashboard:addPicker.bus") });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup={phone ? "dialog" : "menu"}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-[13px] font-semibold shadow-lg transition-opacity hover:opacity-90"
        style={{
          gap: 6,
          minHeight: phone ? "var(--ts-size-touch-min)" : undefined,
          background: "var(--ts-accent)",
          color: "var(--ts-accent-text)",
          border: "none",
        }}
      >
        <Icon name="plus" size={16} />
        {t("dashboard:addPicker.button")}
        <Icon name={phone ? "chevron-up" : "chevron-down"} size={14} />
      </button>
      {phone && (
        <Sheet open={open} onClose={() => setOpen(false)} title={t("dashboard:addPicker.button")}>
          <div role="menu" aria-label={t("dashboard:addPicker.button")} className="flex flex-col">
            {options.map((opt) => (
              <SheetItem
                key={opt.key}
                icon={<Icon name={ADD_ICON[opt.key]} size={18} />}
                label={opt.label}
                onSelect={() => {
                  setOpen(false);
                  onPick(opt.key);
                }}
              />
            ))}
          </div>
        </Sheet>
      )}
      {open && !phone && (
        <ul
          role="menu"
          className="shadow-xl"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            background: PANEL_BG,
            backdropFilter: "blur(8px)",
            border: `1px solid ${BORDER}`,
            borderRadius: "10px",
            padding: "4px 0",
            minWidth: "180px",
            zIndex: 40,
            listStyle: "none",
            margin: 0,
          }}
        >
          {options.map((opt) => (
            <li key={opt.key}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(opt.key);
                  setOpen(false);
                }}
                className="w-full cursor-pointer text-left text-[13px] transition-colors hover:bg-white/5"
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  color: TEXT,
                  border: "none",
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
