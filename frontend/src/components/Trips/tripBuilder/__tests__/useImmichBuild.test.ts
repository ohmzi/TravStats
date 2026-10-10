import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilitiesDto } from "../../../../types/tripBuilder";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { capabilities: mocks.capabilities },
}));

import { useImmichBuild } from "../useImmichBuild";

const FORM = { name: "Northvale loop", startDate: "2031-05-02", endDate: "2031-05-09" };

function caps(immich: Partial<CapabilitiesDto["immich"]>): CapabilitiesDto {
  return {
    immich: {
      configured: true,
      source: "user",
      inspect: { ok: true, missingScopes: [] },
      album: { canCreate: true, reason: null },
      ...immich,
    },
    roadtrips: true,
    routing: { available: true, canProbe: true },
    home: { known: true, confirmed: true },
  };
}

describe("useImmichBuild", () => {
  beforeEach(() => {
    // A check that never answers: these cases are about the state, not the verdict.
    mocks.capabilities.mockReset().mockReturnValue(new Promise(() => undefined));
  });

  it("starts with both switches off, scanning nothing, blocking nothing, asking nothing", () => {
    const { result } = renderHook(() => useImmichBuild(false, "", ""));

    expect(result.current.options).toEqual({ inspect: false, createAlbum: false });
    expect(result.current.scanning).toBe(false);
    expect(result.current.issue).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it("starts with Inspect on, and asks at once, when the chooser asked for it", () => {
    const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

    expect(result.current.options.inspect).toBe(true);
    expect(result.current.scanning).toBe(true);
    expect(result.current.check.phase).toBe("loading");
    expect(mocks.capabilities).toHaveBeenCalledTimes(1);
  });

  it("blocks Save while a switch is on and the dates cannot be scanned", () => {
    const { result } = renderHook(() => useImmichBuild(false, "", "2031-05-09"));

    act(() => result.current.flip("createAlbum", true));

    expect(result.current.issue).toBe("missing");
    expect(result.current.busy).toBe(true);
  });

  it("holds the form between Save and the hand-off, and gives it back on failure", () => {
    const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

    act(() => result.current.launch(FORM));
    expect(result.current.launchProps?.form).toBe(FORM);
    expect(result.current.busy).toBe(true);

    act(() => result.current.launchProps?.onFailed());
    expect(result.current.launchProps).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  describe("the verdict on the account's Immich", () => {
    afterEach(() => vi.restoreAllMocks());

    it("switches both off and asks again on the next flip when no Immich is connected", async () => {
      mocks.capabilities.mockResolvedValue(caps({ configured: false, source: null }));
      const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

      await waitFor(() => expect(result.current.check.phase).toBe("unpaired"));
      expect(result.current.options).toEqual({ inspect: false, createAlbum: false });

      act(() => result.current.flip("inspect", true));
      expect(mocks.capabilities).toHaveBeenCalledTimes(2);
      expect(result.current.check.phase).toBe("loading");

      await waitFor(() => expect(result.current.check.phase).toBe("unpaired"));
    });

    it("keeps a connected verdict, so later flips ask nothing", async () => {
      mocks.capabilities.mockResolvedValue(caps({}));
      const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

      await waitFor(() => expect(result.current.check.phase).toBe("ready"));
      act(() => result.current.flip("createAlbum", true));

      expect(result.current.options).toEqual({ inspect: true, createAlbum: true });
      expect(mocks.capabilities).toHaveBeenCalledTimes(1);
    });

    it("takes back an album switch the account may not use, and keeps Inspect", async () => {
      let answer: (value: CapabilitiesDto) => void = () => undefined;
      mocks.capabilities.mockReturnValue(
        new Promise<CapabilitiesDto>((resolve) => {
          answer = resolve;
        })
      );
      const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

      // Flipped while the first question is still out: the verdict must see it.
      act(() => result.current.flip("createAlbum", true));
      expect(result.current.options.createAlbum).toBe(true);
      expect(mocks.capabilities).toHaveBeenCalledTimes(1);

      await act(async () =>
        answer(caps({ album: { canCreate: false, reason: "sharedConnection" } }))
      );

      expect(result.current.check.phase).toBe("ready");
      expect(result.current.options).toEqual({ inspect: true, createAlbum: false });
    });

    it("keeps a switch flipped while the question was out when the answer allows it", async () => {
      let answer: (value: CapabilitiesDto) => void = () => undefined;
      mocks.capabilities.mockReturnValue(
        new Promise<CapabilitiesDto>((resolve) => {
          answer = resolve;
        })
      );
      const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

      act(() => result.current.flip("createAlbum", true));
      await act(async () => answer(caps({})));

      expect(result.current.options).toEqual({ inspect: true, createAlbum: true });
    });

    it("switches both off when the check itself fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      mocks.capabilities.mockRejectedValue(new Error("offline"));
      const { result } = renderHook(() => useImmichBuild(true, "2031-05-02", "2031-05-09"));

      await waitFor(() => expect(result.current.check.phase).toBe("failed"));

      expect(result.current.options).toEqual({ inspect: false, createAlbum: false });
      expect(result.current.scanning).toBe(false);
    });
  });
});
