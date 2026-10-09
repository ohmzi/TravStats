/**
 * The map panel's two numbers, shared by the roadtrip detail page and the
 * flight journey page (owner, 2026-10-08: "match the flight page to the road
 * trip page").
 *
 * Both pages built the sticky framed map from the SAME literals before this
 * module existed — `top: 72` on the `<aside>`, `borderRadius: 20` on the box —
 * which is exactly the kind of agreement that quietly stops being one when only
 * one page is edited. They live here so a change moves both together.
 *
 * They are NOT in `design/tokens.json` on purpose. 72 is a sticky OFFSET — the
 * 56px web header plus a 16px gap — and the token file has no offset family;
 * 20 is a radius the design system's closed set does not carry (it stops at
 * `cardLg` 18). Putting either there would fork the Companion's token file for
 * one page's panel, which is the drift the file exists to prevent.
 */

/** The `<aside>`'s sticky top, so the map clears the 56px header with air. */
export const DETAIL_MAP_STICKY_TOP = 72;

/** The framed map box's corner radius (not `--ts-radius-card-lg`, which is 18). */
export const DETAIL_MAP_BOX_RADIUS = 20;
