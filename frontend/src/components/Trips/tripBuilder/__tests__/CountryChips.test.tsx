import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import CountryChips from "../CountryChips";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

function renderChips(countries: string[]) {
  const onChange = vi.fn();
  render(<CountryChips countries={countries} onChange={onChange} />);
  return onChange;
}

const input = () => screen.getByLabelText("tripBuilder:review.header.addCountry");

describe("CountryChips", () => {
  it("shows each country by its code", () => {
    renderChips(["NZ", "AU"]);
    expect(screen.getByText("NZ")).toBeInTheDocument();
    expect(screen.getByText("AU")).toBeInTheDocument();
  });

  it("takes a country off", () => {
    const onChange = renderChips(["NZ", "AU"]);
    fireEvent.click(
      screen.getByRole("button", { name: 'tripBuilder:review.header.removeCountry {"code":"NZ"}' })
    );
    expect(onChange).toHaveBeenCalledWith(["AU"]);
  });

  it("adds a country on Enter, in capitals, and clears the field", () => {
    const onChange = renderChips(["NZ"]);
    fireEvent.change(input(), { target: { value: "au" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["NZ", "AU"]);
    expect(input()).toHaveValue("");
  });

  it("adds a country when the field is left", () => {
    const onChange = renderChips([]);
    fireEvent.change(input(), { target: { value: "fj" } });
    fireEvent.blur(input());
    expect(onChange).toHaveBeenCalledWith(["FJ"]);
  });

  it("ignores something that is not a two-letter code, and a country already there", () => {
    const onChange = renderChips(["NZ"]);
    fireEvent.change(input(), { target: { value: "N" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "nz" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
