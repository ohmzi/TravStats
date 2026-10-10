import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { initialReviewState } from "../../../../lib/tripBuilder/draftEdits";
import { sleptKeys } from "../../../../lib/tripBuilder/planRules";
import { existingDraft, KEY } from "../../../../lib/tripBuilder/__tests__/existingFixture";
import type { DraftDay, TripBuilderDraft } from "../../../../types/tripBuilder";
import { ExistingDiffProvider, useExistingDiff } from "../ExistingDiffContext";
import ReviewDayGroup from "../ReviewDayGroup";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { previewUrl: () => "/thumb" },
}));

const day = (when: string, stationKeys: string[]): DraftDay => ({
  day: when,
  photos: 5,
  located: 5,
  stationKeys,
  flightIds: [],
  passedThrough: [],
});

/**
 * Northvale Lodge and Port Carrow are unchanged (their stored rows are what the
 * night answers give), Southbridge is new. So with unchanged rows collapsed
 * Port Carrow is hidden although a leg leads to it.
 */
function mostlyUnchanged(): TripBuilderDraft {
  const draft = existingDraft();
  const [area] = draft.areas;
  const stations = area.stations.map((s) =>
    s.key === KEY.portCarrow
      ? {
          ...s,
          status: "same" as const,
          before: { startDate: "2031-05-04", endDate: "2031-05-05", slept: true, stay: false },
        }
      : s
  );
  return { ...draft, areas: [{ ...area, stations }] };
}

function Reveal() {
  const { setShowUnchanged } = useExistingDiff();
  return <button onClick={() => setShowUnchanged(true)}>show all</button>;
}

function renderDay(when: string, stationKeys: string[], night: string | null = null) {
  const draft = mostlyUnchanged();
  const state = initialReviewState(draft);
  const [area] = state.areas;
  const rows = area.stations.flatMap((station, index) =>
    stationKeys.includes(station.key) ? [{ station, index }] : []
  );
  return render(
    <ExistingDiffProvider draft={draft} state={state} onEdit={vi.fn()}>
      <ReviewDayGroup
        draft={draft}
        state={state}
        area={area}
        day={day(when, stationKeys)}
        rows={rows}
        night={night}
        slept={sleptKeys(state)}
        onEdit={vi.fn()}
      />
      <Reveal />
    </ExistingDiffProvider>
  );
}

const legs = (): string[] =>
  screen.queryAllByText(/review\.leg\.between/).map((el) => el.textContent ?? "");

describe("ReviewDayGroup of an existing trip", () => {
  it("draws neither the station nor the leg that leads to it while unchanged rows are collapsed", () => {
    const { container } = renderDay("2031-05-04", [KEY.portCarrow]);
    expect(document.querySelectorAll("[data-station]")).toHaveLength(0);
    expect(legs()).toEqual([]);
    expect(screen.queryAllByRole("radio")).toEqual([]);
    // Only the day header is left: no empty wrapper for the hidden station to add a gap.
    expect(container.querySelector("section")?.children).toHaveLength(1);
  });

  it("keeps the leg to a station that is drawn, even from a hidden one", () => {
    renderDay("2031-05-05", [KEY.southbridge]);
    expect(document.querySelectorAll("[data-station]")).toHaveLength(1);
    expect(legs()).toEqual([
      'tripBuilder:review.leg.between {"from":"Port Carrow","to":"Southbridge"}',
    ]);
  });

  it("keeps the day header and the chip of the night, which is an editing control", () => {
    renderDay("2031-05-04", [KEY.portCarrow], "2031-05-04");
    expect(screen.getByRole("heading", { name: /04\.05\.2031/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue(KEY.portCarrow);
    expect(document.querySelectorAll("[data-station]")).toHaveLength(0);
    expect(legs()).toEqual([]);
  });

  it("brings the station and its leg back with the unchanged rows", () => {
    renderDay("2031-05-04", [KEY.portCarrow]);
    fireEvent.click(screen.getByRole("button", { name: "show all" }));
    expect(document.querySelectorAll("[data-station]")).toHaveLength(1);
    expect(legs()).toEqual([
      'tripBuilder:review.leg.between {"from":"Northvale Lodge","to":"Port Carrow"}',
    ]);
  });
});
