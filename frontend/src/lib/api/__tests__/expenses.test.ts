import { beforeEach, describe, expect, it, vi } from "vitest";

import { expensesApi } from "../expenses";
import { api } from "../client";

vi.mock("../client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("expensesApi.listForTrip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the trip-wide family and answers the bare body", async () => {
    const body = { expenses: [{ id: "e1" }], totals: { CAD: 12.5 } };
    vi.mocked(api.get).mockResolvedValue({ data: body });
    await expect(expensesApi.listForTrip("t1")).resolves.toEqual(body);
    expect(api.get).toHaveBeenCalledWith("/trips/t1/expenses");
  });

  it("lets a failure reach the caller", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("503"));
    await expect(expensesApi.listForTrip("t1")).rejects.toThrow("503");
  });
});
