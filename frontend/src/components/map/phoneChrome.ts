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

/** Every trigger over the phone map is a `ChromePill` (`ui/ChromePill.tsx`),
 *  a finger high — `--ts-size-touch-min`. One height is what lets the bands
 *  below be arithmetic rather than measurement. */
export const PHONE_PILL_HEIGHT = 44;

/** The gap between two rows of pills. */
const ROW_GAP = 8;

/** The top row's own top edge: the Aktivität pill on the left and "+
 *  Hinzufügen" on the right both start here on a phone. */
export const PHONE_TOP_ROW_TOP = 12;

/** The top row: the Aktivität pill and "+ Hinzufügen", one pill high. */
export const PHONE_TOP_ROW_BOTTOM = PHONE_TOP_ROW_TOP + PHONE_PILL_HEIGHT;

/** The histogram strip gets a row of its own, full width, below the top row.
 *  It used to sit top-CENTRE at its 300px minimum width, which at 390px
 *  started at x=45 — over the Aktivität chip — and ran to x=345, under the
 *  "+ Hinzufügen" button. */
export const PHONE_STRIP_TOP = PHONE_TOP_ROW_BOTTOM + 4;

/** The tallest the strip may get on a phone. It expands on touch (play +
 *  readout) as it does on hover on a desktop; `GlobeTimeHistogram` clamps the
 *  bar row and drops the year axis under this breakpoint so the band below
 *  stays clear even mid-playback. */
export const PHONE_STRIP_HEIGHT = 66;

/** Where the right column starts: "Als Nächstes", then the "Sichtbar" pill
 *  under it. `DashboardLayout` writes both offsets, and `--ts-map-chrome-top`
 *  (the measured bottom of the next-up card) is derived from this same base. */
export const PHONE_COLUMN_TOP = PHONE_STRIP_TOP + PHONE_STRIP_HEIGHT + ROW_GAP;

/** The bottom row: "Karte" on the left, "Domänen · x/y" on the right. Both
 *  open a sheet, so neither grows into the map any more — the map panel used
 *  to unfold upwards from a full-width band of its own, and the "Sichtbar"
 *  card downwards towards it, and the two had to share the height between. */
export const PHONE_BOTTOM_ROW = 16;

/** The map panel's pill sits in the bottom row, beside the domain filter. */
export const PHONE_PANEL_BOTTOM = PHONE_BOTTOM_ROW;

/** The map key's pill: right-aligned, one row above "Domänen · x/y". */
export const PHONE_KEY_BOTTOM = PHONE_BOTTOM_ROW + PHONE_PILL_HEIGHT + ROW_GAP;

/**
 * A bottom offset that keeps its distance on a phone with a home bar. `env()`
 * is 0 until the viewport meta carries `viewport-fit=cover` (it does not yet
 * — that is a page-wide change), so today this is exactly `px`; it is written
 * the long way so the offsets are already right when the meta is updated.
 */
export function phoneBottomOffset(px: number): string {
  return `calc(${px}px + env(safe-area-inset-bottom, 0px))`;
}
