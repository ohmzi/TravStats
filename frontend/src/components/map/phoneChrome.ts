// The dashboard map's phone chrome — bands, not corners.
//
// On a desktop every overlay is placed by CORNER, and the four corners of a
// 1400px map are far apart. A phone has no four corners: measured in Chrome
// at 390×844 (2026-10-12), the Aktivität chip and the histogram strip ran
// under "+ Hinzufügen", the right column started at the desktop `top: 64`
// and landed on the strip, and the bottom edge held the "Karte" pill (232px
// wide), the map key and "Domänen · x/y" on top of one another — the key's
// rows sat under both pills.
//
// So the phone gets one vertical BAND per concern, top to bottom, and every
// component places itself with the number below instead of with a corner.
// The bands may only be changed together: each consumer reads its own edge
// from here, and the arithmetic that keeps a band's content inside it is
// pinned in `phoneChrome.test.ts`.
//
// The breakpoint is the tree's own: `max-width: 639px` (PHONE_MAX_WIDTH_PX in
// Dashboard/tabs/legendInitialState.ts, shared by `useIsPhoneViewport`).

/** The top row: the Aktivität toggle (top 12 + its pill) and "+ Hinzufügen"
 *  (top 16 + its button). The button is the taller of the two, and both end
 *  above this line. */
export const PHONE_TOP_ROW_BOTTOM = 52;

/** The histogram strip gets a row of its own, full width, below the top row.
 *  It used to sit top-CENTRE at its 300px minimum width, which at 390px
 *  started at x=45 — over the Aktivität chip — and ran to x=345, under the
 *  "+ Hinzufügen" button. */
export const PHONE_STRIP_TOP = 56;

/** The tallest the strip may get on a phone. It expands on touch (play +
 *  readout) as it does on hover on a desktop; `GlobeTimeHistogram` clamps the
 *  bar row and drops the year axis under this breakpoint so the band below
 *  stays clear even mid-playback. */
export const PHONE_STRIP_HEIGHT = 66;

/** Where the right column starts: "Als Nächstes", then "Sichtbar" under it.
 *  `DashboardLayout` writes both offsets, and `--ts-map-chrome-top` (the
 *  measured bottom of the next-up card) is derived from this same base. */
export const PHONE_COLUMN_TOP = PHONE_STRIP_TOP + PHONE_STRIP_HEIGHT + 8;

/** The column's reserved room below PHONE_COLUMN_TOP: the next-up card's
 *  height is measured rather than assumed, so this is only the gap plus the
 *  stats card's own cap on a phone (`GlobeStatsCard`). The map panel's
 *  expanded body stops above this line. */
export const PHONE_COLUMN_RESERVED = 148;

/** The map control panel's bottom edge, collapsed and expanded alike. It
 *  clears the key pill's row (PHONE_KEY_BOTTOM + the pill) so the two can
 *  sit side by side without touching. */
export const PHONE_PANEL_BOTTOM = 100;

/** The map key's row, above the "Domänen · x/y" button — which occupies
 *  16…50 from the bottom edge and must not be covered by the key. */
export const PHONE_KEY_BOTTOM = 58;

/**
 * How tall the map panel's expanded body may be on a phone: whatever the
 * right column leaves. `--ts-map-chrome-top` is the measured top of the stats
 * card (`DashboardLayout` sets it), and the fallback is the column's own top
 * for a map with no next-up card at all.
 *
 * `100vh`, like the panel's desktop cap, is the app's own height — the
 * dashboard is an `AppShell viewport` page (`height: 100vh`, nothing scrolls),
 * so this is the band the chrome sits in, not the browser's largest viewport.
 */
export function phonePanelMaxHeight(): string {
  return `calc(100vh - var(--ts-map-chrome-top, ${PHONE_COLUMN_TOP}px) - ${PHONE_COLUMN_RESERVED}px - ${PHONE_PANEL_BOTTOM}px)`;
}

/**
 * A bottom offset that keeps its distance on a phone with a home bar. `env()`
 * is 0 until the viewport meta carries `viewport-fit=cover` (it does not yet
 * — that is a page-wide change), so today this is exactly `px`; it is written
 * the long way so the offsets are already right when the meta is updated.
 */
export function phoneBottomOffset(px: number): string {
  return `calc(${px}px + env(safe-area-inset-bottom, 0px))`;
}
