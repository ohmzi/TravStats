import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CapabilitiesDto } from "../../../../types/tripBuilder";
import TripImmichOptions from "../TripImmichOptions";
import { useImmichBuild } from "../useImmichBuild";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { capabilities: mocks.capabilities },
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The popup's two switches (spec 2026-10-09 §G). Visible and off; the
 * capability check is asked on the first flip only, and every refusal says
 * why. Synthetic data only: no real library, key or host.
 */
const READY: CapabilitiesDto = {
  immich: {
    configured: true,
    source: "user",
    inspect: { ok: true, missingScopes: [] },
    album: { canCreate: true, reason: null },
  },
  roadtrips: true,
  routing: { available: true, canProbe: true },
  home: { known: true, confirmed: true },
};

function caps(
  immich: Partial<CapabilitiesDto["immich"]>,
  rest: Partial<CapabilitiesDto> = {}
): CapabilitiesDto {
  return { ...READY, ...rest, immich: { ...READY.immich, ...immich } };
}

function Harness({
  initialInspect = false,
  startDay = "2031-05-02",
  endDay = "2031-05-09",
}: {
  initialInspect?: boolean;
  startDay?: string;
  endDay?: string;
}): JSX.Element {
  const build = useImmichBuild(initialInspect, startDay, endDay);
  return <TripImmichOptions build={build} />;
}

const inspect = (): HTMLElement =>
  screen.getByRole("switch", { name: "tripBuilder:popup.inspect.label" });
const album = (): HTMLElement =>
  screen.getByRole("switch", { name: "tripBuilder:popup.album.label" });
// The check shows a status line while it runs; waiting for it to go keeps every
// state update inside the awaited window, so none lands outside act(...).
const settled = (): Promise<void> => waitFor(() => expect(screen.queryByRole("status")).toBeNull());
const UNPAIRED_LINK = { name: "tripBuilder:popup.unpaired.link" };

describe("TripImmichOptions", () => {
  beforeEach(() => {
    mocks.capabilities.mockReset().mockResolvedValue(READY);
  });

  it("shows two switches, off, and asks nothing until one is flipped", () => {
    render(<Harness />);

    expect(inspect()).not.toBeChecked();
    expect(album()).not.toBeChecked();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it("asks once on the first flip and keeps the answer for the second", async () => {
    render(<Harness />);

    fireEvent.click(inspect());
    await settled();
    fireEvent.click(album());
    await settled();

    expect(mocks.capabilities).toHaveBeenCalledTimes(1);
    expect(inspect()).toBeChecked();
    expect(album()).toBeChecked();
  });

  it("switches back off and links to Immich's settings in a new tab when nothing is connected", async () => {
    mocks.capabilities.mockResolvedValue(caps({ configured: false, source: null }));
    render(<Harness />);

    fireEvent.click(inspect());

    const link = await screen.findByRole("link", UNPAIRED_LINK);
    expect(link).toHaveAttribute("href", "/settings/services?section=externalServices");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(inspect()).not.toBeChecked();
  });

  it("asks again after Immich was connected in the other tab", async () => {
    mocks.capabilities
      .mockResolvedValueOnce(caps({ configured: false, source: null }))
      .mockResolvedValueOnce(READY);
    render(<Harness />);
    fireEvent.click(inspect());
    await screen.findByRole("link", UNPAIRED_LINK);

    fireEvent.click(inspect());
    await settled();

    expect(mocks.capabilities).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link", UNPAIRED_LINK)).toBeNull();
    expect(inspect()).toBeChecked();
  });

  it("disables the album switch with the reason on a shared connection", async () => {
    mocks.capabilities.mockResolvedValue(
      caps({
        source: "global",
        inspect: { ok: null, missingScopes: [] },
        album: { canCreate: false, reason: "sharedConnection" },
      })
    );
    render(<Harness />);

    fireEvent.click(album());

    await waitFor(() => expect(album()).toBeDisabled());
    expect(album()).not.toBeChecked();
    expect(screen.getByText("tripBuilder:popup.album.blockedShared")).toBeTruthy();
    expect(inspect()).not.toBeDisabled();
  });

  it("disables both switches and names the missing permissions", async () => {
    mocks.capabilities.mockResolvedValue(
      caps({ inspect: { ok: false, missingScopes: ["asset.read", "user.read"] } })
    );
    render(<Harness />);

    fireEvent.click(inspect());

    await waitFor(() => expect(inspect()).toBeDisabled());
    expect(album()).toBeDisabled();
    expect(inspect()).not.toBeChecked();
    expect(screen.getByText("asset.read")).toBeTruthy();
    expect(screen.getByText("user.read")).toBeTruthy();
  });

  it("stays enabled when the key's permissions could not be verified, and says so", async () => {
    mocks.capabilities.mockResolvedValue(
      caps({
        inspect: { ok: null, missingScopes: [] },
        album: { canCreate: null, reason: "unverified" },
      })
    );
    render(<Harness />);

    fireEvent.click(album());

    expect(await screen.findByText("tripBuilder:popup.unverified")).toBeTruthy();
    expect(album()).toBeChecked();
    expect(album()).not.toBeDisabled();
  });

  it("notes that roadtrips are off, but only for an inspection", async () => {
    mocks.capabilities.mockResolvedValue(caps({}, { roadtrips: false }));
    render(<Harness />);

    fireEvent.click(album());
    await settled();
    expect(screen.queryByText("tripBuilder:popup.roadtripsOff")).toBeNull();

    fireEvent.click(inspect());
    expect(await screen.findByText("tripBuilder:popup.roadtripsOff")).toBeTruthy();
  });

  it("reverts the switch and says so when the check itself fails", async () => {
    mocks.capabilities.mockRejectedValue(new Error("down"));
    render(<Harness />);

    fireEvent.click(inspect());

    expect((await screen.findByRole("alert")).textContent).toBe("tripBuilder:popup.checkFailed");
    expect(inspect()).not.toBeChecked();
  });

  it("checks at once when a switch starts on, as the chooser's route opens it", async () => {
    render(<Harness initialInspect />);

    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledTimes(1));
    await settled();
    expect(inspect()).toBeChecked();
  });

  it("turns a switch that starts on back off when nothing is connected", async () => {
    mocks.capabilities.mockResolvedValue(caps({ configured: false, source: null }));
    render(<Harness initialInspect />);

    await screen.findByRole("link", UNPAIRED_LINK);
    expect(inspect()).not.toBeChecked();
  });

  it("says a cover comes after saving, once a switch is on", async () => {
    render(<Harness />);
    expect(screen.queryByText("tripBuilder:popup.coverLater")).toBeNull();

    fireEvent.click(inspect());

    expect(screen.getByText("tripBuilder:popup.coverLater")).toBeTruthy();
    await settled();
  });

  it("asks for both dates before a scan", async () => {
    render(<Harness startDay="" />);

    fireEvent.click(inspect());

    expect(screen.getByText("tripBuilder:popup.needDates")).toBeTruthy();
    await settled();
  });

  it("refuses a window longer than 62 days", async () => {
    render(<Harness endDay="2031-07-03" />);

    fireEvent.click(inspect());

    expect(screen.getByText("tripBuilder:popup.tooLong")).toBeTruthy();
    await settled();
  });
});
