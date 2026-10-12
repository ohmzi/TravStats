/**
 * The rules the rename script rides on, with synthetic fixtures only
 * (invented journeys, invented cities, years 2031+): the legacy-shape city
 * parse, the "row sits strictly between two adjacent same-airport flights"
 * matcher, the imported pitstop city chain, the album linkage the trip page
 * resolves, and the plan the scan's own naming pass gives a journey's rows.
 */
import { describe, expect, it } from "@jest/globals";

import type { AirportData } from "../../airportLookup";
import { pitstopCity } from "../pitstops";
import type { FlightAnchor } from "../types";
import {
  cityFromRowName,
  pitstopFlights,
  planJourneyRename,
  rowAlbumOf,
  rowCityOf,
  type LinkedAlbumRef,
  type RenameRowInput,
} from "../renameExisting";
import { makeAnchor } from "./photoFixtures";

function flight(over: Partial<FlightAnchor>): FlightAnchor {
  return makeAnchor(over);
}

/** NVL → PCR arriving 2 May 2031. */
const ARRIVES_PCR = flight({
  id: "f1",
  label: "ZZ101 NVL→PCR",
  depIata: "NVL",
  arrIata: "PCR",
  depDay: "2031-05-02",
  arrDay: "2031-05-02",
});

/** PCR → KEL leaving 9 May 2031. */
const LEAVES_PCR = flight({
  id: "f2",
  label: "ZZ102 PCR→KEL",
  depIata: "PCR",
  arrIata: "KEL",
  depDay: "2031-05-09",
  arrDay: "2031-05-09",
});

const PCR_ROW = { startDay: "2031-05-04", endDay: "2031-05-06" };

/** The catalogue row the pitstop city chain reads: a served-city slash list. */
const PCR_AIRPORT: AirportData = {
  iata: "PCR",
  icao: "ZZPC",
  name: "Port Carrow International Airport",
  city: "Seeb",
  country: "Inventia",
  lat: -43.489,
  lon: 172.532,
  municipalityName: "Port Carrow/Seeb",
};

function album(linkId: string, albumName: string): LinkedAlbumRef {
  return { linkId, immichAlbumId: `immich-${linkId}`, albumName };
}

function row(over: Partial<RenameRowInput>): RenameRowInput {
  return {
    id: "row-1",
    name: "Summer loop",
    startDay: "2031-05-02",
    endDay: "2031-05-04",
    city: null,
    citySource: "none",
    ...over,
  };
}

describe("cityFromRowName", () => {
  it("reads the city after the convention's separator", () => {
    expect(cityFromRowName("Karachi 2031 · Elmwood")).toEqual({
      city: "Elmwood",
      source: "separator",
    });
  });

  it("takes the segment after the LAST separator", () => {
    expect(cityFromRowName("Karachi 2031 · Summer · Elmwood")).toEqual({
      city: "Elmwood",
      source: "separator",
    });
  });

  it("reads the leading city of the legacy stopover shape", () => {
    expect(cityFromRowName("Oakville 2031 Road Trip")).toEqual({
      city: "Oakville",
      source: "legacy",
    });
  });

  it("reads the leading city of the legacy pitstop shape, parenthetical and all", () => {
    expect(cityFromRowName("Port Carrow 2031 Road Trip (Karachi 2031)")).toEqual({
      city: "Port Carrow",
      source: "legacy",
    });
  });

  it("accepts a multi-word city in the legacy shape", () => {
    expect(cityFromRowName("Fort St. Kelmore 2031 Road Trip")).toEqual({
      city: "Fort St. Kelmore",
      source: "legacy",
    });
  });

  it("refuses a name of neither shape", () => {
    expect(cityFromRowName("Summer loop")).toBeNull();
  });

  it("refuses a legacy-looking name with no leading city", () => {
    expect(cityFromRowName("2031 Road Trip")).toBeNull();
  });
});

