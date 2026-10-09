import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { usePinnedCard, type ProjectingMapRef } from "../usePinnedCard";
import { pinnedFromAirport } from "../buildFlatPinned";
import type { MapPinned } from "../pinnedTypes";

const JFK = pinnedFromAirport("JFK", -73.78, 40.64, []);
const LHR = pinnedFromAirport("LHR", -0.45, 51.47, []);

// One ref per test, created OUTSIDE the render: the hook keys its callback on it,
// exactly as it is keyed on the map's `useRef`, which never changes identity.
// The projection is the identity, so a card's screen position IS its anchor.
let ref: RefObject<ProjectingMapRef | null>;
let project: Mock<(lngLat: [number, number]) => { x: number; y: number }>;
let onChange: Mock<Dispatch<SetStateAction<MapPinned | null>>>;
beforeEach(() => {
  project = vi.fn(([x, y]) => ({ x, y }));
  ref = { current: { getMap: () => ({ project }) } };
  onChange = vi.fn<Dispatch<SetStateAction<MapPinned | null>>>();
});

describe("usePinnedCard ownership", () => {
  it("keeps its own slot when the caller passes no pinned prop", () => {
    const { result } = renderHook(() => usePinnedCard(ref, undefined, undefined));
    expect(result.current.pinned).toBeNull();
    act(() => result.current.setPinned(JFK));
    expect(result.current.pinned).toBe(JFK);
  });

  it("treats a null prop as a controlled, CLOSED slot, even after the map held a card of its own", () => {
    const { result, rerender } = renderHook(
      ({ pinned }: { pinned: MapPinned | null | undefined }) =>
        usePinnedCard(ref, pinned, pinned === undefined ? undefined : onChange),
      { initialProps: { pinned: undefined as MapPinned | null | undefined } }
    );
    act(() => result.current.setPinned(JFK)); // uncontrolled: lands in the map's own slot
    expect(result.current.pinned).toBe(JFK);
    rerender({ pinned: null }); // the owner takes over with a closed slot
    expect(result.current.pinned).toBeNull(); // `??` would fall back to the stale JFK
    act(() => result.current.setPinned(LHR));
    expect(onChange).toHaveBeenCalledWith(LHR);
    expect(result.current.pinned).toBeNull();
  });

  it("shows whatever the owner holds, so one slot can hold either card kind", () => {
    const { result, rerender } = renderHook(({ pinned }) => usePinnedCard(ref, pinned, onChange), {
      initialProps: { pinned: JFK as typeof JFK | null },
    });
    expect(result.current.pinned).toBe(JFK);
    rerender({ pinned: LHR });
    expect(result.current.pinned).toBe(LHR);
  });
});

describe("usePinnedCard position", () => {
  it("projects the anchor when a card opens and drops the position when it closes", () => {
    const { result, rerender } = renderHook(({ pinned }) => usePinnedCard(ref, pinned, onChange), {
      initialProps: { pinned: null as typeof JFK | null },
    });
    expect(result.current.pinnedPos).toBeNull();
    rerender({ pinned: JFK });
    expect(result.current.pinnedPos).toEqual({ x: -73.78, y: 40.64 });
    rerender({ pinned: null });
    expect(result.current.pinnedPos).toBeNull();
  });

  it("re-projects on demand and keeps recomputeAllPositions referentially stable", () => {
    const { result, rerender } = renderHook(({ pinned }) => usePinnedCard(ref, pinned, onChange), {
      initialProps: { pinned: JFK as typeof JFK | null },
    });
    const first = result.current.recomputeAllPositions;
    project.mockClear();
    act(() => result.current.recomputeAllPositions());
    expect(project).toHaveBeenCalledWith(JFK.anchorLngLat);
    rerender({ pinned: LHR });
    expect(result.current.recomputeAllPositions).toBe(first);
    expect(result.current.pinnedPos).toEqual({ x: -0.45, y: 51.47 });
  });

  it("does nothing without a map", () => {
    const empty: RefObject<ProjectingMapRef | null> = { current: null };
    const { result } = renderHook(() => usePinnedCard(empty, JFK, onChange));
    expect(result.current.pinnedPos).toBeNull();
  });
});
