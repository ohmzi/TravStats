import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import FlightTripFigures from "../FlightTripFigures";
import TripHead from "../../Trips/TripHead";
import { germanT } from "../../../__tests__/helpers/germanT";
import type { useTranslation } from "../../../hooks/useTranslation";
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

  it("agrees with the trip page meta's own day count for the same dates", () => {
    // 12 → 22 June is eleven days, counted inclusively on both surfaces: the
    // band folds the journey's span (+ its arrival day), the head its dates
    // (+ 1). A drift between the two would show the same trip as two lengths.
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
    render(
      <MemoryRouter>
        <TripHead
          trip={t}
          locale="de"
          t={germanT as unknown as ReturnType<typeof useTranslation>["t"]}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </MemoryRouter>
    );
    expect(document.body.textContent).toContain("11 Tage");
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
