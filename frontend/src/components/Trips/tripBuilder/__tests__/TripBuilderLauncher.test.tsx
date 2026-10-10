import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CreateTripInput } from "../../../../lib/api/trips";
import TripBuilderLauncher, { scanBodyOf } from "../TripBuilderLauncher";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), navigate: vi.fn(), addToast: vi.fn() }));
vi.mock("../../../../lib/api/tripBuilder", () => ({ tripBuilderApi: { scan: mocks.scan } }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

const JOB = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const FORM: CreateTripInput = {
  name: "Northvale loop",
  startDate: "2031-05-02",
  endDate: "2031-05-09",
};
const BOTH = { inspect: true, createAlbum: true };

function launch(form: CreateTripInput = FORM, wrap = false) {
  const onClose = vi.fn();
  const onFailed = vi.fn();
  const view = (
    <MemoryRouter initialEntries={["/trips?tab=list"]}>
      <TripBuilderLauncher form={form} options={BOTH} onClose={onClose} onFailed={onFailed} />
    </MemoryRouter>
  );
  const rendered = render(wrap ? <StrictMode>{view}</StrictMode> : view);
  return { onClose, onFailed, ...rendered };
}

describe("scanBodyOf", () => {
  it("asks for a new trip's window with the switches as set", () => {
    expect(scanBodyOf(FORM, { inspect: true, createAlbum: false })).toEqual({
      name: "Northvale loop",
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      inspect: true,
      createAlbum: false,
      target: { kind: "new" },
    });
  });

  it("asks for nothing when a day is missing", () => {
    expect(scanBodyOf({ name: "Northvale loop", startDate: "2031-05-02" }, BOTH)).toBeNull();
  });
});

describe("TripBuilderLauncher", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.scan.mockReset().mockResolvedValue({ jobId: JOB });
    mocks.navigate.mockReset();
    mocks.addToast.mockReset();
  });

  it("posts the scan for a new trip", async () => {
    launch();

    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
    expect(mocks.scan).toHaveBeenCalledWith({
      name: "Northvale loop",
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      inspect: true,
      createAlbum: true,
      target: { kind: "new" },
    });
  });

  it("keeps the hand-off, navigates to the review page, and only then closes the popup", async () => {
    const { onClose } = launch();

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // `scan` is the request that was posted: a scan that is lost before any draft
    // exists is offered again from it.
    expect(JSON.parse(sessionStorage.getItem(`tb:job:${JOB}`) ?? "null")).toEqual({
      form: FORM,
      target: { kind: "new" },
      returnTo: "/trips?tab=list",
      scan: {
        name: "Northvale loop",
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        inspect: true,
        createAlbum: true,
        target: { kind: "new" },
      },
    });
    expect(mocks.navigate).toHaveBeenCalledWith(`/trips/builder?job=${JOB}`);
    expect(mocks.navigate.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0]
    );
  });

  it("starts one scan even under StrictMode's second effect run", async () => {
    const { onClose } = launch(FORM, true);

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it("says Immich is not connected, and gives the form back", async () => {
    mocks.scan.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "notConfigured" } },
    });
    const { onClose, onFailed } = launch();

    await waitFor(() => expect(onFailed).toHaveBeenCalled());

    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:launch.notConfigured");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reads a rate limit and a lost connection the way every save form does", async () => {
    mocks.scan.mockRejectedValueOnce({ isAxiosError: true, response: { status: 429, data: {} } });
    mocks.scan.mockRejectedValueOnce({ isAxiosError: true });
    const first = launch();
    await waitFor(() => expect(first.onFailed).toHaveBeenCalled());
    first.unmount();
    const second = launch();
    await waitFor(() => expect(second.onFailed).toHaveBeenCalled());

    expect(mocks.addToast).toHaveBeenNthCalledWith(1, "error", "common:saveErrors.rateLimited");
    expect(mocks.addToast).toHaveBeenNthCalledWith(2, "error", "common:saveErrors.network");
  });

  it("refuses to scan without both days and says so", async () => {
    const { onFailed } = launch({ name: "Northvale loop" });

    await waitFor(() => expect(onFailed).toHaveBeenCalled());

    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:launch.needDates");
  });

  it("does not navigate for a popup that was closed while the scan was starting", async () => {
    let answer: (value: { jobId: string }) => void = () => undefined;
    mocks.scan.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { onClose, unmount } = launch();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalled());

    unmount();
    answer({ jobId: JOB });
    await Promise.resolve();

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`tb:job:${JOB}`)).toBeNull();
  });
});
