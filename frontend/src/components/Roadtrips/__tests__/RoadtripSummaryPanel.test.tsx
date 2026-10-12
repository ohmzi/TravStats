import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const summarize = vi.fn();
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { summarize: (...args: unknown[]) => summarize(...args) },
}));

// Whether the instance has a text model; a box so the cases can flip it.
const llmState = vi.hoisted(() => ({ current: true as boolean | "disabled" | null }));
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => llmState.current }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

import RoadtripSummaryPanel from "../RoadtripSummaryPanel";

/**
 * The trip's summary is written in the reader's language like the journey's,
 * against the trip's own route (`POST /roadtrips/:id/summarize`).
 */
describe("RoadtripSummaryPanel", () => {
  beforeEach(() => {
    summarize.mockReset();
    summarize.mockResolvedValue({ summary: "…", model: "m", language: "en", durationMs: 1 });
  });

  afterEach(() => {
    llmState.current = true;
  });

  it("asks for an English summary when the UI is English", async () => {
    render(
      <RoadtripSummaryPanel roadtripId="rt1" summary={null} language="en-GB" onChanged={vi.fn()} />
    );
    fireEvent.click(screen.getByText("roadtrips:summary.generateButton"));
    await waitFor(() => expect(summarize).toHaveBeenCalledWith("rt1", "en"));
  });

  it("shows a stored summary and regenerates through the trip's route", async () => {
    render(
      <RoadtripSummaryPanel
        roadtripId="rt1"
        summary="Elf Tage um die Insel."
        language="de"
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByText("Elf Tage um die Insel.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("roadtrips:summary.regenerate"));
    await waitFor(() => expect(summarize).toHaveBeenCalledWith("rt1", "de"));
  });

  it("names the admin's switch when the server refuses with LLM_DISABLED", async () => {
    summarize.mockRejectedValue({ response: { status: 503, data: { code: "LLM_DISABLED" } } });
    render(
      <RoadtripSummaryPanel roadtripId="rt1" summary={null} language="de" onChanged={vi.fn()} />
    );
    fireEvent.click(screen.getByText("roadtrips:summary.generateButton"));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "roadtrips:summary.disabled")
    );
  });

  it("says what is missing on an instance with no model, instead of offering the button", () => {
    llmState.current = false;
    render(
      <RoadtripSummaryPanel roadtripId="rt1" summary={null} language="de" onChanged={vi.fn()} />
    );

    expect(screen.getByTestId("roadtrip-summary-unavailable").textContent).toContain(
      "roadtrips:summary.unavailable"
    );
    expect(screen.queryByText("roadtrips:summary.generateButton")).not.toBeInTheDocument();
  });
});