describe("pitstopFlights", () => {
  it("matches the two adjacent flights that share an airport around the row", () => {
    expect(pitstopFlights([ARRIVES_PCR, LEAVES_PCR], PCR_ROW)).toEqual({
      arriving: ARRIVES_PCR,
      departing: LEAVES_PCR,
    });
  });

  it("does not match a pair that shares no airport", () => {
    const leavesNvl = flight({
      id: "f2",
      depIata: "NVL",
      arrIata: "KEL",
      depDay: "2031-05-09",
      arrDay: "2031-05-09",
    });
    expect(pitstopFlights([ARRIVES_PCR, leavesNvl], PCR_ROW)).toBeNull();
  });

  it("does not match a pair on the same local day — that is a layover", () => {
    const sameDay = flight({
      id: "f2",
      depIata: "PCR",
      arrIata: "KEL",
      depDay: "2031-05-02",
      arrDay: "2031-05-02",
    });
    expect(pitstopFlights([ARRIVES_PCR, sameDay], PCR_ROW)).toBeNull();
  });

  it("does not match a row touching a flanking flight's own day", () => {
    expect(
      pitstopFlights([ARRIVES_PCR, LEAVES_PCR], { startDay: "2031-05-02", endDay: "2031-05-06" })
    ).toBeNull();
    expect(
      pitstopFlights([ARRIVES_PCR, LEAVES_PCR], { startDay: "2031-05-04", endDay: "2031-05-09" })
    ).toBeNull();
  });

  it("does not match a row with no flanking flights", () => {
    expect(pitstopFlights([], PCR_ROW)).toBeNull();
    expect(pitstopFlights([ARRIVES_PCR], PCR_ROW)).toBeNull();
  });

  it("matches only the pair whose own gap holds the row", () => {
    const leavesNvl = flight({
      id: "f3",
      depIata: "NVL",
      arrIata: "PCR",
      depDay: "2031-05-12",
      arrDay: "2031-05-12",
    });
    const returnsPcr = flight({
      id: "f4",
      depIata: "PCR",
      arrIata: "NVL",
      depDay: "2031-05-16",
      arrDay: "2031-05-16",
    });
    // Only the later gap (f3's arrival → f4's departure) holds the row.
    expect(
      pitstopFlights([ARRIVES_PCR, LEAVES_PCR, leavesNvl, returnsPcr], {
        startDay: "2031-05-13",
        endDay: "2031-05-15",
      })
    ).toEqual({ arriving: leavesNvl, departing: returnsPcr });
  });
});

describe("rowCityOf", () => {
  it("names a pitstop after the shared airport's served city, slash list first", () => {
    expect(
      rowCityOf({
        name: "Karachi 2031 · Seeb",
        span: PCR_ROW,
        flights: [ARRIVES_PCR, LEAVES_PCR],
        airports: new Map([["PCR", PCR_AIRPORT]]),
      })
    ).toEqual({ city: "Port Carrow", source: "pitstop" });
  });

  it("falls through to the row's own name when the catalogue cannot say", () => {
    expect(
      rowCityOf({
        name: "Karachi 2031 · Elmwood",
        span: PCR_ROW,
        flights: [ARRIVES_PCR, LEAVES_PCR],
        airports: new Map(),
      })
    ).toEqual({ city: "Elmwood", source: "separator" });
  });

  it("reads the row's own name when no pair flanks it", () => {
    expect(
      rowCityOf({
        name: "Oakville 2031 Road Trip",
        span: null,
        flights: [],
        airports: new Map(),
      })
    ).toEqual({ city: "Oakville", source: "legacy" });
  });

  it("answers no city for a name of neither shape", () => {
    expect(
      rowCityOf({ name: "Summer loop", span: null, flights: [], airports: new Map() })
    ).toEqual({ city: null, source: "none" });
  });
});

