import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import EntityHeader from "../EntityHeader";

/**
 * The head both levels draw (design 2026-10-12 §2.1): the name and the country
 * flags, and ONE action — Edit — at the level's edit page. The key-returning
 * mock keeps the assertion on WHICH key each slot takes; the flags' own names
 * come from `countryName` with the mocked English language, as in
 * `TripHead.test.tsx`.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
  }),
}));

function renderHeader(level: "journey" | "trip", id: string, countries: string[]) {
  return render(
    <MemoryRouter>
      <EntityHeader level={level} id={id} name="Northvale loop" countries={countries} />
    </MemoryRouter>
  );
}

/** The country chips, the same query TripHead's test uses. */
const chips = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("ul > li"),
];

describe("the journey's head", () => {
  it("heads the name and links its one Edit action at the journey's edit page", () => {
    renderHeader("journey", "t1", []);
    expect(screen.getByRole("heading", { level: 1, name: "Northvale loop" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "common:buttons.edit" })).toHaveAttribute(
      "href",
      "/trips/t1/edit"
    );
    // Edit is the amber action on every head (owner, 2026-10-15).
    expect(screen.getByRole("link", { name: "common:buttons.edit" })).toHaveAttribute(
      "data-variant",
      "primary"
    );
    expect(screen.getByRole("link", { name: "trips:tab" })).toHaveAttribute("href", "/trips");
  });

  it("offers no second action and no crumb the design removed", () => {
    const { container } = renderHeader("journey", "t1", ["DE"]);
    // Edit is a LINK; the head carries no buttons at all (no Delete, no Re-sync
    // — design §4 moved both to the edit page).
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("link", { name: "common:buttons.edit" })).toHaveLength(1);
    expect(container.querySelector('a[href$="/resync"]')).toBeNull();
    // The meta line, the status pill and the vehicle crumb are gone.
    expect(screen.queryByText(/trips:status\./)).toBeNull();
    expect(screen.queryByText(/trips:head\./)).toBeNull();
    expect(screen.queryByText(/roadtrips:vehicle\./)).toBeNull();
  });

  it("draws one flag chip per distinct country, each naming it once", () => {
    const { container } = renderHeader("journey", "t1", ["DE", "DE", "FR"]);
    const drawn = chips(container);
    expect(drawn.map((chip) => chip.textContent)).toEqual(["Germany", "France"]);
    expect(drawn[0].querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("draws no flag list for a journey with no countries", () => {
    const { container } = renderHeader("journey", "t1", []);
    expect(chips(container)).toHaveLength(0);
  });
});

describe("the trip's head", () => {
  it("links its one Edit action at the trip's edit page and back to the roadtrips", () => {
    renderHeader("trip", "r1", ["NO"]);
    expect(screen.getByRole("heading", { level: 1, name: "Northvale loop" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "common:buttons.edit" })).toHaveAttribute(
      "href",
      "/roadtrips/r1/edit"
    );
    // Edit is the amber action on every head (owner, 2026-10-15).
    expect(screen.getByRole("link", { name: "common:buttons.edit" })).toHaveAttribute(
      "data-variant",
      "primary"
    );
    expect(screen.getByRole("link", { name: "roadtrips:pageTitle" })).toHaveAttribute(
      "href",
      "/roadtrips"
    );
  });

  it("carries neither the vehicle crumb nor a status pill", () => {
    renderHeader("trip", "r1", []);
    expect(screen.queryByText(/roadtrips:vehicle\./)).toBeNull();
    expect(screen.queryByText(/roadtrips:phase\./)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
