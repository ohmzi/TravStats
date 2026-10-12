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

describe("trip builder OpenAPI documents the pitstop album", () => {
  it("keeps the pitstop optional on an area", () => {
    const area = at(draft, "areas", "[]");
    expect(at(area, "pitstop").type).toBe("object");
    expect(area.required ?? []).not.toContain("pitstop");
  });

  it("names the album the server computes", () => {
    const pitstop = at(draft, "areas", "[]", "pitstop");
    // Existence, not an exact key set: the re-sync task adds its own optional fields here.
    expect(Object.keys(pitstop.properties ?? {})).toContain("albumName");
    expect(at(pitstop, "albumName").type).toBe("string");
    expect(JSON.stringify(pitstop)).not.toMatch(/asset(Id|Ids)\b/);
  });

  it("says the album outcome's retry posts the entry's key, not the name", () => {
    // Final review, finding Q3-2: the retry resolves by `pitstopKey` against the
    // committed draft (two areas in one city and year share the name), so a
    // caller following the old "posts this back" wording would post `name` and
    // re-sync the TRIP's album under the city album's name instead.
    const commit = at(schemas.TripBuilderCommitResult, "pitstopAlbums", "[]", "name");
    expect(commit.description).toContain("pitstopKey");
  });
});
