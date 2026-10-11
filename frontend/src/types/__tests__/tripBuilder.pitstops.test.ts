import { describe, expect, it } from "vitest";

import type { DraftArea, DraftPitstop } from "../tripBuilder";

// Synthetic fixtures only (public repository).
describe("pitstop wire vocabulary", () => {
  it("carries the server-computed album name on the area", () => {
    const pitstop: DraftPitstop = { albumName: "Dunholme 2031 Road Trip (Northvale loop)" };
    const area = {
      key: "2031-05-02#1",
      pitstop,
    } satisfies Pick<DraftArea, "key" | "pitstop">;
    expect(area.pitstop?.albumName).toBe("Dunholme 2031 Road Trip (Northvale loop)");
  });
});
