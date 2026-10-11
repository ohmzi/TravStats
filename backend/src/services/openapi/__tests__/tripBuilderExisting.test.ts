import "../paths";
import { NOT_SEEN_REASONS, STATION_STATUSES } from "../../tripBuilder/existingTypes";
import { BUILDER_LEG_MODES } from "../../tripBuilder/types";
import { buildOpenApiDocument } from "../registry";

interface Node {
  $ref?: string;
  type?: string;
  enum?: string[];
  items?: Node;
  properties?: Record<string, Node>;
  required?: string[];
}

interface Operation {
  requestBody?: { content: Record<string, { schema: Node }> };
}

const doc = buildOpenApiDocument();
const schemas = (doc.components?.schemas ?? {}) as unknown as Record<string, Node>;
const paths = doc.paths as unknown as Record<string, { post?: Operation }>;
const COMPONENT_PREFIX = "#/components/schemas/";

function resolve(node: Node): Node {
  if (node.$ref === undefined) return node;
  const target = schemas[node.$ref.slice(COMPONENT_PREFIX.length)];
  if (target === undefined) throw new Error(`Unresolved ${node.$ref}`);
  return target;
}

/**
 * The schema below `root` at `path`: a name steps into `properties`, `[]` into
 * `items`. A missing step throws and names it, so a failure says which fragment
 * is not wired in rather than that some string is absent from the document.
 */
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

const keysOf = (node: Node): string[] => Object.keys(node.properties ?? {}).sort();
const DIFF_KEYS = ["added", "kept", "removed", "unchanged", "updated"];

const draft = schemas.TripBuilderDraft;
const commitResult = schemas.TripBuilderCommitResult;
const albumOutcome = schemas.TripBuilderAlbumOutcome;

