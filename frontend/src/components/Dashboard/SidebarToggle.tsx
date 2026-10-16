import type { JSX } from "react";
import ChromePill from "../ui/ChromePill";

/**
 * The button over the map that opens a tab's list sidebar.
 *
 * Six dashboard tabs each drew their own copy — the same absolute position,
 * the same `rgba(22,27,34,0.85)` backdrop and a "☰" glyph in front of the
 * label — and two of them had already drifted to a different font size.
 * Round 4 draws it as a surface chip with a line icon; one component keeps
 * the six from drifting again, and since 2026-10-16 that chip is the map's
 * shared `ChromePill`, the shape of every trigger over the map. It moves right
 * while the 320px panel is open so the two never overlap.
 */
export function SidebarToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}): JSX.Element {
  return (
    <ChromePill
      icon="activity"
      label={label}
      onClick={onToggle}
      aria-expanded={open}
      style={{
        position: "absolute",
        top: 12,
        left: open ? 340 : 12,
        zIndex: 30,
        transition: "left 0.2s ease",
      }}
    />
  );
}
