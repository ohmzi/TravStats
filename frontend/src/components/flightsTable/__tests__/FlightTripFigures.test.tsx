import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import FlightTripFigures from "../FlightTripFigures";
import type { Trip } from "../../../types";

// The real German engine, so a forgotten interpolation shows up as the raw key
// rather than passing on the mock-everything shortcut.
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

/** One leg, with every field the band's folds read. */
function leg(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "f1",
    airline: "Air Canada",
    flightNumber: "AC2054",
    depIata: "YYZ",
    arrIata: "YYT",
    depLat: 43.68,
    depLon: -79.63,
    arrLat: 47.62,
    arrLon: -52.75,
    depName: "Toronto",
    arrName: "St. John's",
    depCity: "Toronto",
    arrCity: "St. John's",
    departureTime: "2026-06-12T08:00:00.000Z",
    arrivalTime: "2026-06-12T11:08:00.000Z",
    depTimeSemantics: "UTC",
    routeDistance: 2100,
    ...over,
  };
}

function trip(over: Record<string, unknown> = {}): Trip {
  return {
    id: "t1",
    name: "St.Johns NL 2026",
    startDate: "2026-06-12T00:00:00.000Z",
    endDate: "2026-06-22T00:00:00.000Z",
    flights: [leg()],
    immichAlbums: [],
    ...over,
  } as unknown as Trip;
}

/** The band's `<dl>` — the grid the alignment's column choice lands on. */
function bandGrid(t: Trip): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <FlightTripFigures trip={t} onShowFlights={() => {}} />
    </MemoryRouter>
  );
  const dl = container.querySelector("dl");
  if (!dl) throw new Error("the band drew no grid");
  return dl as HTMLElement;
}

/** The cell whose mono label is `label`, by its text — the band draws `dt` then `dd`. */
function cellOf(dl: HTMLElement, label: string): HTMLElement {
  const cell = [...dl.children].find((c) => c.querySelector("dt")?.textContent === label);
  if (!cell) throw new Error(`the band drew no ${label} cell`);
  return cell as HTMLElement;
}

function valueOf(dl: HTMLElement, label: string): string {
  return cellOf(dl, label).querySelector("dd")?.textContent ?? "";
}

/** The anchor a cell's figure wraps, or null when the cell is not an entry point. */
function cellLinkOf(dl: HTMLElement, label: string): HTMLAnchorElement | null {
  return cellOf(dl, label).querySelector("a");
}

/**
 * One roadtrip station on the journey's trip, as `GET /trips/:id` serves it —
 * the shape the band reads the associated roadtrips off (`routeId`). A
 * synthetic place like every other fixture here (public repo).
 */
function station(routeId: string): Record<string, unknown> {
  return {
    id: `s-${routeId}`,
    title: "Somewhere",
    lat: null,
    lon: null,
    startDate: null,
    endDate: null,
    notes: null,
    routeId,
    routeName: "Somewhere loop",
    routeOrderIdx: 0,
    state: "stay",
    nights: 1,
  };
}

/**
 * The span rule as DAYS (owner, 2026-10-11): the journey's nights + 1, both
 * ends inclusive. The headline was "nights" until then; nights stay the data,
 * days are what the reader is shown.
 */
describe("FlightTripFigures journey days", () => {
  /** Out on 12 June, home on the 17th: five nights away, six days. */
  const fiveNights: Trip = trip({
    flights: [
      leg(),
      leg({
        id: "f2",
        depIata: "YYT",
        arrIata: "YYZ",
        depName: "St. John's",
        arrName: "Toronto",
        depCity: "St. John's",
        arrCity: "Toronto",
        departureTime: "2026-06-17T08:00:00.000Z",
        arrivalTime: "2026-06-17T11:08:00.000Z",
      }),
    ],
  });

  it("counts the same span as DAYS — five nights away is six days, and nights leave the band", () => {
    const dl = bandGrid(fiveNights);
    expect(valueOf(dl, "Tage")).toBe("6");
    expect([...dl.children].some((c) => c.querySelector("dt")?.textContent === "Nächte")).toBe(
      false
    );
  });

  it("is a dash with its reason, never a zero, when no leg is dated", () => {
    const dl = bandGrid(trip({ flights: [leg({ departureTime: null, arrivalTime: null })] }));
    expect(valueOf(dl, "Tage")).toBe("—");
    expect(cellOf(dl, "Tage").getAttribute("title")).toBe("Kein datierter Flug für diese Reise.");
  });

  it("counts the full span in days for the same dates the journey head's dates name", () => {
    // 12 → 22 June is eleven days, counted inclusively on both ends: the band
    // folds the journey's span (+ its arrival day), so a drift between the
    // dates a reader sees and the figure would show the same trip as two
    // lengths.
    const t = trip({
      status: "completed",
      countries: [],
      destinationLabel: null,
      coverImageUrl: null,
      icon: null,
      flights: [
        leg(),
        leg({
          id: "f2",
          depIata: "YYT",
          arrIata: "YYZ",
          depName: "St. John's",
          arrName: "Toronto",
          depCity: "St. John's",
          arrCity: "Toronto",
          departureTime: "2026-06-22T08:00:00.000Z",
          arrivalTime: "2026-06-22T11:08:00.000Z",
        }),
      ],
    });
    expect(valueOf(bandGrid(t), "Tage")).toBe("11");
  });
});

