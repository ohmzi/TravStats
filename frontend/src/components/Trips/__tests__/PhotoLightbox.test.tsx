import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below (see ImmichConnectionCard.test.tsx).
const { setImmichCover, setPhotoCover, getSettings } = vi.hoisted(() => ({
  setImmichCover: vi.fn(),
  setPhotoCover: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { setImmichCover, setPhotoCover, getSettings },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

const { isPhone } = vi.hoisted(() => ({ isPhone: vi.fn(() => false) }));
vi.mock("../../../hooks/useIsPhoneViewport", () => ({ useIsPhoneViewport: isPhone }));

import { formatDateTime } from "../../../lib/displayFormat";
import PhotoLightbox, { type LightboxItem } from "../PhotoLightbox";

const ITEMS: LightboxItem[] = [
  { id: "p1", previewUrl: "/p1.jpg", caption: "First", source: { kind: "photo" } },
  { id: "a1", previewUrl: "/a1.jpg", caption: null, source: { kind: "immich", linkId: "link-1" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  setImmichCover.mockResolvedValue({ coverImageUrl: "/cover-immich" });
  setPhotoCover.mockResolvedValue({ coverImageUrl: "/cover-photo" });
  // No web URL unless a test says so — the "Open in Immich" link must be
  // absent by default, never built from a guessed host.
  getSettings.mockResolvedValue({ webUrl: null });
  isPhone.mockReturnValue(false);
});

const renderBox = (startIndex = 0, onCoverChanged = vi.fn()) =>
  render(
    <PhotoLightbox
      tripId="trip-1"
      items={ITEMS}
      startIndex={startIndex}
      onClose={vi.fn()}
      onCoverChanged={onCoverChanged}
    />
  );

describe("PhotoLightbox", () => {
  it("shows the item at startIndex", () => {
    renderBox(1);
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a1.jpg");
  });

  it("navigates with the next/previous buttons and wraps around", async () => {
    const user = userEvent.setup();
    renderBox(0);

    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a1.jpg");

    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/p1.jpg");

    await user.click(screen.getByRole("button", { name: "gallery.previous" }));
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a1.jpg");
  });

  it("navigates with the arrow keys and closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PhotoLightbox tripId="trip-1" items={ITEMS} startIndex={0} onClose={onClose} />);

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a1.jpg");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("sets a local photo as the cover", async () => {
    const onCoverChanged = vi.fn();
    const user = userEvent.setup();
    renderBox(0, onCoverChanged);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await waitFor(() => expect(setPhotoCover).toHaveBeenCalledWith("trip-1", "p1"));
    expect(setImmichCover).not.toHaveBeenCalled();
    expect(onCoverChanged).toHaveBeenCalledWith("/cover-photo");
  });

  it("sets a live Immich asset as the cover using its link id", async () => {
    const user = userEvent.setup();
    renderBox(1);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await waitFor(() => expect(setImmichCover).toHaveBeenCalledWith("trip-1", "link-1", "a1"));
    expect(setPhotoCover).not.toHaveBeenCalled();
  });

  it("renders nothing for an empty item list", () => {
    const { container } = render(
      <PhotoLightbox tripId="trip-1" items={[]} startIndex={0} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the button's accessible name flipping to gallery.coverSet once the request resolves", async () => {
    // This exists to catch a re-introduced static aria-label on the set-cover
    // button: if that label ever comes back, the button's accessible name
    // would freeze on "gallery.setAsCover" and this assertion would fail even
    // though `coverSet` state flipped correctly.
    const user = userEvent.setup();
    renderBox(0);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await screen.findByRole("button", { name: "gallery.coverSet" });
  });

  it("does not confirm the cover on the photo the user navigated to while the request was in flight", async () => {
    const user = userEvent.setup();
    let resolveCover: (value: { coverImageUrl: string }) => void = () => {};
    setPhotoCover.mockReturnValue(
      new Promise((resolve) => {
        resolveCover = resolve;
      })
    );

    renderBox(0);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));
    // Still pending — navigate to the next item before the request resolves.
    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a1.jpg");

    resolveCover({ coverImageUrl: "/cover-photo" });

    // Give the resolved promise's microtask a tick to flush into state.
    await waitFor(() => expect(setPhotoCover).toHaveBeenCalledWith("trip-1", "p1"));
    // The confirmation belongs to item 0 (p1), never to the item now on
    // screen (a1) — the button here must still read "set as cover".
    expect(screen.getByRole("button", { name: "gallery.setAsCover" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gallery.coverSet" })).not.toBeInTheDocument();
  });
});

/* ── Details panel + "Open in Immich" (2026-10-13) ────────────────────────
   The owner asked for Immich's info panel inside the viewer: a small Details
   toggle that slides the photo aside and shows the asset's metadata, plus an
   action that opens the picture in Immich, inside its album. */

const DETAILED_ITEM: LightboxItem = {
  id: "a1",
  previewUrl: "/a1.jpg",
  caption: null,
  source: { kind: "immich", linkId: "link-1" },
  details: {
    albumName: "Rome",
    albumId: "album-9",
    filename: "IMG_0412.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2_048_000,
    takenAt: "2031-05-03T10:07:09.000Z",
    lat: 41.9,
    lon: 12.5,
    city: "Northvale",
    state: "Westshire",
    country: "New Zealand",
    make: "Kestrel",
    model: "K1 Pro",
    lensModel: "Kestrel 24-70mm",
    focalLength: 35,
    fNumber: 2.8,
    exposureTime: "1/250",
    iso: 200,
    width: 4032,
    height: 3024,
  },
};

const renderDetailed = (items: LightboxItem[] = [DETAILED_ITEM]) =>
  render(<PhotoLightbox tripId="trip-1" items={items} startIndex={0} onClose={vi.fn()} />);

const openDetails = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.click(screen.getByRole("button", { name: "gallery.details" }));
};

describe("PhotoLightbox — details panel", () => {
  it("opens and closes the details with the toggle, leaving the photo in place", async () => {
    const user = userEvent.setup();
    renderDetailed();

    expect(screen.queryByTestId("lightbox-details")).not.toBeInTheDocument();
    expect(screen.getByTestId("lightbox-stage")).toHaveAttribute("data-details-open", "false");

    await openDetails(user);

    expect(screen.getByTestId("lightbox-details")).toBeInTheDocument();
    // The photo's shifted state, as far as jsdom can pin it: the stage carries
    // the open flag the slide class hangs off. jsdom computes no layout, so
    // the actual movement/animation is not asserted here.
    expect(screen.getByTestId("lightbox-stage")).toHaveAttribute("data-details-open", "true");
    expect(screen.getByTestId("lightbox-image")).toBeInTheDocument();

    await openDetails(user);

    expect(screen.queryByTestId("lightbox-details")).not.toBeInTheDocument();
    expect(screen.getByTestId("lightbox-stage")).toHaveAttribute("data-details-open", "false");
    expect(screen.getByTestId("lightbox-image")).toBeInTheDocument();
  });

  it("keeps the photo within the viewport and the controls reachable", async () => {
    const user = userEvent.setup();
    renderDetailed();
    await openDetails(user);

    // A percentage cap resolves against nothing here, so the viewer once let
    // the image grow past the fold and paint over the footer — Details, Close
    // and Set cover became unclickable. These pins hold the viewport cap
    // (jsdom computes no layout, so the classes are the contract).
    const image = screen.getByTestId("lightbox-image");
    expect(image.className).toContain("max-h-[85vh]");
    expect(image.parentElement?.className).toContain("max-h-[85vh]");
    // The stage nudges aside at every non-phone width, not only from md up.
    // The pin names the class TOKEN, not a substring: the old `md:-translate-x-8`
    // contains "-translate-x-8" and would slip past a naive toContain.
    expect(screen.getByTestId("lightbox-stage").className.split(/\s+/)).toContain("-translate-x-8");
  });

  it("renders the asset's facts from the served DTO", async () => {
    const user = userEvent.setup();
    renderDetailed();
    await openDetails(user);

    const panel = screen.getByTestId("photo-details");
    const text = panel.textContent ?? "";
    expect(text).toContain("IMG_0412.jpg");
    expect(text).toContain("Rome");
    expect(text).toContain("Kestrel K1 Pro");
    expect(text).toContain("Kestrel 24-70mm");
    expect(text).toContain("35 mm");
    expect(text).toContain("f/2.8");
    expect(text).toContain("1/250");
    expect(text).toContain("200");
    expect(text).toContain("4032 × 3024");
    expect(text).toContain("2.0 MB");
    expect(text).toContain("Northvale, Westshire, New Zealand");
    expect(text).toContain("41.9000, 12.5000");
    // Formatted through the app's own display formatter (user's date format +
    // profile zone), so the expected string is read from the same source.
    expect(text).toContain(formatDateTime("2031-05-03T10:07:09.000Z"));
  });

  it("shows no Taken row for the epoch marker Immich's absence of a date becomes", async () => {
    const undated: LightboxItem = {
      ...DETAILED_ITEM,
      details: { ...DETAILED_ITEM.details, takenAt: "1970-01-01T00:00:00.000Z" },
    };
    const user = userEvent.setup();
    renderDetailed([undated]);
    await openDetails(user);

    expect(screen.getByTestId("photo-details").textContent).not.toContain("1970");
  });

  it("says so when the panel has nothing to show, instead of empty rows", async () => {
    const bare: LightboxItem = { id: "p1", previewUrl: "/p1.jpg", source: { kind: "photo" } };
    const user = userEvent.setup();
    renderDetailed([bare]);
    await openDetails(user);

    expect(screen.getByText("gallery.noDetails")).toBeInTheDocument();
  });

  it("stacks the details as a sheet on a phone instead of a side column", async () => {
    isPhone.mockReturnValue(true);
    const user = userEvent.setup();
    renderDetailed();
    await openDetails(user);

    const sheet = screen.getByTestId("lightbox-details");
    expect(sheet).toHaveAttribute("data-variant", "sheet");
    // The surfaces take the app's tokens, not the raw palette.
    expect(sheet.className).toContain("bg-[var(--ts-surface2)]");
    expect(sheet.className).toContain("border-[var(--ts-border)]");
  });

  it("uses the side column on a roomy viewport", async () => {
    const user = userEvent.setup();
    renderDetailed();
    await openDetails(user);

    const column = screen.getByTestId("lightbox-details");
    expect(column).toHaveAttribute("data-variant", "column");
    expect(column.className).toContain("bg-[var(--ts-surface2)]");
    expect(column.className).toContain("border-[var(--ts-border)]");
  });
});

describe("PhotoLightbox — open in Immich", () => {
  it("links to the asset inside its album when the owner configured a web URL", async () => {
    getSettings.mockResolvedValue({ webUrl: "https://immich.example.com/" });
    renderDetailed();

    const link = await screen.findByRole("link", { name: "gallery.openInImmich" });
    expect(link).toHaveAttribute("href", "https://immich.example.com/albums/album-9/photos/a1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders no link at all when no web URL is configured", async () => {
    renderDetailed();

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "gallery.openInImmich" })).not.toBeInTheDocument();
  });

  it("refuses a web URL that is not http(s) — a stored javascript: URL never reaches a link", async () => {
    getSettings.mockResolvedValue({ webUrl: "javascript:alert(1)" });
    renderDetailed();

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "gallery.openInImmich" })).not.toBeInTheDocument();
  });

  it("stays silent when the settings cannot be read", async () => {
    getSettings.mockRejectedValue(new Error("offline"));
    renderDetailed();

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "gallery.openInImmich" })).not.toBeInTheDocument();
    // The viewer itself is unaffected.
    expect(screen.getByTestId("lightbox-image")).toBeInTheDocument();
  });

  it("does not ask for the settings for a photo that is not a live album asset", async () => {
    const uploaded: LightboxItem = {
      id: "p1",
      previewUrl: "/p1.jpg",
      source: { kind: "photo" },
      details: { takenAt: "2031-05-03T10:07:09.000Z", sizeBytes: 1024 },
    };
    renderDetailed([uploaded]);

    expect(screen.queryByRole("link", { name: "gallery.openInImmich" })).not.toBeInTheDocument();
    expect(getSettings).not.toHaveBeenCalled();
  });
});
