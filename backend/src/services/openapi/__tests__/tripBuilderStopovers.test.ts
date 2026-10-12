import "../paths";
import { buildOpenApiDocument } from "../registry";

interface Node {
  $ref?: string;
  type?: string;
  enum?: string[];
  description?: string;
  items?: Node;
  properties?: Record<string, Node>;
  required?: string[];
}

const doc = buildOpenApiDocument();
const schemas = (doc.components?.schemas ?? {}) as unknown as Record<string, Node>;
const COMPONENT_PREFIX = "#/components/schemas/";

function resolve(node: Node): Node {
  if (node.$ref === undefined) return node;
  const target = schemas[node.$ref.slice(COMPONENT_PREFIX.length)];
  if (target === undefined) throw new Error(`Unresolved ${node.$ref}`);
  return target;
}

/** As in `tripBuilderExisting.test.ts`: a name steps into `properties`, `[]` into `items`. */
function at(root: Node, ...path: string[]): Node {
  let node = resolve(root);
  path.forEach((step, i) => {
    const next = step === "[]" ? node.items : node.properties?.[step];
    if (next === undefined)
      throw new Error(`No "${step}" at ${path.slice(0, i).join(".") || "root"}`);
    node = resolve(next);
  });
  return node;
}

const draft = schemas.TripBuilderDraft;
const STOPOVER_FIELDS = [
  "airportIata",
  "city",
  "day",
  "key",
  "legs",
  "outingCount",
  "photoCount",
  "stations",
  "title",
];

describe("trip builder OpenAPI documents the stopover tour", () => {
  it("keeps the stopovers optional, so an album-only draft stays valid", () => {
    expect(at(draft, "stopovers").type).toBe("array");
    expect(draft.required ?? []).not.toContain("stopovers");
  });

  it("describes the tour a stopover offers", () => {
    const stopover = at(draft, "stopovers", "[]");
    // Existence, not an exact key set: the re-sync task adds its own optional fields here.
    for (const field of STOPOVER_FIELDS) {
      expect(Object.keys(stopover.properties ?? {})).toContain(field);
    }
    expect(at(stopover, "day").type).toBe("string");
    expect(at(stopover, "airportIata").type).toBe("string");
  });

  it("gives the tour the draft station and the draft leg, and no asset id", () => {
    const stopover = at(draft, "stopovers", "[]");
    expect(at(stopover, "stations", "[]", "kind").enum).toEqual([
      "visit",
      "brief",
      "dayTrip",
      "home",
      "airport",
    ]);
    expect(at(stopover, "stations", "[]", "previewIdx").type).toBe("array");
    expect(at(stopover, "legs", "[]", "mode").enum).toEqual(["road", "ferry"]);
    expect(JSON.stringify(stopover)).not.toMatch(/asset(Id|Ids)\b/);
  });

  it("says the album outcome's retry posts the entry's key, not the name", () => {
    // The same lie the pitstop line carried (final review, finding Q3-2): the
    // stopover retry resolves by `stopoverKey`, never by the album's name.
    const commit = at(schemas.TripBuilderCommitResult, "stopoverAlbums", "[]", "name");
    expect(commit.description).toContain("stopoverKey");
  });
});
