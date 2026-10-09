import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MapPinned } from "./pinnedTypes";

/** What the card's anchor needs from a MapLibre / react-map-gl ref: one projection. */
export interface ProjectingMapRef {
  getMap: () => { project: (lngLat: [number, number]) => { x: number; y: number } };
}

/**
 * The flat map's pinned card: who owns the one open slot, and where on screen
 * its anchor currently is.
 *
 * Ownership. A tab that draws its own lines (the roadtrip tour paths) owns the
 * card, so one open slot closes the other kind; every other caller keeps the
 * map's own state. `undefined` — no prop — is "uncontrolled"; `null` is a
 * controlled, closed slot, which is why the test is on the prop, not on
 * falsiness (owner, 2026-10-09: two cards could be open at once, because each
 * kind owned its own open state).
 *
 * Position. The card anchors on a [lng, lat] (`MapPinned.anchorLngLat`) and the
 * map only projects it; `recomputeAllPositions` is wired into a rAF on every
 * move, so it must stay referentially stable, and reading the anchor through a
 * ref is what keeps it so without going stale.
 */
export function usePinnedCard(
  mapRef: RefObject<ProjectingMapRef | null>,
  pinnedProp: MapPinned | null | undefined,
  onPinnedChange: Dispatch<SetStateAction<MapPinned | null>> | undefined
): {
  pinned: MapPinned | null;
  setPinned: Dispatch<SetStateAction<MapPinned | null>>;
  pinnedPos: { x: number; y: number } | null;
  recomputeAllPositions: () => void;
} {
  const [internalPinned, setInternalPinned] = useState<MapPinned | null>(null);
  const pinned = pinnedProp !== undefined ? pinnedProp : internalPinned;
  const setPinned = onPinnedChange ?? setInternalPinned;
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null);

  // Reproject the card's anchor — called on every map move/zoom via onMove.
  const recomputeAllPositions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const anchor = pinnedRef.current?.anchorLngLat;
    if (!anchor) return;
    const pt = map.project(anchor);
    setPinnedPos({ x: pt.x, y: pt.y });
  }, [mapRef]);

  const pinnedRef = useRef<MapPinned | null>(null);
  useEffect(() => {
    pinnedRef.current = pinned;
    if (pinned === null) {
      setPinnedPos(null);
      return;
    }
    recomputeAllPositions();
  }, [pinned, recomputeAllPositions]);

  return { pinned, setPinned, pinnedPos, recomputeAllPositions };
}
