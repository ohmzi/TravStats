import type { AirportData } from "../../airportLookup";
import { addAirportAnchors } from "../airportAnchors";
import type { FlightAnchor, GroundArea, PlanStation } from "../types";
import { PORT_CARROW } from "./placeFixtures";
import { anchor, groundArea, station } from "./planFixtures";

const AIRPORTS = new Map<string, AirportData>([
  ["NVL", { iata: "NVL", name: "Northvale International Airport", lat: -45.02, lon: 168.74 }],
  ["KMR", { iata: "KMR", name: "Kelmore Airport / Carrow Air Base", lat: -43.49, lon: 172.53 }],
]);

// ZZ101 lands at Northvale on 2 May; f2 leaves Kelmore on 9 May; f3 leaves Northvale on 2 May.
const ARRIVING = anchor({ id: "f1" });
const LEAVING_KELMORE = anchor({ id: "f2", depDay: "2031-05-09", arrDay: "2031-05-09" });
const LEAVING_NORTHVALE = anchor({
  id: "f3",
  depIata: "NVL",
  dep: { lat: -45.02, lon: 168.74 },
});
const ANCHORS = new Map<string, FlightAnchor>(
  [ARRIVING, LEAVING_KELMORE, LEAVING_NORTHVALE].map((a) => [a.id, a])
);

const inPortCarrow = (key: string): PlanStation =>
  station(key, { title: "Port Carrow", lat: PORT_CARROW.lat, lon: PORT_CARROW.lon });

function run(
  area: Partial<GroundArea>,
  stations: PlanStation[],
  airports: ReadonlyMap<string, AirportData> = AIRPORTS,
  taken = new Set<string>()
) {
  return addAirportAnchors({
    area: groundArea(area),
    stations,
    anchorsById: ANCHORS,
    airports,
    taken,
  });
}

describe("addAirportAnchors", () => {
  it("puts the arrival airport in front when the first station is more than 30 km from it", () => {
    const first = inPortCarrow("pc");
    const result = run({ afterFlightId: "f1" }, [first]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      key: "-900|3375|2031-05-02",
      title: "Northvale",
      titleSource: "airport",
      kind: "airport",
      lat: -45.02,
      lon: 168.74,
      snappedKm: null,
      firstDay: "2031-05-02",
      lastDay: "2031-05-02",
      firstLocal: null,
      lastLocal: null,
      photoCount: 0,
      previewIdx: [],
      notes: null,
    });
    expect(result[1]).toBe(first);
  });

  it("adds nothing when the first station is within 30 km of the airport", () => {
    const near = station("n1", { lat: -45.03, lon: 168.72 });
    expect(run({ afterFlightId: "f1" }, [near])).toEqual([near]);
  });

  it("puts the departure airport behind when the last station is far from it", () => {
    const last = inPortCarrow("pc");
    const result = run({ beforeFlightId: "f2" }, [last]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      key: "-870|3451|2031-05-09",
      title: "Kelmore",
      kind: "airport",
      firstDay: "2031-05-09",
    });
  });

  it("anchors both ends, and a second airport station on the same day gets ~2", () => {
    const taken = new Set<string>();
    const result = run(
      { afterFlightId: "f1", beforeFlightId: "f3" },
      [inPortCarrow("pc")],
      AIRPORTS,
      taken
    );
    expect(result.map((s) => [s.kind, s.key])).toEqual([
      ["airport", "-900|3375|2031-05-02"],
      ["visit", "pc"],
      ["airport", "-900|3375|2031-05-02~2"],
    ]);
    expect([...taken]).toEqual(["-900|3375|2031-05-02", "-900|3375|2031-05-02~2"]);
  });

  it("adds nothing at an end with no flight, or with a flight the logbook did not load", () => {
    const only = [inPortCarrow("pc")];
    expect(run({}, only)).toEqual(only);
    expect(run({ afterFlightId: "unknown", beforeFlightId: "unknown" }, only)).toEqual(only);
  });

  it("falls back to '<IATA> airport' without a catalogue row, and to nothing without a code", () => {
    const result = run({ afterFlightId: "f1" }, [inPortCarrow("pc")], new Map());
    expect(result[0].title).toBe("NVL airport");
    const noCode = new Map([["f9", anchor({ id: "f9", arrIata: null })]]);
    const bare = addAirportAnchors({
      area: groundArea({ afterFlightId: "f9" }),
      stations: [inPortCarrow("pc")],
      anchorsById: noCode,
      airports: new Map(),
      taken: new Set(),
    });
    expect(bare).toHaveLength(1);
  });

  it("has nothing to anchor to when the area has no stations, and leaves its input alone", () => {
    expect(run({ afterFlightId: "f1", beforeFlightId: "f3" }, [])).toEqual([]);
    const stations = [inPortCarrow("pc")];
    run({ afterFlightId: "f1" }, stations);
    expect(stations).toHaveLength(1);
  });
});
