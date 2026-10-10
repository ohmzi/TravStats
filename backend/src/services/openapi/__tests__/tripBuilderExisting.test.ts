import "../paths";
import { buildOpenApiDocument } from "../registry";

describe("trip builder OpenAPI documents the re-sync fields", () => {
  const spec = JSON.stringify(buildOpenApiDocument());

  it.each([
    "existingId",
    "roadtripId",
    "keepNotSeen",
    "removeNotSeen",
    "removeOutside",
    "notSeenStops",
    "removeSkipped",
    "defaultKeep",
    "removable",
  ])("names %s", (name) => {
    expect(spec).toContain(`"${name}"`);
  });

  it("names all four station statuses", () => {
    for (const status of ["same", "changed", "new", "notSeen"]) {
      expect(spec).toContain(`"${status}"`);
    }
  });
});
