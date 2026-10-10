import { isPostReturnArea } from "../home";
import type { FlightAnchor, NightEntry } from "../types";
import { HOME, anchor, groundArea, planOf, station } from "./planFixtures";

const LANDING = anchor({ id: "f1", arrIata: "KMR", arrDay: "2031-05-08" });
const ANCHORS = new Map<string, FlightAnchor>([[LANDING.id, LANDING]]);
const homeAtDay = () => HOME;

const entry = (assign: string): NightEntry => ({
  assign,
  reason: "lastPhoto",
  suggestedStationKeys: [],
});

const wayBack = (stations = [station("k1", { kind: "home", title: "Kelmore" })]) =>
  planOf(stations, {
    area: groundArea({ afterFlightId: "f1", startDay: "2031-05-08", endDay: "2031-05-09" }),
  });

describe("isPostReturnArea", () => {
  it("is the way back when it starts with a landing at a home airport and nobody slept away", () => {
    const nights = { "2031-05-08": entry("home") };
    expect(isPostReturnArea(wayBack(), ANCHORS, nights, homeAtDay)).toBe(true);
  });

  it("is a trip when a night was spent at one of its stations", () => {
    const plan = wayBack([station("k1", { kind: "home" }), station("n1")]);
    expect(isPostReturnArea(plan, ANCHORS, { "2031-05-08": entry("n1") }, homeAtDay)).toBe(false);
  });

  it("counts a night at its home station as home", () => {
    const nights = { "2031-05-08": entry("k1") };
    expect(isPostReturnArea(wayBack(), ANCHORS, nights, homeAtDay)).toBe(true);
  });

  it("is a trip when the landing airport is not a home airport", () => {
    const abroad = new Map([["f1", anchor({ id: "f1", arrIata: "NVL", arrDay: "2031-05-08" })]]);
    expect(isPostReturnArea(wayBack(), abroad, {}, homeAtDay)).toBe(false);
  });

  it("is never the way back without an inbound flight, or with one the logbook lacks", () => {
    const noFlight = planOf([station("k1")], { area: groundArea() });
    expect(isPostReturnArea(noFlight, ANCHORS, {}, homeAtDay)).toBe(false);
    expect(isPostReturnArea(wayBack(), new Map(), {}, homeAtDay)).toBe(false);
  });

  it("is a trip when it has no home on the day of landing", () => {
    expect(isPostReturnArea(wayBack(), ANCHORS, {}, () => null)).toBe(false);
  });

  it("stays a trip when a night inside it is unknown", () => {
    const nights = { "2031-05-08": entry("unknown") };
    expect(isPostReturnArea(wayBack(), ANCHORS, nights, homeAtDay)).toBe(false);
  });

  it("ignores an unknown night outside its days", () => {
    const nights = { "2031-05-12": entry("unknown"), "2031-05-08": entry("home") };
    expect(isPostReturnArea(wayBack(), ANCHORS, nights, homeAtDay)).toBe(true);
  });
});
