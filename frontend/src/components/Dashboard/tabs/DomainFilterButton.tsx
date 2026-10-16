import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsPhoneViewport } from "../../../hooks/useIsPhoneViewport";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useDashboardDomainFilter } from "../../../hooks/useDashboardDomainFilter";
import ChromePill from "../../ui/ChromePill";
import Sheet from "../../ui/Sheet";
import { DomainFilterPanelBody } from "./DomainFilterPanelBody";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";

export interface DomainFilterButtonProps {
  /** Day-tour count (roadtrips excluded) — see `useDashboardDomainFilter`'s
   *  own doc comment for why the caller supplies this instead of the hook
   *  fetching it a second time. */
  tourCount: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The dashboard domain filter's trigger button plus its panel — a dropdown
 * on desktop, a bottom sheet under 640px (`ClaudeDesign/handoff/2026-09-27-
 * dashboard-domain-filter-rueckmeldung.md`, "Bau-Vorgaben").
 *
 * `open` is a controlled prop (not local state) so `AllTab`'s empty-state
 * overlay ("Auswahl öffnen", decision 6) can open this same panel without
 * either component reaching into the other's internals.
 */
export function DomainFilterButton({
  tourCount,
  open,
  onOpenChange,
}: DomainFilterButtonProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const phone = useIsPhoneViewport();
  // Layout comes from the width, target size from the pointer: an iPad is a
  // wide screen operated by a thumb, so it gets the dropdown AND large rows.
  const touch = useCoarsePointer() || phone;
  const filter = useDashboardDomainFilter(tourCount);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [autoFocusKey, setAutoFocusKey] = useState<FilterDomainKey | null>(null);

  const close = (refocusButton: boolean): void => {
    onOpenChange(false);
    if (refocusButton) buttonRef.current?.focus();
  };

  // Fokus auf erste Zeile — set once per open, from the row set that exists
  // the moment it opens (a row appearing/disappearing later, e.g. a beta
  // switch flipping mid-session, must not steal focus back).
  //
  // Cleared on close, so the next open starts from no key: the sheet takes
  // focus onto its own frame first (`useDialogChrome`, which also remembers
  // this button to return to), and only then does the row take it.
  useEffect(() => {
    setAutoFocusKey(open ? (filter.rows[0]?.key ?? null) : null);
  }, [open]);

  // Outside click closes the desktop dropdown (the sheet uses its own
  // backdrop below). Not wired for the sheet: a backdrop already covers the
  // whole viewport there, so a bubbling document listener would be redundant
  // and could race the backdrop's own onClick.
  useEffect(() => {
    if (!open || phone) return;
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, phone]);

  const buttonLabel = t("dashboard:domainFilter.button.label", {
    visible: filter.visibleCount,
    total: filter.totalCount,
  });

  // The shared map-chrome pill (`ui/ChromePill`): the same shape, height and
  // chevron as Karte, Legende and Sichtbar beside it.
  const button = (
    <ChromePill
      ref={buttonRef}
      icon="sliders-horizontal"
      label={buttonLabel}
      opens
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
    />
  );

  // ONE stable root, always — `button` must stay the same DOM node whether
  // the panel is open or closed, desktop or phone: a shape that swaps (e.g.
  // returning the bare `button` while closed and a wrapped tree while open)
  // makes React discard and recreate the button element on every close,
  // which drops focus to `<body>` regardless of any `.focus()` call made a
  // moment earlier — `close(true)`'s refocus depends on the SAME button node
  // still being mounted afterwards.
  //
  // On a phone the panel is the shared bottom sheet (`ui/Sheet`) — the one
  // every popup over the map opens as, rather than a copy of its scrim and
  // radius of its own.
  const phoneSheet = phone && (
    <Sheet
      open={open}
      onClose={() => close(true)}
      title={t("dashboard:domainFilter.sheet.title")}
      doneLabel={t("dashboard:domainFilter.sheet.done")}
      bodyStyle={{ paddingLeft: 6, paddingRight: 6 }}
    >
      <DomainFilterPanelBody
        filter={filter}
        phone
        touch={touch}
        autoFocusKey={autoFocusKey}
        onEscape={() => close(true)}
        onAdopted={() => close(false)}
      />
    </Sheet>
  );

  const desktopPanel = open && !phone && (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={t("dashboard:domainFilter.panel.title")}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        zIndex: 40,
        width: 300,
        maxHeight: "min(70vh, 480px)",
        overflowY: "auto",
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: "12px 10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <DomainFilterPanelBody
        filter={filter}
        phone={false}
        touch={touch}
        autoFocusKey={autoFocusKey}
        onEscape={() => close(true)}
        onAdopted={() => close(false)}
      />
    </div>
  );

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {button}
      {phoneSheet}
      {desktopPanel}
    </div>
  );
}
