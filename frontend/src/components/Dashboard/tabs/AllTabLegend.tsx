import { useEffect, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { ATTRIBUTION_CLEARANCE } from "../../map/attributionClearance";
import { PHONE_KEY_BOTTOM, phoneBottomOffset } from "../../map/phoneChrome";
import { useIsPhoneViewport } from "../../../hooks/useIsPhoneViewport";
import { Icon } from "../../ui/Icon";
import ChromePill from "../../ui/ChromePill";
import Sheet from "../../ui/Sheet";
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
 *
 * On a phone (`useIsPhoneViewport`) it is a pill in its own row and, open, the
 * shared bottom sheet — see the branch below for the two collisions that bought.
 */
export function AllTabLegend({
  rows,
  open,
  onToggle,
  title,
}: AllTabLegendProps): JSX.Element | null {
  // Below 640px the key's floating card is the third overlay in a corner that
  // has room for two: at 390×844 its rows sat on the "Karte" panel's pill and
  // under "Domänen · x/y" (which draws at z-35, above it). So on a phone the
  // key is a `ChromePill` — in its own row, above the filter button
  // (`map/phoneChrome.ts`, PHONE_KEY_BOTTOM) — and OPENS as the shared bottom
  // sheet (`ui/Sheet`), the one every popup over the phone map uses.
  const phone = useIsPhoneViewport();
  if (rows.length === 0) return null;

  const toggle = (
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
  );

  const cardStyle: React.CSSProperties = {
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
  };

  if (phone) {
    // The pill stays where it is while the sheet is up — it is what opened
    // it, and `useDialogChrome` returns focus to it on close.
    return (
      <>
        <div
          style={{
            position: "absolute",
            bottom: phoneBottomOffset(PHONE_KEY_BOTTOM),
            right: 16,
            zIndex: 30,
          }}
        >
          <ChromePill
            icon="list"
            label={title}
            count={rows.length}
            opens
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={onToggle}
          />
        </div>
        <Sheet open={open} onClose={onToggle} title={title}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
            {rows}
          </div>
        </Sheet>
      </>
    );
  }

  return (
    <div
      style={{
        ...cardStyle,
        position: "absolute",
        bottom: ATTRIBUTION_CLEARANCE,
        right: 12,
        zIndex: 30,
        maxHeight: open ? "min(60vh, 420px)" : undefined,
        overflowY: open ? "auto" : undefined,
      }}
    >
      {toggle}
      {open && rows}
    </div>
  );
}