describe("pitstopCity", () => {
  it("takes the first name of a served-city slash list", () => {
    expect(pitstopCity(PCR_AIRPORT, null)).toBe("Port Carrow");
  });

  it("falls back to the airport's display name, then to the given fallback", () => {
    expect(
      pitstopCity({ name: "Kelmore Airport", city: "Kelmore", lat: -41, lon: 174 }, null)
    ).toBe("Kelmore");
    expect(pitstopCity(null, "Elmwood")).toBe("Elmwood");
  });
});

describe("rowAlbumOf", () => {
  const JOURNEY = "Karachi 2031";
  const MAIN = album("link-main", JOURNEY);

  it("matches the row's exact name — the one new-convention pair", () => {
    const own = album("link-own", `${JOURNEY} · Elmwood`);
    expect(rowAlbumOf(JOURNEY, [MAIN, own], `${JOURNEY} · Elmwood`)).toEqual({
      kind: "own",
      via: "name",
      album: own,
    });
  });

  it("matches the legacy pitstop pair a stored row still carries", () => {
    const own = album("link-pit", "Port Carrow 2031 Road Trip (Karachi 2031)");
    expect(rowAlbumOf(JOURNEY, [MAIN, own], `${JOURNEY} · Port Carrow`)).toEqual({
      kind: "own",
      via: "legacy",
      album: own,
    });
  });

  it("resolves the journey's first album for a row that pairs with none", () => {
    expect(rowAlbumOf(JOURNEY, [MAIN], "Summer loop")).toEqual({
      kind: "journey",
      album: MAIN,
    });
  });

  it("answers none for a journey that links no album", () => {
    expect(rowAlbumOf(JOURNEY, [], "Summer loop")).toEqual({ kind: "none" });
  });
});

