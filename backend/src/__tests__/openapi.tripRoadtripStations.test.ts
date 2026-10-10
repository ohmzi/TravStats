import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

interface SchemaNode {
  type?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
}

/** `GET /trips/{id}` documents the roadtrip stations it now sends (spec 2026-10-09 §E). */
describe("openapi: the trip's roadtrip stations", () => {
  const schemas = (buildOpenApiDocument().components?.schemas ?? {}) as unknown as Record<
    string,
    SchemaNode
  >;
  const ref = (name: string): string => `#/components/schemas/${name}`;

  it("lists them on the trip as an optional array of TripRoadtripStation", () => {
    const trip = schemas.Trip;
    const listed = trip.properties?.roadtripStations;

    expect(listed?.type).toBe("array");
    expect(JSON.stringify(listed)).toContain(ref("TripRoadtripStation"));
    expect(trip.required ?? []).not.toContain("roadtripStations");
  });

  it("describes a station: its roadtrip, its state, its nights and its times", () => {
    const station = schemas.TripRoadtripStation;

    expect(station.properties?.state?.enum).toEqual(["stay", "free", "pass"]);
    expect(JSON.stringify(station.properties?.times)).toContain(ref("TripStopTimes"));
    expect(station.required).toEqual(
      expect.arrayContaining(["id", "title", "routeId", "routeName", "state", "nights", "times"])
    );
  });
});
