import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  STOPOVER,
  STOPOVER_FLIGHTS,
  stopoverDraft,
} from "../../../../lib/tripBuilder/__tests__/reviewFixtures";
import type { DraftStopover } from "../../../../types/tripBuilder";
import ReviewStopovers from "../ReviewStopovers";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const OFF = { [STOPOVER.key]: { roadtrip: false, album: false } };
const ALBUM_NAME = `tripBuilder:review.stopovers.album {"title":"Sundhavn 2031 Road Trip"}`;
const ROADTRIP_NAME = "tripBuilder:review.stopovers.roadtrip";

function renderCard(over: {
  stopovers?: DraftStopover[];
  ticks?: Record<string, { roadtrip: boolean; album: boolean }>;
  roadtripsHidden?: boolean;
}) {
  const onTick = vi.fn();
  const view = render(
    <ReviewStopovers
      stopovers={over.stopovers ?? stopoverDraft().stopovers ?? []}
      flights={STOPOVER_FLIGHTS}
      ticks={over.ticks ?? OFF}
      roadtripsHidden={over.roadtripsHidden ?? false}
      onTick={onTick}
    />
  );
  return { onTick, view };
}

describe("ReviewStopovers", () => {
  it("draws nothing when the scan offered no stopover", () => {
    const { view } = renderCard({ stopovers: [] });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the city, the hours at the airport, the counts and the tour in order", () => {
    renderCard({});
    const box = document.querySelector(`[data-stopover="${STOPOVER.key}"]`) as HTMLElement;
    expect(box).toBeInTheDocument();
    expect(
      screen.getByText(
        'tripBuilder:review.stopovers.heading {"city":"Sundhavn","day":"04.05.2031","hours":7,"airport":"ZSD"}'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'tripBuilder:review.stopovers.photos {"count":24} · tripBuilder:review.stopovers.outing {"count":19}'
      )
    ).toBeInTheDocument();
    const stops = ["Sundhavn Airport", "Sundhavn Old Town", "Sundhavn Harbour"].map((title) =>
      screen.getByText(title)
    );
    expect(stops.map((node) => node.textContent)).toEqual([
      "Sundhavn Airport",
      "Sundhavn Old Town",
      "Sundhavn Harbour",
    ]);
    expect(screen.getAllByText("→")).toHaveLength(2);
    expect(screen.getByText("tripBuilder:review.stopovers.albumNote")).toBeInTheDocument();
  });

  it("keeps the album switch gated on the roadtrip one", () => {
    const { onTick } = renderCard({});
    const roadtrip = screen.getByRole("switch", { name: ROADTRIP_NAME });
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(roadtrip).not.toBeChecked();
    expect(album).not.toBeChecked();
    expect(album).toBeDisabled();
    fireEvent.click(roadtrip);
    expect(onTick).toHaveBeenLastCalledWith(STOPOVER.key, { roadtrip: true, album: false });
  });

  it("turns the album on once the roadtrip switch is on", () => {
    const { onTick } = renderCard({
      ticks: { [STOPOVER.key]: { roadtrip: true, album: false } },
    });
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeEnabled();
    fireEvent.click(album);
    expect(onTick).toHaveBeenLastCalledWith(STOPOVER.key, { roadtrip: true, album: true });
  });

  it("turns the album off with the roadtrip switch", () => {
    const { onTick } = renderCard({
      ticks: { [STOPOVER.key]: { roadtrip: true, album: true } },
    });
    fireEvent.click(screen.getByRole("switch", { name: ROADTRIP_NAME }));
    expect(onTick).toHaveBeenLastCalledWith(STOPOVER.key, { roadtrip: false, album: false });
  });

  it("refuses switch 1 while roadtrips are off, and says why", () => {
    renderCard({ roadtripsHidden: true });
    const roadtrip = screen.getByRole("switch", { name: ROADTRIP_NAME });
    expect(roadtrip).toBeDisabled();
    expect(screen.getByText("tripBuilder:warnings.roadtripsHidden")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: ALBUM_NAME })).toBeDisabled();
  });

  it("shows an already-synced stopover with both switches on and locked", () => {
    renderCard({
      stopovers: [{ ...STOPOVER, roadtripId: "r-9", storedPhotoCount: 22 }],
      ticks: { [STOPOVER.key]: { roadtrip: true, album: true } },
    });
    const roadtrip = screen.getByRole("switch", { name: ROADTRIP_NAME });
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(roadtrip).toBeChecked();
    expect(roadtrip).toBeDisabled();
    expect(album).toBeChecked();
    expect(album).toBeDisabled();
    expect(screen.getByText("tripBuilder:review.stopovers.synced")).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.stopovers.syncedCounts {"stored":22,"count":24}')
    ).toBeInTheDocument();
  });

  it("locks the wire's `stored` match on too, and shows its stored count", () => {
    renderCard({
      stopovers: [
        {
          ...STOPOVER,
          stored: { roadtripId: "r-9", name: STOPOVER.title, albumAssetCount: 22 },
        },
      ],
      ticks: OFF,
    });
    const roadtrip = screen.getByRole("switch", { name: ROADTRIP_NAME });
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(roadtrip).toBeChecked();
    expect(roadtrip).toBeDisabled();
    expect(album).toBeChecked();
    expect(album).toBeDisabled();
    expect(screen.getByText("tripBuilder:review.stopovers.synced")).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.stopovers.syncedCounts {"stored":22,"count":24}')
    ).toBeInTheDocument();
  });

  it("says the times are unknown when the two flights are not in the draft", () => {
    renderCard({});
    expect(
      screen.queryByText(
        'tripBuilder:review.stopovers.headingNoClock {"city":"Sundhavn","day":"04.05.2031"}'
      )
    ).toBeNull();
    const view = render(
      <ReviewStopovers
        stopovers={[STOPOVER]}
        flights={[]}
        ticks={OFF}
        roadtripsHidden={false}
        onTick={vi.fn()}
      />
    );
    expect(
      view.getByText(
        'tripBuilder:review.stopovers.headingNoClock {"city":"Sundhavn","day":"04.05.2031"}'
      )
    ).toBeInTheDocument();
  });
});