describe("trip builder OpenAPI documents the re-sync fields", () => {
  // The same draft station schema sits in an area's stations, in its not-seen list
  // and in the trip's not-seen timeline stops.
  describe.each([
    ["an area's stations", ["areas", "[]", "stations", "[]"]],
    ["an area's not-seen stations", ["areas", "[]", "notSeen", "[]"]],
    ["the not-seen timeline stops", ["notSeenStops", "[]"]],
  ])("the draft station in %s", (_where, path) => {
    const station = (): Node => at(draft, ...path);

    it("says how the station stands against what is stored", () => {
      expect(at(station(), "status").enum).toEqual([...STATION_STATUSES]);
      expect(at(station(), "existingId").type).toBe("string");
    });

    it("shows what is stored now, for a same or changed station", () => {
      expect(keysOf(at(station(), "before"))).toEqual(["endDate", "slept", "startDate", "stay"]);
    });

    it("shows the default a not-seen station is offered with, and why", () => {
      const notSeen = at(station(), "notSeen");
      expect(at(notSeen, "defaultKeep").type).toBe("boolean");
      expect(at(notSeen, "reason").enum).toEqual([...NOT_SEEN_REASONS]);
    });

    it("keeps every re-sync field optional, so a new-trip draft stays valid", () => {
      for (const field of ["status", "existingId", "before", "notSeen"]) {
        expect(station().required ?? []).not.toContain(field);
      }
    });
  });

  describe("the draft", () => {
    it("names the stored roadtrip an area updates and the stations the photos do not show", () => {
      const area = at(draft, "areas", "[]");
      expect(at(area, "roadtripId").type).toBe("string");
      expect(at(area, "notSeen").type).toBe("array");
      expect(area.required ?? []).not.toContain("roadtripId");
      expect(area.required ?? []).not.toContain("notSeen");
    });

    it("lists the timeline stops the photos do not show", () => {
      expect(at(draft, "notSeenStops").type).toBe("array");
      expect(draft.required ?? []).not.toContain("notSeenStops");
    });

    it("carries the stored mode on the leg a matched pair updates, with the scan's beside it", () => {
      const leg = at(draft, "areas", "[]", "legs", "[]");
      expect(at(leg, "mode").enum).toEqual([...BUILDER_LEG_MODES]);
      expect(at(leg, "derivedMode").enum).toEqual([...BUILDER_LEG_MODES]);
      expect(leg.required ?? []).not.toContain("derivedMode");
    });

    it("previews what updating the album would do, without an asset id", () => {
      const sync = at(draft, "album", "sync");
      expect(keysOf(sync)).toEqual(["alreadyIn", "removable", "target", "toAdd"]);
      expect(at(sync, "target").enum).toEqual(["linked", "byName", "create"]);
      expect(keysOf(at(sync, "removable"))).toEqual([
        "allowed",
        "count",
        "defaultOn",
        "missingScope",
      ]);
      expect(JSON.stringify(sync)).not.toMatch(/asset(Id|Ids)\b/);
    });
  });

  describe("the commit result", () => {
    it("counts what the update did to the timeline stops", () => {
      expect(keysOf(at(commitResult, "stops"))).toEqual(DIFF_KEYS);
      expect(commitResult.required ?? []).not.toContain("stops");
    });

    it("counts what the update did to each roadtrip's stations", () => {
      const roadtrip = at(commitResult, "roadtrips", "[]");
      expect(keysOf(at(roadtrip, "diff"))).toEqual(DIFF_KEYS);
      expect(roadtrip.required ?? []).not.toContain("diff");
    });

    it("carries the album outcome", () => {
      expect(commitResult.properties?.album?.$ref).toBe(
        `${COMPONENT_PREFIX}TripBuilderAlbumOutcome`
      );
    });

    it("carries a line per stopover's own album, retried by its name", () => {
      const line = at(commitResult, "stopoverAlbums", "[]");
      expect(keysOf(line)).toEqual(["album", "key", "name"]);
      expect(line.properties?.album?.$ref).toBe(`${COMPONENT_PREFIX}TripBuilderAlbumOutcome`);
      expect(commitResult.required ?? []).not.toContain("stopoverAlbums");
    });
  });

  describe("the album outcome", () => {
    it("says how many members were removed and why a ticked removal did not run", () => {
      expect(at(albumOutcome, "removed").type).toBe("integer");
      expect(at(albumOutcome, "removeSkipped").enum).toEqual([
        "missingScope",
        "albumChanged",
        "failed",
      ]);
      expect(albumOutcome.required ?? []).not.toContain("removed");
      expect(albumOutcome.required ?? []).not.toContain("removeSkipped");
    });
  });

  describe("the album retry request", () => {
    const operation = paths["/trip-builder/trips/{tripId}/album"]?.post;
    const body = operation?.requestBody?.content["application/json"]?.schema;

    it("carries the review's removal choice, whose ids stay the server's", () => {
      expect(body).toBeDefined();
      expect(at(body as Node, "name").type).toBe("string");
      expect(at(body as Node, "removeOutside").type).toBe("boolean");
      expect(resolve(body as Node).required ?? []).not.toContain("removeOutside");
    });
  });

  describe("the commit request", () => {
    const operation = paths["/trip-builder/drafts/{id}/commit"]?.post;
    const body = operation?.requestBody?.content["application/json"]?.schema;

    it("documents the body", () => {
      expect(body).toBeDefined();
    });

    it("names the stored rows it updates, keeps and removes", () => {
      const request = resolve(body as Node);
      expect(at(request, "areas", "[]", "stations", "[]", "existingId").type).toBe("string");
      const area = at(request, "areas", "[]");
      expect(at(area, "roadtripId").type).toBe("string");
      expect(at(area, "keepNotSeen").type).toBe("array");
      expect(at(area, "removeNotSeen").type).toBe("array");
      expect(keysOf(at(request, "stops"))).toEqual(["keep", "remove"]);
      expect(at(request, "album", "removeOutside").type).toBe("boolean");
    });

    it("carries the stopover switches, and still no asset id", () => {
      const request = resolve(body as Node);
      const stopover = at(request, "stopovers", "[]");
      expect(keysOf(stopover)).toEqual(["album", "key", "roadtrip"]);
      expect(at(stopover, "roadtrip").type).toBe("boolean");
      expect(JSON.stringify(stopover)).not.toMatch(/asset(Id|Ids)\b/);
    });
  });

  describe("the draft stopover", () => {
    const stopover = (): Node => at(draft, "stopovers", "[]");

    it("says the stopover is already synced, with the stored album count beside the current one", () => {
      const stored = at(stopover(), "stored");
      expect(at(stored, "roadtripId").type).toBe("string");
      expect(at(stored, "albumAssetCount").type).toBe("integer");
      expect(keysOf(stored)).toEqual(["albumAssetCount", "name", "roadtripId"]);
      expect(stopover().required ?? []).not.toContain("stored");
    });
  });
});
