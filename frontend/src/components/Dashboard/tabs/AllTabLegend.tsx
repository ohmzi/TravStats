import { useEffect, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { ATTRIBUTION_CLEARANCE } from "../../map/attributionClearance";
import { Icon } from "../../ui/Icon";
import { initialLegendOpen, isPhoneViewport } from "./legendInitialState";

// The "Alle" tab's colour key, split out of `AllTab.tsx` purely to keep that file
// under its 800-line ceiling (the same reason `allTabLegendRows.tsx` and
// `tourMapOverlay.tsx` exist). Nothing here decides WHICH rows the key shows —
// `AllTab` still builds them from the same stores the map reads, so the key
// cannot drift from the map. This file only draws them and remembers whether the
// key is open.

// Remembered per browser: a key someone shut should stay shut on the next
// visit, and it is a display preference rather than account state.
const LEGEND_OPEN_KEY = "dashboard.legendOpen";

/**
 * The key's open/closed state, persisted under `dashboard.legendOpen`.
 *
 * Remembered per browser, like the rest of the map's appearance. Someone who
 * closes the key on a crowded map means it, and having it reopen on every
 * navigation is the same annoyance one page later.
 */
export function useLegendOpen(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [legendOpen, setLegendOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return initialLegendOpen(window.localStorage.getItem(LEGEND_OPEN_KEY), isPhoneViewport());
    } catch {
      return !isPhoneViewport();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(LEGEND_OPEN_KEY, String(legendOpen));
    } catch {
      /* private mode or blocked site data — the choice just does not survive a reload */
    }
  }, [legendOpen]);

  return [legendOpen, setLegendOpen];
}

interface AllTabLegendProps {
  /** The swatch rows to draw, already filtered to the visible domains. */
  rows: JSX.Element[];
  open: boolean;
  onToggle: () => void;
  /** The translated heading ("Legende"), so this file needs no `t` of its own. */
  title: string;
}

/**
 * Colour key as a compact table pinned bottom-right — out of the top band so it
 * never collides with the globe's time histogram or the top-left controls.
 * Renders nothing when no domain contributes a row.
 *
 * The bottom offset clears MapLibre's attribution bar, which occupies the same
 * corner. At `bottom: 12` the key's lower rows sat ON the line reading
 * "MapLibre | © CARTO, © OpenStreetMap contributors" — measured at 32 px of
 * overlap (#273). That is not only untidy: CARTO and OpenStreetMap both require
 * the credit to stay visible, so covering it is a licence question, not a
 * cosmetic one. The other three map overlays in this app sit bottom-LEFT and are
 * unaffected. (`ATTRIBUTION_CLEARANCE` carries the number and its measurement.)
 * If the bar ever grows (a second attribution line, a taller control), that is
 * the one number to change — verify by measuring, not by eye: compare the key's
 * `getBoundingClientRect().bottom` against `.maplibregl-ctrl-bottom-right`.
 *
 * Collapsible, like the map options beside it. The key grew a row per LIST when
 * "by list" colouring started naming them, and on a map with a dozen lists it
 * began covering the thing it explains (Alex, 2026-08-29).
 *
 * The count stays visible when collapsed. A bare chevron hides how much is
 * behind it, and a key is the one overlay where "there is more here" is the
 * whole point.
 */
export function AllTabLegend({
  rows,
  open,
  onToggle,
  title,
}: AllTabLegendProps): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: ATTRIBUTION_CLEARANCE,
        right: 12,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 16px",
        borderRadius: "var(--ts-radius-card)",
        background: "color-mix(in srgb, var(--ts-surface) 94%, transparent)",
        color: "var(--ts-text-bright)",
        border: "1px solid var(--ts-border)",
        fontSize: 13,
        whiteSpace: "nowrap",
        maxHeight: open ? "min(60vh, 420px)" : undefined,
        overflowY: open ? "auto" : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "var(--ts-muted)",
          cursor: "pointer",
        }}
      >
        {/* Round 4: a mono section label over the rows, like every panel title. */}
        <span className="t-label-mono">{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!open && <span style={{ fontVariantNumeric: "tabular-nums" }}>{rows.length}</span>}
          <Icon name={open ? "chevron-down" : "chevron-up"} size={14} />
        </span>
      </button>
      {open && rows}
    </div>
  );
}
