import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import RoadtripGallery from "../RoadtripGallery";
import type { LinkedAlbum } from "../../../types/immich";
import type { RoadtripDetail } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

// The real section fetches the album's assets on mount; its own suite owns
// that, and this one owns WHICH album reaches it (the network guard would
// refuse the request anyway, forgejo#110). The mock prints the id the section
// was handed as well, so the test pins that it is the JOURNEY's — the link row
// hangs off the trip.
vi.mock("../../Trips/ImmichAlbumSection", () => ({
  default: ({ tripId, album }: { tripId: string; album: LinkedAlbum }) => (
    <div data-testid="immich-album-section">
      {tripId}|{album.albumName}
    </div>
  ),
}));

/** Synthetic names only (public repository) — the pairs `albumForRoadtrip` reads. */
const TRIP = "Eastport loop";
const CITY = "Southbridge";
const ROADTRIP = `${TRIP} · ${CITY}`;

function album(albumName: string): LinkedAlbum {
  return {
    id: `l-${albumName}`,
    immichAlbumId: `a-${albumName}`,
    albumName,
    assetCount: 12,
    thumbnailAssetId: null,
    mode: "link",
    sortIdx: 0,
    lastSyncedAt: null,
  };
}

function detail(roadtripName: string, trip: RoadtripDetail["trip"]): RoadtripDetail {
  return {
    roadtrip: { id: "rt1", name: roadtripName } as never,
    countries: [],
    summary: null,
    summarySource: null,
    summaryGeneratedAt: null,
    trip,
    startDate: null,
    endDate: null,
    nights: { stayNights: 0, freeNights: 0, nights: 0, nightsKnown: true, placesSlept: 0 },
    stations: [],
    legs: [],
    tours: [],
    routingAvailable: true,
    expenses: [],
    costs: { total: {}, byStation: [], byLeg: [], unpinned: {} },
  };
}

describe("RoadtripGallery", () => {
  it("shows ONLY the trip's own album — the journey's other albums stay on the journey", () => {
    render(
      <RoadtripGallery
        detail={detail(ROADTRIP, {
          id: "t1",
          name: TRIP,
          immichAlbums: [
            album(TRIP), // the journey's own album, first linked
            album(`${CITY} 2031 Road Trip (${TRIP})`), // the pitstop's — THIS trip's
            album("Kelmore 2031 Road Trip"), // another stay's
          ],
        })}
        onChanged={vi.fn()}
      />
    );

    const sections = screen.getAllByTestId("immich-album-section");
    expect(sections.map((el) => el.textContent)).toEqual([`t1|${CITY} 2031 Road Trip (${TRIP})`]);
  });

  it("keeps the documented fallback: a trip with no own album shows the journey's first", () => {
    render(
      <RoadtripGallery
        detail={detail("Return leg", {
          id: "t1",
          name: TRIP,
          immichAlbums: [album(TRIP), album("Kelmore 2031 Road Trip")],
        })}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getAllByTestId("immich-album-section").map((el) => el.textContent)).toEqual([
      `t1|${TRIP}`,
    ]);
  });

  it("says the trip belongs to no journey rather than drawing a grid", () => {
    render(<RoadtripGallery detail={detail(ROADTRIP, null)} onChanged={vi.fn()} />);

    expect(screen.getByText("roadtrips:detail.gallery.detached")).toBeInTheDocument();
    expect(screen.queryByTestId("immich-album-section")).not.toBeInTheDocument();
  });

  it("says no album is linked when the journey links none", () => {
    render(
      <RoadtripGallery
        detail={detail(ROADTRIP, { id: "t1", name: TRIP, immichAlbums: [] })}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText("roadtrips:detail.gallery.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("immich-album-section")).not.toBeInTheDocument();
  });
});
