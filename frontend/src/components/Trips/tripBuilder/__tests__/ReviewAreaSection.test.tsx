import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import {
  applyEdit,
  initialReviewState,
  type DraftEdit,
} from "../../../../lib/tripBuilder/draftEdits";
import { sleptKeys } from "../../../../lib/tripBuilder/planRules";
import { placeNights } from "../../../../lib/tripBuilder/reviewView";
import {
  MATCHED_PITSTOP_ALBUM,
  matchedPitstopDraft,
  matchedStopDraft,
  stopsMatchedPitstopDraft,
  STOP_KEY,
} from "../../../../lib/tripBuilder/__tests__/existingFixture";
import {
  PITSTOP_ALBUM,
  PITSTOP_KEY,
  pitstopDraft,
  reviewDraft,
  syncedPitstopDraft,
} from "../../../../lib/tripBuilder/__tests__/reviewFixtures";
import type { TripBuilderDraft } from "../../../../types/tripBuilder";
import ReviewAreaSection from "../ReviewAreaSection";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { previewUrl: (id: string, index: number) => `/thumb/${id}/${index}` },
}));

const draft = reviewDraft();

function renderArea(
  areaIndex: number,
  edits: DraftEdit[] = [],
  props: { roadtripsHidden?: boolean } = {}
) {
  const state = edits.reduce((s, e) => applyEdit(draft, s, e), initialReviewState(draft));
  const area = state.areas[areaIndex];
  const onEdit = vi.fn();
  render(
    <ReviewAreaSection
      draft={draft}
      state={state}
      area={area}
      ordinal={areaIndex + 1}
      nights={placeNights(draft, state).byArea.get(area.key) ?? []}
      slept={sleptKeys(state)}
      roadtripsHidden={props.roadtripsHidden ?? false}
      onEdit={onEdit}
    />
  );
  return onEdit;
}

