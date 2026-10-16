// The outer frame of both map control panels (globe + flat 2D).
//
// The two panels share their sections through `controlPanelKit`, but each
// drew its own card around them — and on a phone the globe's card unfolded
// upwards over the map until it met the right column, while the flat map's
// kept its desktop 232px. Neither was the shape any other popup on the phone
// map had. So the frame is one component now, and it is where the phone
// difference lives: a `ChromePill` in the bottom row that opens the panel in
// the shared bottom sheet (`ui/Sheet`), exactly as Legende, Sichtbar and
// Domänen open theirs (owner, 2026-10-16).
//
// The desktop card is unchanged: the persisted expand/collapse header, the
// 232px column, the body scrolling under its own cap.

import { useState, type JSX, type ReactNode } from "react";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";
import ChromePill from "../ui/ChromePill";
import Sheet from "../ui/Sheet";
import { BORDER, PANEL_BG, PanelHeader, TEXT, usePanelExpanded } from "./controlPanelKit";

export function MapPanelFrame({
  title,
  desktopMaxHeight,
  children,
}: {
  title: string;
  /** The desktop card's cap — the globe and the flat map sit in different rooms. */
  desktopMaxHeight: string;
  children: ReactNode;
}): JSX.Element {
  const phone = useIsPhoneViewport();
  // The desktop's open/closed choice is persisted; the phone's sheet is not —
  // a sheet already up when the map loads would hide the map behind a scrim
  // before the reader has seen it.
  const [expanded, toggleExpanded] = usePanelExpanded();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (phone) {
    return (
      <>
        <ChromePill
          icon="map"
          label={title}
          opens
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        />
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={title}>
          <div className="text-xs" style={{ color: TEXT }}>
            {children}
          </div>
        </Sheet>
      </>
    );
  }

  return (
    <div
      className="flex w-[232px] flex-col overflow-hidden rounded-xl text-xs"
      style={{
        background: PANEL_BG,
        backdropFilter: "blur(14px)",
        border: `1px solid ${BORDER}`,
        color: TEXT,
        fontFamily: "'Inter', sans-serif",
        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
        // Never taller than the space above the panel's corner — the body
        // scrolls when all sections are open.
        maxHeight: desktopMaxHeight,
      }}
    >
      <PanelHeader title={title} expanded={expanded} onToggle={toggleExpanded} />
      {expanded && (
        <div className="scrollbar-none min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}