/**
 * The grid `FigureTripFigures` asks for is the alignment's central decision and
 * has no other guard: it is `[2, 4, 7]`, NOT the roadtrip band's `[2, 3, 6]`
 * (seven cells three-across would be THREE rows, which reads less like the
 * reference's two than four does). A regression to `[2, 3, 7]` would find no
 * `GRID` entry and silently fall back to a count-derived grid, so the classes
 * are pinned here rather than left to a caller's comment.
 */
describe("FlightTripFigures band shape", () => {
  it("paints the journey's seven cells on the roadtrip band's furniture, four across sm", () => {
    const dl = bandGrid(trip());
    expect(dl.className).toContain("grid-cols-2");
    expect(dl.className).toContain("sm:grid-cols-4");
    expect(dl.className).toContain("xl:grid-cols-7");
    expect([...dl.children]).toHaveLength(7);
  });

  it("resets the album — the last cell — to one track at xl, so the row never wraps", () => {
    const dl = bandGrid(trip());
    const last = dl.children[dl.children.length - 1];
    // Base and sm leave a track free, which the album spans; xl fills the row,
    // so the span is reset. Without `xl:col-span-1` the album wraps to a second
    // row at xl — the exact difference the owner would see.
    expect(last.className).toContain("col-span-2");
    expect(last.className).toContain("xl:col-span-1");
  });
});

/**
 * The band as navigation (owner request 2026-10-14). Ruling 4: there is no
 * airport page, so Distance, Cities and Airports all return to the flight-trip
 * page's OWN Route view (a bare `/flights/journeys/:id`, the `?view=` param
 * dropped) — from the table view that is genuinely useful. Ruling 2: the Days
 * cell opens the one associated roadtrip's timeline when there is exactly one,
 * and the journey's Trips tab otherwise (none or several).
 */
describe("FlightTripFigures band as navigation (owner request 2026-10-14)", () => {
  it("links Distance, Cities and Airports back to the route view", () => {
    const dl = bandGrid(trip());
    for (const label of ["Zurückgelegt", "Städte", "Flughäfen"]) {
      expect(cellLinkOf(dl, label)).toHaveAttribute("href", "/flights/journeys/t1");
    }
  });

  it("links the Days cell to the single associated roadtrip's timeline", () => {
    const dl = bandGrid(trip({ roadtripStations: [station("rt-1")] }));
    expect(cellLinkOf(dl, "Tage")).toHaveAttribute("href", "/roadtrips/rt-1?tab=timeline");
  });

  it("falls back to the journey's Trips tab when several roadtrips are associated", () => {
    const dl = bandGrid(trip({ roadtripStations: [station("rt-1"), station("rt-2")] }));
    expect(cellLinkOf(dl, "Tage")).toHaveAttribute("href", "/trips/t1?tab=trips");
  });

  it("falls back to the journey's Trips tab when no roadtrip is associated", () => {
    const dl = bandGrid(trip());
    expect(cellLinkOf(dl, "Tage")).toHaveAttribute("href", "/trips/t1?tab=trips");
  });

  it("keeps the Flights cell a button — it swaps the body in place, it does not navigate", () => {
    const dl = bandGrid(trip());
    const cell = cellOf(dl, "Flug");
    expect(cell.querySelector("a")).toBeNull();
    expect(cell.querySelector("button")).not.toBeNull();
  });
});
