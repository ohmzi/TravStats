import { describe, it, expect, vi } from "vitest";
import { PathLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { guardExtraLayers } from "../guardExtraLayers";

function pathLayer(id: string, onClick?: (info: PickingInfo, event: unknown) => void): PathLayer {
  return new PathLayer({ id, data: [], getPath: () => [], pickable: true, onClick });
}

describe("guardExtraLayers", () => {
  it("claims the tap BEFORE the layer's own handler runs, and passes the pick through", () => {
    const order: string[] = [];
    const own = vi.fn(() => order.push("own"));
    const [guarded] = guardExtraLayers([pathLayer("tour", own)], () => order.push("claim"));

    const info = { object: { id: "leg-1" } } as unknown as PickingInfo;
    const event = { srcEvent: {} };
    (guarded!.props.onClick as (i: PickingInfo, e: unknown) => void)(info, event);

    expect(order).toEqual(["claim", "own"]);
    expect(own).toHaveBeenCalledWith(info, event);
  });

  it("returns a layer with no click handler untouched, so deck.gl keeps its identity", () => {
    const quiet = pathLayer("quiet");
    const [out] = guardExtraLayers([quiet], vi.fn());
    expect(out).toBe(quiet);
  });

  it("clones a clickable layer instead of mutating the caller's", () => {
    const own = vi.fn();
    const original = pathLayer("tour", own);
    const [guarded] = guardExtraLayers([original], vi.fn());
    expect(guarded).not.toBe(original);
    expect(guarded!.id).toBe("tour");
    expect(original.props.onClick).toBe(own);
  });

  it("treats no layers as an empty list", () => {
    expect(guardExtraLayers(undefined, vi.fn())).toEqual([]);
  });
});
