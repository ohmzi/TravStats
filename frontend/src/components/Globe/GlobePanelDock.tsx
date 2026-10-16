// Where the globe's map control panel sits.
//
// The panel's body (`GlobeControlPanel`) knows nothing about placement; on a
// desktop this is the bottom-left corner it has always been. At 390×844 that
// corner is not its own: the panel was 232px of a 390px screen, so its bottom
// edge sat on the map key's rows and on top of "Domänen · x/y" (measured in
// Chrome, 2026-10-12). On a phone the panel is now a pill that opens a bottom
// sheet (`map/MapPanelFrame.tsx`), so the dock only places that pill: the
// bottom row's left end (`map/phoneChrome.ts`, PHONE_PANEL_BOTTOM), opposite
// "Domänen · x/y" at its right end, with the key pill in the row above.
//
// The band's `bottom` also carries the safe-area inset, so the panel keeps
// its distance from a phone's home bar.

import type { JSX, ReactNode } from "react";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";
import { PHONE_PANEL_BOTTOM, phoneBottomOffset } from "../map/phoneChrome";

export function GlobePanelDock({ children }: { children: ReactNode }): JSX.Element {
  const phone = useIsPhoneViewport();
  return (
    <div
      className={phone ? "absolute z-10" : "absolute bottom-4 left-4 z-10"}
      style={
        phone
          ? {
              left: 16,
              bottom: phoneBottomOffset(PHONE_PANEL_BOTTOM),
              pointerEvents: "auto",
            }
          : { pointerEvents: "auto" }
      }
    >
      {children}
    </div>
  );
}
