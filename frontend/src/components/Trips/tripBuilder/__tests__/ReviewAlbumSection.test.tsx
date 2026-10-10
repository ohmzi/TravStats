import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DraftAlbum } from "../../../../types/tripBuilder";
import ReviewAlbumSection from "../ReviewAlbumSection";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const ALBUM: DraftAlbum = {
  name: "Southern loop",
  existing: null,
  assetCount: 72,
  images: 68,
  videos: 4,
  allowed: true,
  missingScopes: [],
};

function renderAlbum(album: DraftAlbum = ALBUM, value = { create: true, name: "Southern loop" }) {
  const onChange = vi.fn();
  render(<ReviewAlbumSection album={album} value={value} onChange={onChange} />);
  return onChange;
}

describe("ReviewAlbumSection", () => {
  it("counts the photos and videos that would go in", () => {
    renderAlbum();
    expect(
      screen.getByText('tripBuilder:review.album.counts {"count":72,"images":68,"videos":4}')
    ).toBeInTheDocument();
  });

  it("shows the album's name while it is to be made, and renames it", () => {
    const onChange = renderAlbum();
    const name = screen.getByLabelText("tripBuilder:review.album.name");
    expect(name).toHaveValue("Southern loop");
    fireEvent.change(name, { target: { value: "Trip photos" } });
    expect(onChange).toHaveBeenCalledWith(true, "Trip photos");
  });

  it("switches the album off, keeping the name", () => {
    const onChange = renderAlbum();
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false, "Southern loop");
  });

  it("hides the name while no album is made", () => {
    renderAlbum(ALBUM, { create: false, name: "Southern loop" });
    expect(screen.queryByLabelText("tripBuilder:review.album.name")).not.toBeInTheDocument();
  });

  it("says it adds to the album the user already has, and how many photos are in it", () => {
    renderAlbum({ ...ALBUM, existing: { immichAlbumId: "a1", assetCount: 40 } });
    expect(
      screen.getByText('tripBuilder:review.album.existing {"name":"Southern loop","count":40}')
    ).toBeInTheDocument();
  });

  it("warns when that album is already linked to another trip", () => {
    renderAlbum({
      ...ALBUM,
      existing: { immichAlbumId: "a1", assetCount: 40, linkedTripName: "Kelmore weekend" },
    });
    expect(
      screen.getByText('tripBuilder:review.album.linkedElsewhere {"trip":"Kelmore weekend"}')
    ).toBeInTheDocument();
  });

  it("is off, and says why, when the key may not make albums", () => {
    renderAlbum(
      { ...ALBUM, allowed: false, blockedReason: "missingScopes", missingScopes: ["album.create"] },
      { create: false, name: "Southern loop" }
    );
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(
      screen.getByText('tripBuilder:review.album.blocked.missingScopes {"scopes":"album.create"}')
    ).toBeInTheDocument();
  });

  it("names the shared connection as the reason when that is it", () => {
    renderAlbum(
      { ...ALBUM, allowed: false, blockedReason: "sharedConnection" },
      { create: false, name: "" }
    );
    expect(screen.getByText(/review\.album\.blocked\.sharedConnection/)).toBeInTheDocument();
  });

  it("allows the album but says the permissions could not be checked", () => {
    renderAlbum({ ...ALBUM, blockedReason: "unverified" });
    expect(screen.getByRole("switch")).toBeEnabled();
    expect(screen.getByText(/review\.album\.blocked\.unverified/)).toBeInTheDocument();
  });

  it("says no album is made when there are no photos", () => {
    renderAlbum({ ...ALBUM, assetCount: 0, images: 0, videos: 0 });
    expect(screen.getByText("tripBuilder:review.album.empty")).toBeInTheDocument();
  });
});
