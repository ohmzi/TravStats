import "../paths";
import { buildOpenApiDocument } from "../registry";

/**
 * The roadtrip summary trio is part of the roadtrip DETAIL's published shape
 * (spec 2026-10-12 §6): the page shows it below its map, and
 * `POST /roadtrips/{id}/summarize` writes it. The detail's schema is inline in
 * the path, so it is read from there rather than from `components.schemas`.
 */
interface Field {
  type?: string;
  format?: string;
  nullable?: boolean;
}

interface DetailSchema {
  properties: Record<string, Field | undefined>;
  required: string[];
}

interface Operation {
  responses: Record<string, { content?: Record<string, { schema?: DetailSchema }> }>;
}

const doc = buildOpenApiDocument();
const paths = (doc.paths ?? {}) as unknown as Record<string, { get: Operation }>;
const schema = paths["/roadtrips/{id}"].get.responses["200"].content!["application/json"].schema!;

describe("the roadtrip detail documents its summary", () => {
  it("publishes the trio, nullable, as the row stores it", () => {
    expect(schema.properties.summary).toMatchObject({ type: "string", nullable: true });
    expect(schema.properties.summarySource).toMatchObject({ type: "string", nullable: true });
    expect(schema.properties.summaryGeneratedAt).toMatchObject({
      type: "string",
      format: "date-time",
      nullable: true,
    });
  });

  it("marks them required — every detail carries them, null included", () => {
    expect(schema.required).toEqual(
      expect.arrayContaining(["summary", "summarySource", "summaryGeneratedAt"])
    );
  });
});
