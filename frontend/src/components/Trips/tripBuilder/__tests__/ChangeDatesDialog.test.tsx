import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ChangeDatesDialog from "../ChangeDatesDialog";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

function renderDialog(open = true) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ChangeDatesDialog
      open={open}
      startDay="2031-05-02"
      endDay="2031-05-07"
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
  return { onConfirm, onClose };
}

const start = () => screen.getByLabelText("tripBuilder:review.dates.start");
const end = () => screen.getByLabelText(/tripBuilder:review\.dates\.end/);
const scanAgain = () => screen.getByRole("button", { name: "tripBuilder:review.dates.scanAgain" });

describe("ChangeDatesDialog", () => {
  it("draws nothing while closed", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("starts on the days the draft was scanned for, and will not scan the same days again", () => {
    renderDialog();
    expect(start()).toHaveValue("2031-05-02");
    expect(end()).toHaveValue("2031-05-07");
    expect(scanAgain()).toBeDisabled();
  });

  it("scans again for the days picked", () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(end(), { target: { value: "2031-05-09" } });
    expect(scanAgain()).toBeEnabled();
    fireEvent.click(scanAgain());
    expect(onConfirm).toHaveBeenCalledWith({ startDay: "2031-05-02", endDay: "2031-05-09" });
  });

  it("says an end before the start is not one, and will not scan", () => {
    renderDialog();
    fireEvent.change(end(), { target: { value: "2031-05-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("tripBuilder:review.dates.reversed");
    expect(scanAgain()).toBeDisabled();
  });

  it("says a window past 62 days is too long", () => {
    renderDialog();
    fireEvent.change(end(), { target: { value: "2031-07-20" } });
    expect(screen.getByRole("alert")).toHaveTextContent("tripBuilder:review.dates.tooLong");
    expect(scanAgain()).toBeDisabled();
  });

  it("says so when a day is missing", () => {
    renderDialog();
    fireEvent.change(start(), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("tripBuilder:review.dates.incomplete");
  });

  it("closes without scanning", () => {
    const { onClose, onConfirm } = renderDialog();
    fireEvent.click(screen.getAllByRole("button", { name: "tripBuilder:review.dates.cancel" })[0]);
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("draws the footer's dismiss and its amber action at one shared height", () => {
    renderDialog();
    // The two controls sit side by side, so they are one size (owner,
    // 2026-10-11: "all these should be same size"). The dismiss is the Dialog
    // shell's 46; the trip builder's amber action joins it.
    expect(screen.getByText("tripBuilder:review.dates.cancel").style.height).toBe(
      "var(--ts-size-button-secondary)"
    );
    expect(scanAgain().style.height).toBe("var(--ts-size-button-secondary)");
  });
});
