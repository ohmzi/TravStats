import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useFormDirty } from "../useFormDirty";

describe("useFormDirty", () => {
  it("is clean when the form opens", () => {
    const { result } = renderHook(() => useFormDirty({ name: "Southern loop", tags: ["a"] }));
    expect(result.current).toBe(false);
  });

  it("is dirty once a value differs, and clean again when it is put back", () => {
    const { result, rerender } = renderHook(({ name }) => useFormDirty({ name, tags: ["a"] }), {
      initialProps: { name: "Southern loop" },
    });
    rerender({ name: "Southern loop 2" });
    expect(result.current).toBe(true);
    rerender({ name: "Southern loop" });
    expect(result.current).toBe(false);
  });

  it("sees a list that changed, though it is a new array each render", () => {
    const { result, rerender } = renderHook(({ tags }) => useFormDirty({ tags }), {
      initialProps: { tags: ["a"] },
    });
    rerender({ tags: ["a"] });
    expect(result.current).toBe(false);
    rerender({ tags: ["a", "b"] });
    expect(result.current).toBe(true);
  });

  it("sees a file that was picked", () => {
    const { result, rerender } = renderHook(({ file }) => useFormDirty({ file }), {
      initialProps: { file: null as File | null },
    });
    rerender({ file: new File(["x"], "cover.jpg") });
    expect(result.current).toBe(true);
  });
});
