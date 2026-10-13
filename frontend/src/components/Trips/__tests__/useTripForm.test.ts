import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Trip } from "../../../types";

/**
 * The shared core of the journey's two forms (`TripModal` in edit mode and
 * `pages/TripEditPage`): the seeding, the update payload, the two refusals and
 * the save sequence (update → cover upload → success toast → the §K.1 re-sync
 * offer) live here once, and this suite pins them where both surfaces read
 * them — the page and the modal can no longer drift apart. Synthetic trip
 * (public repository).
 */

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  uploadCover: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { update: mocks.update, uploadCover: mocks.uploadCover },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import { useTripForm } from "../useTripForm";

const trip = {
  id: "t1",
  userId: "u1",
  name: "Northvale loop",
  description: null,
  color: "#818cf8",
  category: null,
  startDate: "2031-05-02T00:00:00.000Z",
  endDate: "2031-05-09T00:00:00.000Z",
  originLabel: null,
  destinationLabel: null,
  tags: [],
  companions: [],
  notes: null,
  coverImageUrl: null,
  icon: null,
  countries: [],
  createdAt: "2031-01-01T00:00:00.000Z",
} as unknown as Trip;

const file = (): File => new File(["x"], "cover.jpg", { type: "image/jpeg" });

describe("useTripForm — the shared journey form core", () => {
  beforeEach(() => {
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.uploadCover.mockReset();
    mocks.addToast.mockReset();
  });

  it("seeds its fields from the journey", () => {
    const { result } = renderHook(() => useTripForm(trip));

    expect(result.current.name).toBe("Northvale loop");
    expect(result.current.color).toBe("#818cf8");
    expect(result.current.category).toBe("");
    expect(result.current.startDate).toBe("2031-05-02");
    expect(result.current.endDate).toBe("2031-05-09");
    expect(result.current.tags).toEqual([]);
    expect(result.current.companions).toEqual([]);
  });

  it("opens its date boxes at the entries' span where the journey stores no day", () => {
    const undated = { ...trip, startDate: null, endDate: null } as Trip;
    const { result } = renderHook(() =>
      useTripForm(undated, { start: "2031-04-30", end: "2031-05-07" })
    );

    expect(result.current.startDate).toBe("2031-04-30");
    expect(result.current.endDate).toBe("2031-05-07");
  });

  it("lets a stored day win on its own side of the span", () => {
    const { result } = renderHook(() =>
      useTripForm(trip, { start: "2031-01-01", end: "2031-01-09" })
    );

    expect(result.current.startDate).toBe("2031-05-02");
    expect(result.current.endDate).toBe("2031-05-09");
  });

  it("sends the edited fields, uploads a picked cover and hands the saved trip back", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const saved = { ...trip, name: "Northvale round" } as Trip;
    mocks.update.mockResolvedValue(saved);
    const { result } = renderHook(() => useTripForm(trip));

    act(() => result.current.setName("Northvale round"));
    act(() =>
      result.current.handlePickCover({
        target: { files: [file()], value: "" },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    );

    let answer: Trip | null = null;
    await act(async () => {
      answer = await result.current.save();
    });

    expect(mocks.update).toHaveBeenCalledWith("t1", {
      name: "Northvale round",
      description: null,
      color: "#818cf8",
      category: null,
      startDate: "2031-05-02",
      endDate: "2031-05-09",
      originLabel: null,
      destinationLabel: null,
      tags: [],
      companions: [],
      notes: null,
    });
    expect(mocks.uploadCover).toHaveBeenCalledWith("t1", expect.any(File));
    expect(mocks.addToast).toHaveBeenCalledWith("success", "trips:toasts.updated");
    expect(answer).toEqual(saved);
    // The dates did not move: no re-sync offer.
    expect(mocks.addToast).not.toHaveBeenCalledWith(
      "info",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    vi.restoreAllMocks();
  });

  it("offers the re-sync when the save moved a date", async () => {
    const { result } = renderHook(() => useTripForm(trip));
    act(() => result.current.setEndDate("2031-05-10"));

    await act(async () => {
      await result.current.save();
    });

    expect(mocks.addToast).toHaveBeenCalledWith("info", "tripBuilder:resync.datesChanged", 15000, {
      label: "tripBuilder:resync.action",
      to: "/trips/t1/resync",
    });
  });

  it("refuses a blank name and an end before the start, sending nothing", async () => {
    const { result } = renderHook(() => useTripForm(trip));
    act(() => result.current.setName("   "));

    await act(async () => {
      expect(await result.current.save()).toBeNull();
    });

    expect(result.current.nameMissing).toBe(true);
    expect(result.current.showNameMissing).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();

    act(() => {
      result.current.setName("Northvale loop");
      result.current.setEndDate("2031-05-01");
    });
    await act(async () => {
      expect(await result.current.save()).toBeNull();
    });

    expect(result.current.datesOutOfOrder).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sends coverImageUrl: null when the cover was explicitly removed", async () => {
    const covered = { ...trip, coverImageUrl: "/covers/northvale-loop.jpg" } as Trip;
    mocks.update.mockResolvedValue(covered);
    const { result } = renderHook(() => useTripForm(covered));
    act(() => result.current.handleRemoveCover());

    await act(async () => {
      await result.current.save();
    });

    expect(mocks.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ coverImageUrl: null })
    );
  });

  it("builds the create payload with undefined where the update payload clears with null", () => {
    const { result } = renderHook(() => useTripForm(null));

    expect(result.current.createInput.startDate).toBeUndefined();
    expect(result.current.createInput.description).toBeUndefined();
    expect(result.current.updateInput.startDate).toBeNull();
    expect(result.current.updateInput.description).toBeNull();
    expect(result.current.updateInput).not.toHaveProperty("coverImageUrl");
  });
});