describe("planJourneyRename", () => {
  it("names a one-trip journey's row the journey's own name", () => {
    const plans = planJourneyRename("Southern loop", "2031-04-30", [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
    ]);
    expect(plans).toEqual([
      {
        rowId: "r1",
        oldName: "Elmwood 2031 Road Trip",
        newName: "Southern loop",
        changed: true,
        skipped: null,
      },
    ]);
  });

  it("leaves a one-trip journey's already-conventional row unchanged", () => {
    const plans = planJourneyRename("Southern loop", "2031-04-30", [
      row({ id: "r1", name: "Southern loop", city: null, citySource: "none", startDay: null }),
    ]);
    expect(plans).toEqual([
      {
        rowId: "r1",
        oldName: "Southern loop",
        newName: "Southern loop",
        changed: false,
        skipped: null,
      },
    ]);
  });

  it("skips a one-trip journey's row of no derivable city and no journey name", () => {
    const plans = planJourneyRename("Southern loop", "2031-04-30", [
      row({ id: "r1", name: "Summer loop", city: null, citySource: "none" }),
    ]);
    expect(plans[0].changed).toBe(false);
    expect(plans[0].skipped).toMatch(/no city/);
  });

  it("names a multi-trip journey's rows <journey> · <city>", () => {
    const plans = planJourneyRename("Karachi 2031", "2031-05-01", [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
      row({
        id: "r2",
        name: "Northvale 2031 Road Trip",
        city: "Northvale",
        citySource: "legacy",
        startDay: "2031-06-01",
      }),
    ]);
    expect(plans.map((p) => p.newName)).toEqual([
      "Karachi 2031 · Elmwood",
      "Karachi 2031 · Northvale",
    ]);
    expect(plans.every((p) => p.changed && p.skipped === null)).toBe(true);
  });

  it("doles out the ` (d MMM)` suffix when two rows derive the same name", () => {
    const plans = planJourneyRename("Karachi 2031", "2031-05-01", [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
      row({
        id: "r2",
        name: "Elmwood 2032 Road Trip",
        city: "Elmwood",
        citySource: "legacy",
        startDay: "2031-06-06",
      }),
    ]);
    expect(plans.map((p) => p.newName)).toEqual([
      "Karachi 2031 · Elmwood (2 May)",
      "Karachi 2031 · Elmwood (6 Jun)",
    ]);
  });

  it("numbers two same-city rows that start on the same day", () => {
    const plans = planJourneyRename("Karachi 2031", "2031-05-01", [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
      row({
        id: "r2",
        name: "Elmwood 2031 Road Trip (Karachi 2031)",
        city: "Elmwood",
        citySource: "legacy",
      }),
    ]);
    expect(plans.map((p) => p.newName)).toEqual([
      "Karachi 2031 · Elmwood (2 May)",
      "Karachi 2031 · Elmwood (2 May) 2",
    ]);
  });

  it("skips a row of no city and keeps its stored name out of reach", () => {
    const plans = planJourneyRename("Karachi 2031", "2031-05-01", [
      row({ id: "r1", name: "Summer loop", city: null, citySource: "none" }),
      row({ id: "r2", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
    ]);
    expect(plans[0].changed).toBe(false);
    expect(plans[0].newName).toBe("Summer loop");
    expect(plans[0].skipped).toMatch(/no city/);
    expect(plans[1].newName).toBe("Karachi 2031 · Elmwood");
  });

  it("keeps a skipped row's name in the clash pool the pass protects", () => {
    const plans = planJourneyRename("Karachi 2031", null, [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
      row({
        id: "r2",
        name: "Karachi 2031 · Elmwood",
        city: "Elmwood",
        citySource: "separator",
        startDay: null,
        endDay: null,
      }),
    ]);
    expect(plans[1].skipped).toMatch(/no dates/);
    expect(plans[1].newName).toBe("Karachi 2031 · Elmwood");
    expect(plans[0].newName).toBe("Karachi 2031 · Elmwood (2 May)");
  });

  it("reports an already-conventional multi-trip journey unchanged", () => {
    const plans = planJourneyRename("Karachi 2031", "2031-05-01", [
      row({ id: "r1", name: "Karachi 2031 · Elmwood", city: "Elmwood", citySource: "separator" }),
      row({
        id: "r2",
        name: "Karachi 2031 · Northvale",
        city: "Northvale",
        citySource: "separator",
        startDay: "2031-06-01",
      }),
    ]);
    expect(plans.map((p) => p.changed)).toEqual([false, false]);
  });

  it("is idempotent: a second pass over its own answer changes nothing", () => {
    const first = planJourneyRename("Karachi 2031", "2031-05-01", [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
      row({
        id: "r2",
        name: "Elmwood 2032 Road Trip",
        city: "Elmwood",
        citySource: "legacy",
        startDay: "2031-06-06",
      }),
      row({
        id: "r3",
        name: "Northvale 2031 Road Trip",
        city: "Northvale",
        citySource: "legacy",
        startDay: "2031-07-01",
      }),
    ]);
    const second = planJourneyRename(
      "Karachi 2031",
      "2031-05-01",
      [
        row({ id: "r1" }),
        row({ id: "r2", startDay: "2031-06-06" }),
        row({ id: "r3", startDay: "2031-07-01" }),
      ].map((r, i) => {
        const name = first[i].newName;
        const derived = cityFromRowName(name);
        return row({
          id: r.id,
          name,
          startDay: r.startDay,
          city: derived?.city ?? null,
          citySource: derived?.source ?? "none",
        });
      })
    );
    expect(second.map((p) => p.changed)).toEqual([false, false, false]);
    expect(second.map((p) => p.newName)).toEqual(first.map((p) => p.newName));
  });

  it("is idempotent for a one-trip journey renamed to the journey's name", () => {
    const first = planJourneyRename("Southern loop", "2031-04-30", [
      row({ id: "r1", name: "Elmwood 2031 Road Trip", city: "Elmwood", citySource: "legacy" }),
    ]);
    const second = planJourneyRename("Southern loop", "2031-04-30", [
      row({ id: "r1", name: first[0].newName, city: null, citySource: "none" }),
    ]);
    expect(second[0].changed).toBe(false);
  });
});