describe("ReviewAreaSection", () => {
  it("titles the area, dates it and counts its stations and nights", () => {
    renderArea(0);
    expect(
      screen.getByRole("heading", { name: 'tripBuilder:review.area.title {"n":1}' })
    ).toBeInTheDocument();
    expect(screen.getAllByText("02.05.2031 – 03.05.2031")[0]).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.area.summary {"stations":4,"nights":2}')
    ).toBeInTheDocument();
  });

  it("draws a group for each day of the area", () => {
    renderArea(0);
    expect(
      Array.from(document.querySelectorAll("[data-day]")).map((d) => d.getAttribute("data-day"))
    ).toEqual(["2031-05-02", "2031-05-03"]);
  });

  it("draws the night before the first day above it", () => {
    renderArea(1);
    expect(screen.getByText(/review\.night\.flight/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(2);
  });

  it("names what the area ends in and what it was called", () => {
    renderArea(0);
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("tripBuilder:review.area.name")).toHaveValue(
      "Southern loop · Northvale"
    );
  });

  it("says what the area after a flight follows", () => {
    renderArea(1);
    expect(
      screen.getByText('tripBuilder:review.area.afterFlight {"flight":"ZZ101 ZNV→ZSB"}')
    ).toBeInTheDocument();
  });

  it("changes what the area becomes", () => {
    const onEdit = renderArea(0);
    fireEvent.click(screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.skip" }));
    expect(onEdit).toHaveBeenCalledWith({
      type: "setAreaKind",
      areaKey: "2031-05-02#1",
      as: "skip",
    });
  });

  it("will not offer a roadtrip when roadtrips are off, unless the area already is one", () => {
    renderArea(0, [{ type: "setAreaKind", areaKey: "2031-05-02#1", as: "stops" }], {
      roadtripsHidden: true,
    });
    expect(
      screen.queryByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toBeNull();
  });

  it("renames the roadtrip and changes its vehicle", () => {
    const onEdit = renderArea(0);
    fireEvent.change(screen.getByLabelText("tripBuilder:review.area.name"), {
      target: { value: "The long way" },
    });
    expect(onEdit).toHaveBeenCalledWith({
      type: "setAreaName",
      areaKey: "2031-05-02#1",
      name: "The long way",
    });
    fireEvent.change(screen.getByLabelText("tripBuilder:review.area.vehicle"), {
      target: { value: "motorhome" },
    });
    expect(onEdit).toHaveBeenCalledWith({
      type: "setVehicle",
      areaKey: "2031-05-02#1",
      vehicle: "motorhome",
    });
  });

  it("has no name or vehicle for an area that is only stops", () => {
    renderArea(0, [{ type: "setAreaKind", areaKey: "2031-05-02#1", as: "stops" }]);
    expect(screen.queryByLabelText("tripBuilder:review.area.name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("tripBuilder:review.area.vehicle")).not.toBeInTheDocument();
  });

  it("offers the home switch the scan offered, on, and turns it off", () => {
    const onEdit = renderArea(0);
    const home = screen.getByRole("switch", { name: "tripBuilder:review.area.homeStart" });
    expect(home).toBeChecked();
    fireEvent.click(home);
    expect(onEdit).toHaveBeenCalledWith({
      type: "toggleHome",
      areaKey: "2031-05-02#1",
      end: "start",
      on: false,
    });
    expect(screen.queryByRole("switch", { name: "tripBuilder:review.area.homeEnd" })).toBeNull();
  });

  it("offers no home switch for an area with none offered", () => {
    renderArea(1);
    expect(screen.queryByRole("switch", { name: /review\.area\.home/ })).toBeNull();
  });

  it("draws a skipped area as one line and no days", () => {
    renderArea(1, [{ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" }]);
    expect(screen.getByText("tripBuilder:review.area.skipped")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(0);
  });
});

describe("a route-scoped area with a stop left out", () => {
  /**
   * The owner's shape (2026-10-12): the trip-scoped window also picked up
   * photos of a stop that stands on ANOTHER trip of the journey. The scan
   * leaves it out of the route; the review must show the skip and its reason.
   */
  function renderLeftOut(): void {
    const base = reviewDraft();
    const scoped: TripBuilderDraft = {
      ...base,
      target: {
        kind: "existing",
        tripId: "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e",
        tripName: "Southern loop",
        routeId: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
        routeName: "Southern loop",
      },
      areas: base.areas.map((area, i) =>
        i === 1
          ? {
              ...area,
              leftOut: [
                {
                  key: "left-out-sb",
                  title: "Halwan",
                  firstDay: "2031-05-05",
                  lastDay: "2031-05-06",
                  routeId: "9c8b7a65-4321-4fed-8cba-0987654321ab",
                  routeName: "Selby Bay stay",
                },
              ],
              leftOutPhotos: [
                {
                  routeId: "9c8b7a65-4321-4fed-8cba-0987654321ab",
                  routeName: "Selby Bay stay",
                  firstDay: "2031-05-05",
                  lastDay: "2031-05-05",
                  count: 3,
                },
              ],
            }
          : area
      ),
    };
    const state = initialReviewState(scoped);
    const area = state.areas[1];
    render(
      <ReviewAreaSection
        draft={scoped}
        state={state}
        area={area}
        ordinal={2}
        nights={placeNights(scoped, state).byArea.get(area.key) ?? []}
        slept={sleptKeys(state)}
        roadtripsHidden={false}
        onEdit={vi.fn()}
      />
    );
  }

  it("shows the left-out stop with its dates and the trip it belongs to", () => {
    renderLeftOut();
    const section = screen
      .getByRole("heading", { name: "tripBuilder:review.area.leftOut.title" })
      .closest("section") as HTMLElement;
    expect(within(section).getByText("tripBuilder:review.area.leftOut.pill")).toBeInTheDocument();
    expect(within(section).getByText("Halwan")).toBeInTheDocument();
    expect(within(section).getByText("05.05.2031 – 06.05.2031")).toBeInTheDocument();
    expect(
      within(section).getByText(
        'tripBuilder:review.area.leftOut.otherTrip {"trip":"Selby Bay stay"}'
      )
    ).toBeInTheDocument();
  });

  it("shows the photos left out with the trip they stand on and how many", () => {
    // The stop skip's second arm, one level down (owner request 2026-10-12):
    // the photos themselves stood on another trip, so no stop was ever derived
    // from them — the review says so, the way it shows a left-out stop.
    renderLeftOut();
    const section = screen
      .getByRole("heading", { name: "tripBuilder:review.area.leftOut.photosTitle" })
      .closest("section") as HTMLElement;
    expect(within(section).getByText("tripBuilder:review.area.leftOut.pill")).toBeInTheDocument();
    expect(within(section).getByText("05.05.2031")).toBeInTheDocument();
    expect(
      within(section).getByText(
        'tripBuilder:review.area.leftOut.otherTripPhotos {"count":3,"trip":"Selby Bay stay"}'
      )
    ).toBeInTheDocument();
  });

  it("shows no left-out list on an area nothing was left out of", () => {
    renderArea(0);
    expect(
      screen.queryByRole("heading", { name: "tripBuilder:review.area.leftOut.title" })
    ).toBeNull();
  });
});

describe("a stops area matched to a stored stop", () => {
  const draft = matchedStopDraft();

  function renderMatched(): void {
    const state = initialReviewState(draft);
    const area = state.areas[0];
    render(
      <ReviewAreaSection
        draft={draft}
        state={state}
        area={area}
        ordinal={1}
        nights={placeNights(draft, state).byArea.get(area.key) ?? []}
        slept={sleptKeys(state)}
        roadtripsHidden={false}
        onEdit={vi.fn()}
      />
    );
  }

  /** The row's header is its first button, open or closed. */
  const toggleRow = (key: string): void => {
    const row = document.querySelector(`[data-station="${key}"]`) as HTMLElement;
    fireEvent.click(within(row).getAllByRole("button")[0]);
  };
  const removeButton = (): HTMLElement =>
    screen.getByRole("button", { name: "tripBuilder:review.station.delete" });

  it("offers stops and skip, but not roadtrip: a matched stop cannot become one", () => {
    renderMatched();
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.stops" })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.skip" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toBeNull();
  });

  it("greys Remove on the anchor, which is the stored stop, and not on another run", () => {
    renderMatched();
    toggleRow(STOP_KEY.harbour);
    expect(removeButton()).toBeDisabled();
    toggleRow(STOP_KEY.harbour);
    toggleRow(STOP_KEY.market);
    expect(removeButton()).toBeEnabled();
  });
});

describe("a pitstop area", () => {
  const ALBUM_NAME = `tripBuilder:review.area.album {"name":"${PITSTOP_ALBUM}"}`;

  function renderPitstop(
    draft: TripBuilderDraft = pitstopDraft(),
    edits: DraftEdit[] = [],
    props: { roadtripsHidden?: boolean } = {}
  ) {
    const state = edits.reduce((s, e) => applyEdit(draft, s, e), initialReviewState(draft));
    const area = state.areas[1];
    const onEdit = vi.fn();
    render(
      <ReviewAreaSection
        draft={draft}
        state={state}
        area={area}
        ordinal={2}
        nights={placeNights(draft, state).byArea.get(area.key) ?? []}
        slept={sleptKeys(state)}
        roadtripsHidden={props.roadtripsHidden ?? false}
        onEdit={onEdit}
      />
    );
    return onEdit;
  }

  it("starts a pitstop as a roadtrip with its own album on, one untick away", () => {
    const onEdit = renderPitstop();
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toHaveAttribute("aria-checked", "true");
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeEnabled();
    fireEvent.click(album);
    expect(onEdit).toHaveBeenCalledWith({
      type: "setAreaAlbum",
      areaKey: PITSTOP_KEY,
      album: false,
    });
  });

  it("has no album switch on an area the scan did not mark a pitstop", () => {
    renderPitstop(reviewDraft());
    expect(screen.queryByRole("switch", { name: /review\.area\.album/ })).toBeNull();
  });

  it("disables the album switch, unchecked, when the kind is not a roadtrip", () => {
    renderPitstop(pitstopDraft(), [{ type: "setAreaKind", areaKey: PITSTOP_KEY, as: "stops" }]);
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).not.toBeChecked();
    expect(album).toBeDisabled();
  });

  it("keeps the album tick when the kind leaves the roadtrip and comes back", () => {
    renderPitstop(pitstopDraft(), [
      { type: "setAreaKind", areaKey: PITSTOP_KEY, as: "stops" },
      { type: "setAreaKind", areaKey: PITSTOP_KEY, as: "roadtrip" },
    ]);
    expect(screen.getByRole("switch", { name: ALBUM_NAME })).toBeChecked();
  });

  it("refuses the album switch while roadtrips are off, and says why", () => {
    renderPitstop(pitstopDraft(), [], { roadtripsHidden: true });
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeDisabled();
    expect(screen.getByText("tripBuilder:warnings.roadtripsHidden")).toBeInTheDocument();
  });

  it("keeps a matched pitstop whose album is missing as an editable offer", () => {
    // The live case (spec §5): the roadtrip exists from before this feature,
    // the album does not. Only the wire's album annotation locks the switch —
    // a matched roadtrip without it stays ON and one untick away.
    const draft = syncedPitstopDraft();
    const missing: TripBuilderDraft = {
      ...draft,
      areas: draft.areas.map((area) =>
        area.key === PITSTOP_KEY ? { ...area, pitstop: { albumName: PITSTOP_ALBUM } } : area
      ),
    };
    renderPitstop(missing);
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeEnabled();
  });

  it("shows an already-synced pitstop with the album on and locked, and its counts", () => {
    renderPitstop(syncedPitstopDraft());
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeDisabled();
    expect(screen.getByText("tripBuilder:review.area.synced")).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.area.syncedCounts {"count":18,"now":20}')
    ).toBeInTheDocument();
  });

  it("keeps a synced pitstop as status while roadtrips are hidden: locked, no reason offered", () => {
    // The stopover card's finding S3-1, mirrored: the commit for a matched
    // pitstop writes no roadtrip, so the hidden-roadtrips sentence belongs to a
    // switch the user could still turn on, not to a row already synced.
    renderPitstop(syncedPitstopDraft(), [], { roadtripsHidden: true });
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeDisabled();
    expect(screen.queryByText("tripBuilder:warnings.roadtripsHidden")).toBeNull();
  });
});

describe("a pitstop area matched to a stored stop", () => {
  const AREA_KEY = "2031-05-04#1";
  const ALBUM_NAME = `tripBuilder:review.area.album {"name":"${MATCHED_PITSTOP_ALBUM}"}`;

  function renderMatchedPitstop(draft: TripBuilderDraft, edits: DraftEdit[] = []): void {
    const state = edits.reduce((s, e) => applyEdit(draft, s, e), initialReviewState(draft));
    const area = state.areas[0];
    render(
      <ReviewAreaSection
        draft={draft}
        state={state}
        area={area}
        ordinal={1}
        nights={placeNights(draft, state).byArea.get(area.key) ?? []}
        slept={sleptKeys(state)}
        roadtripsHidden={false}
        onEdit={vi.fn()}
      />
    );
  }

  it("keeps Roadtrip offered with its album switch on: the stop it supersedes is the conversion", () => {
    // Final review, finding Q2: the scan matches the stored stop the stay was
    // first committed as onto the area's anchor, and the scan's pitstop default
    // opens the area as the roadtrip. The matched stop must not hide the kind
    // (the card used to drop it) — committing the roadtrip removes the stop.
    renderMatchedPitstop(matchedPitstopDraft());
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toHaveAttribute("aria-checked", "true");
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeEnabled();
  });

  it("keeps Roadtrip selectable when the pitstop was offered as stops: the flip reaches its album switch", () => {
    // The pre-default shape (and the flip back from the stop the user chose to
    // keep): the option must be there and the reducer must accept it.
    const draft = stopsMatchedPitstopDraft();
    renderMatchedPitstop(draft, [{ type: "setAreaKind", areaKey: AREA_KEY, as: "roadtrip" }]);
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toHaveAttribute("aria-checked", "true");
    const album = screen.getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeEnabled();
  });
});
