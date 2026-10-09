import type { Layer, PickingInfo } from "@deck.gl/core";

/**
 * Make every clickable layer a caller hands the flat map claim its own tap.
 *
 * deck.gl's layer pick and MapLibre's own Map click BOTH fire for one tap, and
 * the Map handler's background branch clears whatever the tap opened unless the
 * deck handler has already claimed it (`DeckGLMap`'s `deckClickedRef`). Every
 * layer the map builds claims its tap in its own handler (flight, airport,
 * lodging, place); the caller's `extraLayers` did not, so a roadtrip line's card
 * was set and wiped in the same tap and the roadtrip page was unreachable from
 * the flat map (owner, 2026-10-09). Wrapping each extra layer that answers a
 * click lets it claim the tap on the same terms, without the tab having to know
 * the map's ref.
 *
 * Layers without an `onClick` are returned as they are. The caller keys its
 * memo on `layers` alone (not on zoom or selection): the tab already memoises
 * its layers, and re-cloning them on every camera move would be churn deck.gl
 * has no reason to do.
 *
 * @param layers   the caller's extra layers; `undefined` is no layers
 * @param claimTap runs before the layer's own handler, on every pick it answers
 */
export function guardExtraLayers(
  layers: readonly Layer[] | undefined,
  claimTap: () => void
): Layer[] {
  return (layers ?? []).map((layer) => {
    const onClick = layer.props.onClick as
      ((info: PickingInfo, event: unknown) => void) | undefined;
    if (typeof onClick !== "function") return layer;
    return layer.clone({
      onClick: (info: PickingInfo, event: unknown): void => {
        claimTap();
        onClick(info, event);
      },
    }) as Layer;
  });
}
