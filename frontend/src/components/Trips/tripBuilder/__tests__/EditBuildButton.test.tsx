import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import EditBuildButton from "../EditBuildButton";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), addToast: vi.fn() }));

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../../lib/api/tripBuilder", () => ({ tripBuilderApi: { scan: mocks.scan } }));
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: unknown }) => unknown) =>
    select({ addToast: mocks.addToast }),
}));

const JOB = "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a";
const TRIP = {
  id: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  name: "Southern loop",
  startDate: "2031-05-02T00:00:00.000Z",
  endDate: "2031-05-07T00:00:00.000Z",
};

function Where(): JSX.Element {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderButton(props: Partial<Parameters<typeof EditBuildButton>[0]> = {}) {
  const onLaunched = vi.fn();
  render(
    <MemoryRouter initialEntries={["/trips/" + TRIP.id]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <EditBuildButton trip={TRIP} unsaved={false} onLaunched={onLaunched} {...props} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return onLaunched;
}

const button = () => screen.getByRole("button", { name: "tripBuilder:editBuild.button" });

beforeEach(() => {
  mocks.scan.mockReset();
  mocks.addToast.mockReset();
  sessionStorage.clear();
});

describe("EditBuildButton", () => {
  it("scans the saved dates of the trip, opens the review and closes the form", async () => {
    mocks.scan.mockResolvedValue({ jobId: JOB });
    const onLaunched = renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(mocks.scan).toHaveBeenCalledWith({
      name: "Southern loop",
      startDay: "2031-05-02",
      endDay: "2031-05-07",
      inspect: true,
      createAlbum: true,
      target: { kind: "existing", tripId: TRIP.id },
    });
    expect(screen.getByTestId("where")).toHaveTextContent(`/trips/builder?job=${JOB}`);
  });

  it("files the handoff the review page reads, back to the trip", async () => {
    mocks.scan.mockResolvedValue({ jobId: JOB });
    const onLaunched = renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    const handoff = JSON.parse(sessionStorage.getItem(`tb:job:${JOB}`) ?? "null");
    expect(handoff).toMatchObject({
      target: { kind: "existing", tripId: TRIP.id },
      returnTo: `/trips/${TRIP.id}`,
      scan: { createAlbum: true },
    });
  });

  it("waits for a saved form, and says so", () => {
    renderButton({ unsaved: true });
    expect(button()).toBeDisabled();
    expect(screen.getByText("tripBuilder:editBuild.unsaved")).toBeInTheDocument();
  });

  it.each([
    ["noDates", { startDate: null }],
    ["tooLong", { endDate: "2031-07-20T00:00:00.000Z" }],
    ["reversed", { endDate: "2031-05-01T00:00:00.000Z" }],
  ])("is off for a trip whose dates are %s, and says why", (reason, over) => {
    render(
      <MemoryRouter>
        <EditBuildButton trip={{ ...TRIP, ...over }} unsaved={false} onLaunched={vi.fn()} />
      </MemoryRouter>
    );
    expect(button()).toBeDisabled();
    expect(screen.getByText(`tripBuilder:editBuild.${reason}`)).toBeInTheDocument();
  });

  it("needs no router until it is pressed", () => {
    render(<EditBuildButton trip={TRIP} unsaved={false} onLaunched={vi.fn()} />);
    expect(button()).toBeEnabled();
  });

  it("says Immich is not set up, and lets the user try again", async () => {
    mocks.scan.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "notConfigured" } },
    });
    const onLaunched = renderButton();
    fireEvent.click(button());
    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:errors.scan.notConfigured")
    );
    expect(onLaunched).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
  });

  it("gives the wait when the server says to slow down", async () => {
    mocks.scan.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: "Too many requests", headers: { "retry-after": "120" } },
    });
    renderButton();
    fireEvent.click(button());
    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        "error",
        'tripBuilder:errors.rateLimitedMinutes {"count":2}'
      )
    );
  });
});
