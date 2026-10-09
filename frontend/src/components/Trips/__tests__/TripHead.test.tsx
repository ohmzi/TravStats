import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";
import type { useTranslation } from "../../../hooks/useTranslation";

/**
 * The trip head's country chips.
 *
 * The chip shows a flag AND the country's name; the flag used to carry the same
 * name again in its `alt`, so the chip's accessible name held it twice and a
 * plain-text copy concatenated "United Arab EmiratesUnited Arab Emirates"
 * (owner, 2026-10-09). The flag is now decorative and the name is spoken once.
 * A stored `trip.countries` can also repeat an entry — the backend returns a
 * user-filled list untouched — which must draw one chip, not two.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

import TripHead from "../TripHead";

const trip = (countries: string[]): Trip =>
  ({
    id: "t1",
    name: "QA Reise",
    status: "completed",
    countries,
    startDate: null,
    endDate: null,
    destinationLabel: null,
    coverImageUrl: null,
    icon: null,
    color: "#3b82f6",
  }) as unknown as Trip;

function renderHead(countries: string[], locale = "en"): HTMLElement {
  const t: ReturnType<typeof useTranslation>["t"] = (key) => key;
  const { container } = render(
    <MemoryRouter>
      <TripHead
        trip={trip(countries)}
        locale={locale}
        t={t}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </MemoryRouter>
  );
  return container;
}

const chips = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("ul > li"),
];

describe("TripHead country chips", () => {
  it("names the country once, with the flag marked decorative", () => {
    const [chip] = chips(renderHead(["AE"]));
    const img = chip.querySelector("img");
    // The name is in the text node; the flag adds nothing to the accessible
    // name, so a screen reader and a copy both see it exactly once.
    expect(chip.textContent).toBe("United Arab Emirates");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.hasAttribute("title")).toBe(false);
  });

  it("renders one chip for a duplicated country entry", () => {
    const rendered = chips(renderHead(["AE", "AE"]));
    expect(rendered).toHaveLength(1);
    expect(rendered[0].textContent).toBe("United Arab Emirates");
  });

  it("renders one chip per distinct country", () => {
    const rendered = chips(renderHead(["CA", "PK"]));
    expect(rendered.map((c) => c.textContent)).toEqual(["Canada", "Pakistan"]);
  });
});
