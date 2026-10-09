import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

import TripSpendSection from "../TripSpendSection";
import { DEFAULT_TRIP_SPEND_SETTING } from "../../../lib/tripSpendCurrency";
import { useTripSpendStore } from "../../../store/tripSpendStore";
import { SECTION_ICON } from "../../../pages/Settings/sectionIcons";
import { SECTION_LABEL_KEY } from "../../../pages/Settings/sectionLabels";
import { groupOfSection } from "../../../pages/Settings/settingsModel";

/**
 * Settings → Trip spending: the currency the trip page's spend card prints
 * large, and the rate that converts the other one. Every choice lands in the
 * store the card reads, so the card follows without a reload.
 */
describe("TripSpendSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useTripSpendStore.setState({ ...DEFAULT_TRIP_SPEND_SETTING, seenMarketUsdCad: null });
  });

  it("sits with trips, under its own label and icon", () => {
    expect(groupOfSection("tripSpend")?.id).toBe("trips");
    expect(SECTION_LABEL_KEY.tripSpend).toBe("settings:tripSpend.title");
    expect(SECTION_ICON.tripSpend).toBe("wallet");
  });

  it("chooses the primary currency", async () => {
    render(<TripSpendSection />);
    const group = screen.getByRole("radiogroup", { name: "settings:tripSpend.primary.label" });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "USD" }));
    expect(useTripSpendStore.getState().primary).toBe("USD");
  });

  it("enables the rate field only for my rate, and stores a valid rate as it is typed", async () => {
    render(<TripSpendSection />);
    const field = screen.getByLabelText("settings:tripSpend.customRate.label");
    expect(field).toBeDisabled();
    expect(screen.getByText("settings:tripSpend.customRate.disabledHint")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("radio", { name: "settings:tripSpend.rateMode.custom" })
    );
    expect(useTripSpendStore.getState().rateMode).toBe("custom");
    expect(field).toBeEnabled();

    await userEvent.type(field, "1,36");
    expect(useTripSpendStore.getState().customUsdCad).toBe(1.36);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses what is not a rate, says so, and keeps the last good one", async () => {
    useTripSpendStore.setState({ rateMode: "custom", customUsdCad: 1.35 });
    render(<TripSpendSection />);
    const field = screen.getByLabelText("settings:tripSpend.customRate.label");
    expect(field).toHaveValue("1.35");

    await userEvent.type(field, "x");
    expect(screen.getByRole("alert")).toHaveTextContent("settings:tripSpend.customRate.invalid");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(useTripSpendStore.getState().customUsdCad).toBe(1.35);
  });

  it("refuses zero, and reads an emptied field as no rate", async () => {
    useTripSpendStore.setState({ rateMode: "custom", customUsdCad: 1.35 });
    render(<TripSpendSection />);
    const field = screen.getByLabelText("settings:tripSpend.customRate.label");

    await userEvent.clear(field);
    expect(useTripSpendStore.getState().customUsdCad).toBeNull();
    await userEvent.type(field, "0");
    expect(screen.getByRole("alert")).toHaveTextContent("settings:tripSpend.customRate.invalid");
    expect(useTripSpendStore.getState().customUsdCad).toBeNull();
  });

  it("offers the latest market rate a card has seen as the placeholder", () => {
    useTripSpendStore.setState({ rateMode: "custom", seenMarketUsdCad: 1.3712 });
    render(<TripSpendSection />);
    expect(screen.getByLabelText("settings:tripSpend.customRate.label")).toHaveAttribute(
      "placeholder",
      "1.3712"
    );
    expect(screen.getByText(/settings:tripSpend\.customRate\.latest/)).toHaveTextContent(
      '{"rate":"1.3712"}'
    );
  });

  it("falls back to a generic placeholder when no rate has been seen", () => {
    render(<TripSpendSection />);
    expect(screen.getByLabelText("settings:tripSpend.customRate.label")).toHaveAttribute(
      "placeholder",
      "settings:tripSpend.customRate.placeholder"
    );
  });

  it("shows a rate that arrives from another device", () => {
    useTripSpendStore.setState({ rateMode: "custom", customUsdCad: 1.35 });
    render(<TripSpendSection />);
    act(() => useTripSpendStore.setState({ customUsdCad: 1.41 }));
    expect(screen.getByLabelText("settings:tripSpend.customRate.label")).toHaveValue("1.41");
  });
});
