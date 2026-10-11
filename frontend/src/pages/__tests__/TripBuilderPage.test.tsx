import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, matchRoutes, useLocation } from "react-router-dom";

import { existingDraft, station } from "../../lib/tripBuilder/__tests__/existingFixture";
import {
  DRAFT_ID,
  FLIGHT_ELSEWHERE,
  FLIGHT_OUT,
  KEY,
  reviewDraft,
} from "../../lib/tripBuilder/__tests__/reviewFixtures";
import type { CommitJobResult, TripBuilderDraft } from "../../types/tripBuilder";
import TripBuilderPage from "../TripBuilderPage";

const mocks = vi.hoisted(() => {
  class JobLostError extends Error {
    constructor() {
      super("job lost");
      this.name = "JobLostError";
    }
  }
  class JobFailedError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number
    ) {
      super(code);
      this.name = "JobFailedError";
    }
  }
  return {
    JobLostError,
    JobFailedError,
    getDraft: vi.fn(),
    commit: vi.fn(),
    retryAlbum: vi.fn(),
    scan: vi.fn(),
    discardDraft: vi.fn(),
    waitForJob: vi.fn(),
    confirm: vi.fn(),
    addToast: vi.fn(),
  };
});

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../lib/api/tripBuilder", () => ({
  tripBuilderApi: {
    getDraft: mocks.getDraft,
    commit: mocks.commit,
    retryAlbum: mocks.retryAlbum,
    scan: mocks.scan,
    discardDraft: mocks.discardDraft,
    previewUrl: (id: string, index: number) => `/thumb/${id}/${index}`,
  },
}));
vi.mock("../../lib/api/jobs", () => ({
  waitForJob: mocks.waitForJob,
  JobLostError: mocks.JobLostError,
  JobFailedError: mocks.JobFailedError,
}));
vi.mock("../../hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => ({
    confirm: mocks.confirm,
    confirmDelete: vi.fn(),
    confirmDialog: null,
  }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/Trips/TripMap", () => ({
  default: (props: { trip: { stops: unknown[] } }) => (
    <div data-testid="map" data-stops={props.trip.stops.length} />
  ),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: unknown }) => unknown) =>
    select({ addToast: mocks.addToast }),
}));

// Synthetic fixtures only (public repository): invented places, shifted years.
const JOB = "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a";
const NEXT_JOB = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const COMMIT_JOB = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
const KEY_NAME = `tb:draft:${DRAFT_ID}`;
const STORED_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";

const RESULT: CommitJobResult = {
  status: "committed",
  tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  created: true,
  roadtrips: [
    { id: "r1", name: "Southern loop · Northvale", stations: 4, nights: 2 },
    { id: "r2", name: "Southern loop · Southbridge", stations: 2, nights: 1 },
  ],
  stopIds: [],
  flightsAssigned: 1,
  flightsMovedFrom: [],
  routing: { routed: 0, straight: 4, ferry: 0, providerAvailable: true },
  photoJourneysResolved: 1,
  unknownNights: 1,
  album: { status: "linked", added: 72, alreadyIn: 0 },
};

const UPDATED: CommitJobResult = {
  ...RESULT,
  created: false,
  roadtrips: [
    {
      id: "r1",
      name: "Northvale loop",
      stations: 5,
      nights: 6,
      diff: { updated: 1, unchanged: 2, added: 1, removed: 0, kept: 1 },
    },
  ],
  flightsAssigned: 0,
  routing: { routed: 2, straight: 0, ferry: 0, providerAvailable: true },
  photoJourneysResolved: 0,
  unknownNights: 0,
  album: { status: "linked", added: 4, alreadyIn: 36, removed: 3 },
};

function Where(): JSX.Element {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/trips/builder"
          element={
            <>
              <TripBuilderPage />
              <Where />
            </>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const where = () => screen.getByTestId("where").textContent;
const stationRow = (key: string): HTMLElement =>
  document.querySelector(`[data-station="${key}"]`) as HTMLElement;
// Every other phase sits under the page's own h1, so "the review is there" is the review's h1.
const reviewShown = () =>
  screen.findByRole("heading", { level: 1, name: /tripBuilder:review\.title/ });
const renderDraft = async (draft: TripBuilderDraft = reviewDraft()) => {
  mocks.getDraft.mockResolvedValue(draft);
  renderAt(`/trips/builder?draft=${draft.id}`);
  await reviewShown();
};
const createButton = () => screen.getByRole("button", { name: "tripBuilder:review.createTrip" });
const updateButton = () =>
  screen.getByRole("button", { name: "tripBuilder:existing.header.update" });

beforeEach(() => {
  for (const fn of [
    mocks.getDraft,
    mocks.commit,
    mocks.retryAlbum,
    mocks.scan,
    mocks.discardDraft,
    mocks.waitForJob,
    mocks.confirm,
    mocks.addToast,
  ]) {
    fn.mockReset();
  }
  mocks.discardDraft.mockResolvedValue(undefined);
  sessionStorage.clear();
});

describe("the scan", () => {
  it("reads 'Step n of 7' with the phase the job is in", async () => {
    mocks.waitForJob.mockImplementation(
      (_id: string, options: { onPoll: (job: unknown) => void }) => {
        options.onPoll({ progress: { done: 3, total: 7 } });
        return new Promise(() => undefined);
      }
    );
    renderAt(`/trips/builder?job=${JOB}`);
    expect(
      await screen.findByText(
        'tripBuilder:review.scan.step {"done":3,"total":7,"phase":"tripBuilder:progress.flights"}'
      )
    ).toBeInTheDocument();
  });

  it("says 'running' for a job that does not count its work", async () => {
    mocks.waitForJob.mockImplementation(
      (_id: string, options: { onPoll: (job: unknown) => void }) => {
        options.onPoll({ progress: null });
        return new Promise(() => undefined);
      }
    );
    renderAt(`/trips/builder?job=${JOB}`);
    expect(await screen.findByText("tripBuilder:review.scan.running")).toBeInTheDocument();
  });

  it("says a lost scan wrote nothing and offers the way back", async () => {
    mocks.waitForJob.mockRejectedValue(new mocks.JobLostError());
    renderAt(`/trips/builder?job=${JOB}`);
    expect(await screen.findByText("tripBuilder:review.scan.lost")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tripBuilder:review.expired.scanAgain" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.back" }));
    expect(where()).toBe("/trips");
  });

  it("repeats the request a lost scan's hand-off kept, from the lost screen itself", async () => {
    const scan = {
      name: "Southern loop",
      startDay: "2031-05-02",
      endDay: "2031-05-07",
      inspect: true,
      createAlbum: false,
      target: { kind: "new" },
    };
    sessionStorage.setItem(
      `tb:job:${JOB}`,
      JSON.stringify({
        form: { name: "Southern loop" },
        target: { kind: "new" },
        returnTo: "/trips",
        scan,
      })
    );
    mocks.waitForJob
      .mockRejectedValueOnce(new mocks.JobLostError())
      .mockReturnValue(new Promise(() => undefined));
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    renderAt(`/trips/builder?job=${JOB}`);
    expect(await screen.findByText("tripBuilder:review.scan.lost")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.expired.scanAgain" }));
    await waitFor(() => expect(where()).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(scan);
  });

  it("gives an Immich failure its own sentence", async () => {
    mocks.waitForJob.mockRejectedValue(new mocks.JobFailedError("immich_auth", 502));
    renderAt(`/trips/builder?job=${JOB}`);
    expect(await screen.findByText("tripBuilder:errors.scan.immich_auth")).toBeInTheDocument();
  });

  it("opens the draft the job made, and puts the edits a re-scan carried onto it", async () => {
    sessionStorage.setItem(
      `tb:carry:${JOB}`,
      JSON.stringify({
        edits: [
          { type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" },
          { type: "rename", stationKey: "gone", title: "x" },
        ],
        commitKey: STORED_KEY,
      })
    );
    mocks.waitForJob.mockResolvedValue({ draftId: DRAFT_ID });
    mocks.getDraft.mockResolvedValue(reviewDraft());
    renderAt(`/trips/builder?job=${JOB}`);
    await reviewShown();
    expect(within(stationRow(KEY.northvale)).getByText("Northvale Lodge")).toBeInTheDocument();
    expect(where()).toBe(`/trips/builder?draft=${DRAFT_ID}`);
    expect(
      screen.getByText('tripBuilder:review.header.carried {"kept":1,"total":2}')
    ).toBeInTheDocument();
  });
});

describe("resuming a review", () => {
  it("puts the edits kept in sessionStorage back by their station keys", async () => {
    sessionStorage.setItem(
      KEY_NAME,
      JSON.stringify({
        edits: [{ type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" }],
        commitKey: STORED_KEY,
      })
    );
    await renderDraft();
    expect(within(stationRow(KEY.northvale)).getByText("Northvale Lodge")).toBeInTheDocument();
    expect(screen.queryByText(/review\.header\.carried/)).not.toBeInTheDocument();
  });

  it("says an expired draft is gone and that scanning again keeps the edits", async () => {
    mocks.getDraft.mockRejectedValue({ response: { status: 404 } });
    sessionStorage.setItem(
      `tb:scan:${DRAFT_ID}`,
      JSON.stringify({
        scan: {
          name: "Southern loop",
          startDay: "2031-05-02",
          endDay: "2031-05-07",
          inspect: true,
          createAlbum: false,
          target: { kind: "new" },
        },
        handoff: { form: { name: "Southern loop" }, target: { kind: "new" }, returnTo: "/trips" },
      })
    );
    sessionStorage.setItem(KEY_NAME, JSON.stringify({ edits: [], commitKey: STORED_KEY }));
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    renderAt(`/trips/builder?draft=${DRAFT_ID}`);
    expect(await screen.findByText("tripBuilder:review.expired.keeps")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.expired.scanAgain" }));
    await waitFor(() => expect(where()).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ startDay: "2031-05-02" }));
  });

  it("offers only the way back when an expired draft cannot be scanned again", async () => {
    mocks.getDraft.mockRejectedValue({ response: { status: 404 } });
    renderAt(`/trips/builder?draft=${DRAFT_ID}`);
    expect(await screen.findByText("tripBuilder:review.expired.startOver")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tripBuilder:review.expired.scanAgain" })
    ).toBeNull();
  });

  it("says so when the draft cannot be loaded for any other reason", async () => {
    mocks.getDraft.mockRejectedValue(new Error("network"));
    renderAt(`/trips/builder?draft=${DRAFT_ID}`);
    expect(await screen.findByText("tripBuilder:review.loadFailed")).toBeInTheDocument();
  });

  it("has nothing to review without a job or a draft in the address", async () => {
    renderAt("/trips/builder");
    expect(await screen.findByText("tripBuilder:review.nothing")).toBeInTheDocument();
  });
});

describe("the review", () => {
  it("shows the flights, the one on another trip unticked and saying so", async () => {
    await renderDraft();
    const [out, elsewhere] = screen.getAllByRole("switch", { name: /ZZ/ });
    expect(out).toBeChecked();
    expect(elsewhere).not.toBeChecked();
    expect(
      screen.getByText('tripBuilder:review.flights.currentTrip {"trip":"Kelmore weekend"}')
    ).toBeInTheDocument();
  });

  it("shows no album section for a scan that asked for none, and none of the areas without inspect", async () => {
    await renderDraft(
      reviewDraft({
        album: null,
        options: { inspect: false, createAlbum: false },
        areas: [],
        nights: {},
        days: [],
      })
    );
    expect(screen.queryByText("tripBuilder:review.album.title")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-area]")).toHaveLength(0);
    expect(screen.getByText("tripBuilder:review.flights.title")).toBeInTheDocument();
  });

  it("draws the route on the map beside the list", async () => {
    await renderDraft();
    expect(await screen.findByTestId("map")).toHaveAttribute("data-stops", "6");
  });

  it("draws every area, and the nights still open", async () => {
    await renderDraft();
    expect(document.querySelectorAll("[data-area]")).toHaveLength(2);
    expect(
      screen.getByText('tripBuilder:review.header.unknownNights {"count":1}')
    ).toBeInTheDocument();
  });

  it("offers Create trip for a new trip", async () => {
    await renderDraft();
    expect(createButton()).toBeEnabled();
  });

  it("says update trip for an existing trip, and not create", async () => {
    await renderDraft(existingDraft());
    expect(updateButton()).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "tripBuilder:review.createTrip" })
    ).not.toBeInTheDocument();
  });

  it("will not create a trip without a name", async () => {
    await renderDraft();
    fireEvent.change(screen.getByLabelText("tripBuilder:review.header.name"), {
      target: { value: " " },
    });
    expect(createButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "tripBuilder:review.problems.blankTripName"
    );
  });

  it("scans again for other dates and carries the edits along", async () => {
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    await renderDraft();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.header.changeDates" }));
    fireEvent.change(screen.getByLabelText(/tripBuilder:review\.dates\.end/), {
      target: { value: "2031-05-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.dates.scanAgain" }));
    await waitFor(() => expect(where()).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        name: "Southern loop",
      })
    );
  });

  it("goes back without asking when nothing was edited, and discards the draft", async () => {
    await renderDraft();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.back" }));
    await waitFor(() => expect(where()).toBe("/trips"));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.discardDraft).toHaveBeenCalledWith(DRAFT_ID);
  });

  it("asks before going back with edits, and stays when the answer is no", async () => {
    mocks.confirm.mockResolvedValue(false);
    await renderDraft();
    fireEvent.click(screen.getAllByRole("switch", { name: /ZZ202/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.back" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(where()).toBe(`/trips/builder?draft=${DRAFT_ID}`);
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it("goes back to where the review was started from when the answer is yes", async () => {
    mocks.confirm.mockResolvedValue(true);
    sessionStorage.setItem(
      `tb:scan:${DRAFT_ID}`,
      JSON.stringify({
        scan: {
          name: "x",
          startDay: "2031-05-02",
          endDay: "2031-05-07",
          inspect: true,
          createAlbum: false,
          target: { kind: "new" },
        },
        handoff: { form: { name: "x" }, target: { kind: "new" }, returnTo: "/trips/abc" },
      })
    );
    await renderDraft();
    fireEvent.click(screen.getAllByRole("switch", { name: /ZZ202/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.back" }));
    await waitFor(() => expect(where()).toBe("/trips/abc"));
  });

  it("takes back every edit on request", async () => {
    await renderDraft();
    fireEvent.click(screen.getAllByRole("switch", { name: /ZZ202/ })[0]);
    expect(screen.getAllByRole("switch", { name: /ZZ202/ })[0]).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.reset" }));
    expect(screen.getAllByRole("switch", { name: /ZZ202/ })[0]).not.toBeChecked();
  });
});

describe("saving", () => {
  beforeEach(() => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
  });

  it("sends the body the review made, under its key, and shows the summary", async () => {
    mocks.waitForJob.mockResolvedValue(RESULT);
    await renderDraft();
    fireEvent.click(createButton());
    expect(await screen.findByText("tripBuilder:review.success.created")).toBeInTheDocument();
    const [draftId, body] = mocks.commit.mock.calls[0];
    expect(draftId).toBe(DRAFT_ID);
    expect(body).toMatchObject({
      window: { startDay: "2031-05-02", endDay: "2031-05-07" },
      flightIds: [FLIGHT_OUT],
      album: { create: true, name: "Southern loop" },
    });
    expect(body.commitKey).toMatch(/^[0-9a-f-]{36}$/);
    const summary = screen.getByText(/review\.success\.stations/);
    for (const part of [
      'tripBuilder:review.success.stations {"count":6}',
      'tripBuilder:review.success.nights {"count":3}',
      'tripBuilder:review.success.flights {"count":1}',
      'tripBuilder:review.success.legsStraight {"count":4}',
      'tripBuilder:review.success.unknownNights {"count":1}',
      'tripBuilder:review.success.albumAdded {"added":72,"already":0}',
    ]) {
      expect(summary).toHaveTextContent(part);
    }
    expect(screen.queryByText(/existing\.success/)).not.toBeInTheDocument();
  });

  it("says what a re-sync changed under the summary, and says the album once", async () => {
    mocks.waitForJob.mockResolvedValue(UPDATED);
    await renderDraft(existingDraft());
    fireEvent.click(updateButton());
    expect(await screen.findByText("tripBuilder:review.success.updated")).toBeInTheDocument();
    expect(
      screen.getByText(
        'tripBuilder:existing.success.roadtrip {"name":"Northvale loop","updated":1,"unchanged":2,"added":1,"removed":0,"kept":1}'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:existing.success.album {"added":4,"alreadyIn":36,"removed":3}')
    ).toBeInTheDocument();
    expect(screen.getByText(/review\.success\.stations/)).not.toHaveTextContent("albumAdded");
  });

  it("offers a new scan, keeping the edits, when the trip changed since the scan", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "TRIP_CHANGED" } },
    });
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    await renderDraft(existingDraft());
    fireEvent.click(updateButton());
    expect(await screen.findByText("tripBuilder:errors.commit.tripChanged")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.failed.scanAgain" }));
    await waitFor(() => expect(where()).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        startDay: "2031-05-02",
        endDay: "2031-05-07",
        target: { kind: "existing", tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c" },
      })
    );
    expect(JSON.parse(sessionStorage.getItem(`tb:carry:${NEXT_JOB}`) ?? "null")).toMatchObject({
      edits: [],
      commitKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("offers the scan again, keeping the edits, when the draft expired before the commit", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: "x", code: "DRAFT_EXPIRED" } },
    });
    mocks.scan.mockResolvedValue({ jobId: NEXT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    await renderDraft();
    fireEvent.click(screen.getAllByRole("switch", { name: /ZZ202/ })[0]);
    fireEvent.click(createButton());
    expect(await screen.findByText("tripBuilder:errors.commit.draftExpired")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.failed.scanAgain" }));
    await waitFor(() => expect(where()).toBe(`/trips/builder?job=${NEXT_JOB}`));
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Southern loop",
        startDay: "2031-05-02",
        endDay: "2031-05-07",
        target: { kind: "new" },
      })
    );
    const edit = { type: "setFlightTick", flightId: FLIGHT_ELSEWHERE, ticked: true };
    expect(JSON.parse(sessionStorage.getItem(`tb:carry:${NEXT_JOB}`) ?? "null")).toMatchObject({
      edits: [edit],
      commitKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    // The edits are still in the stored review, so the new draft's load replays them.
    expect(JSON.parse(sessionStorage.getItem(KEY_NAME) ?? "null")?.edits).toEqual([edit]);
  });

  it("saves an album-only scan on Create, which is its confirmation", async () => {
    mocks.waitForJob.mockResolvedValue({ ...RESULT, roadtrips: [] });
    await renderDraft(
      reviewDraft({
        options: { inspect: false, createAlbum: true },
        areas: [],
        days: [],
        nights: {},
      })
    );
    expect(document.querySelectorAll("[data-area]")).toHaveLength(0);
    expect(screen.getByText("tripBuilder:review.album.title")).toBeInTheDocument();
    fireEvent.click(createButton());
    expect(await screen.findByText("tripBuilder:review.success.created")).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.commit.mock.calls[0][1]).toMatchObject({
      areas: [],
      album: { create: true, name: "Southern loop" },
    });
  });

  it("opens the trip", async () => {
    mocks.waitForJob.mockResolvedValue(RESULT);
    await renderDraft();
    fireEvent.click(createButton());
    fireEvent.click(await screen.findByRole("button", { name: "tripBuilder:review.success.open" }));
    expect(where()).toBe(`/trips/${RESULT.status === "committed" ? RESULT.tripId : ""}`);
  });

  it("retries the album that failed, and shows what it did", async () => {
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        album: { status: "failed", error: { kind: "unreachable" } },
      })
      .mockResolvedValueOnce({ status: "linked", added: 72, alreadyIn: 0 });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    await renderDraft();
    fireEvent.click(createButton());
    fireEvent.click(
      await screen.findByRole("button", { name: "tripBuilder:review.success.retryAlbum" })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "tripBuilder:review.success.retryAlbum" })
      ).toBeNull()
    );
    expect(mocks.retryAlbum).toHaveBeenCalledWith(
      RESULT.status === "committed" ? RESULT.tripId : "",
      "Southern loop",
      false
    );
  });

  it("offers to fix the key or save without the album when the preflight blocks it", async () => {
    mocks.waitForJob
      .mockResolvedValueOnce({
        status: "blocked",
        reason: "missingScopes",
        missingScopes: ["album.create"],
      })
      .mockResolvedValueOnce(RESULT);
    await renderDraft();
    fireEvent.click(createButton());
    const fix = await screen.findByRole("link", { name: "tripBuilder:review.blocked.fixKey" });
    expect(fix).toHaveAttribute("target", "_blank");
    expect(fix).toHaveAttribute("href", "/settings/services?section=externalServices");
    expect(
      screen.getByText('tripBuilder:review.blocked.missingScopes {"scopes":"album.create"}')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "tripBuilder:review.blocked.saveWithoutAlbum" })
    );
    expect(await screen.findByText("tripBuilder:review.success.created")).toBeInTheDocument();
    const [first, second] = mocks.commit.mock.calls.map((call) => call[1]);
    expect(first.album.create).toBe(true);
    expect(second.album.create).toBe(false);
    expect(second.commitKey).toBe(first.commitKey);
  });

  it("says a refused commit in words, and leaves the review as it was", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "WINDOW_CHANGED" } },
    });
    await renderDraft();
    fireEvent.click(createButton());
    expect(await screen.findByText("tripBuilder:errors.commit.windowChanged")).toBeInTheDocument();
    expect(createButton()).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "tripBuilder:review.failed.scanAgain" })
    ).not.toBeInTheDocument();
  });

  it("gives the wait when the server says to slow down", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: "Too many requests", headers: { "retry-after": "540" } },
    });
    await renderDraft();
    fireEvent.click(createButton());
    expect(
      await screen.findByText('tripBuilder:errors.rateLimitedMinutes {"count":9}')
    ).toBeInTheDocument();
  });

  it("opens the trip a repeated commit says already exists", async () => {
    mocks.commit.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "ALREADY_COMMITTED", tripId: "t-77" } },
    });
    await renderDraft();
    fireEvent.click(createButton());
    fireEvent.click(await screen.findByRole("button", { name: "tripBuilder:review.success.open" }));
    expect(where()).toBe("/trips/t-77");
  });

  it("says the outcome is unknown when the commit job is lost, never that it failed", async () => {
    mocks.waitForJob.mockRejectedValue(new mocks.JobLostError());
    await renderDraft();
    fireEvent.click(createButton());
    expect(await screen.findByText("tripBuilder:review.unknown")).toBeInTheDocument();
    expect(screen.queryByText(/errors\.commit/)).not.toBeInTheDocument();
  });
});

describe("while the trip is being saved", () => {
  // The commit key belongs to this draft: a re-scan would hand it to another draft
  // (a second trip), and leaving would hide what the commit in flight did.
  beforeEach(() => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
  });

  const nothingButFlights = () =>
    reviewDraft({
      stats: { ...reviewDraft().stats, assets: 0, located: 0 },
      areas: [],
      days: [],
      nights: {},
      album: null,
    });

  it("leaves every way out of an empty window alone until the commit is answered", async () => {
    await renderDraft(nothingButFlights());
    fireEvent.click(screen.getByRole("button", { name: /flightsOnlyNew/ }));
    await screen.findByText("tripBuilder:review.saving");

    const cancel = screen.getByRole("button", { name: "tripBuilder:review.empty.cancel" });
    const changeHere = screen.getByRole("button", {
      name: "tripBuilder:review.empty.changeDates",
    });
    expect(cancel).toBeDisabled();
    expect(changeHere).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(changeHere);
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.header.changeDates" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.discardDraft).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(where()).toBe(`/trips/builder?draft=${DRAFT_ID}`);
  });

  it("does not scan again for the dates a warning suggests", async () => {
    await renderDraft(
      reviewDraft({
        warnings: [
          {
            code: "flightOutsideDates",
            params: { flightId: FLIGHT_OUT, suggestStartDay: "2031-05-01" },
          },
        ],
      })
    );
    fireEvent.click(createButton());
    await screen.findByText("tripBuilder:review.saving");

    fireEvent.click(
      screen.getByRole("button", { name: 'tripBuilder:warnings.extendStart {"day":"01.05.2031"}' })
    );

    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.discardDraft).not.toHaveBeenCalled();
    expect(where()).toBe(`/trips/builder?draft=${DRAFT_ID}`);
  });
});

describe("a window with nothing in it", () => {
  const nothing = (partner = 0) =>
    reviewDraft({
      stats: {
        assets: 0,
        images: 0,
        videos: 0,
        located: 0,
        excluded: {
          partner,
          hiddenLivePart: 0,
          misdated: 0,
          inFlight: 0,
          atSea: 0,
          unlocated: 0,
          dayGuessed: 0,
        },
        truncated: false,
      },
      areas: [],
      days: [],
      nights: {},
      album: null,
      warnings: [
        {
          code: "emptyWindow",
          params: {
            checkedFrom: "2031-04-29",
            checkedTo: "2031-05-10",
            partner,
            trashedNote: false,
          },
        },
      ],
    });

  it("says what was checked and offers the three ways on", async () => {
    await renderDraft(nothing(3));
    expect(
      screen.getByText('tripBuilder:review.empty.noPhotos {"from":"02.05.2031","to":"07.05.2031"}')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/review\.empty\.checked \{"from":"29\.04\.2031","to":"10\.05\.2031"\}/)
    ).toHaveTextContent('tripBuilder:review.empty.partner {"count":3}');
    expect(
      screen.getByRole("button", { name: "tripBuilder:review.empty.changeDates" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'tripBuilder:review.empty.flightsOnlyNew {"count":1}' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tripBuilder:review.empty.cancel" })
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("saves the trip with the flights only", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValue({
      ...RESULT,
      roadtrips: [],
      routing: {
        ...(RESULT.status === "committed"
          ? RESULT.routing
          : { routed: 0, straight: 0, ferry: 0, providerAvailable: true }),
      },
    });
    await renderDraft(nothing());
    fireEvent.click(screen.getByRole("button", { name: /flightsOnlyNew/ }));
    await screen.findByText("tripBuilder:review.success.created");
    expect(mocks.commit.mock.calls[0][1]).toMatchObject({ flightIds: [FLIGHT_OUT], areas: [] });
  });

  it("opens the dates dialog from the empty screen", async () => {
    await renderDraft(nothing());
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.empty.changeDates" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels back to where the review started", async () => {
    await renderDraft(nothing());
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.empty.cancel" }));
    await waitFor(() => expect(where()).toBe("/trips"));
  });

  it("proceeds with the album when there are photos but none with a place", async () => {
    await renderDraft(
      reviewDraft({
        stats: { ...reviewDraft().stats, assets: 5, located: 0 },
        areas: [],
        days: [],
        nights: {},
        warnings: [{ code: "noLocatedPhotos", params: {} }],
      })
    );
    expect(screen.getByText("tripBuilder:warnings.noLocatedPhotos {}")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.album.title")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-area]")).toHaveLength(0);
    expect(createButton()).toBeEnabled();
  });
});

describe("an empty window on an existing trip", () => {
  // The empty screen shows only the flights: the re-sync decisions it cannot
  // show (spec §K.5) are never submitted, so every stored stop is kept and the
  // album removes nothing.
  const emptyExisting = (over: Partial<TripBuilderDraft> = {}): TripBuilderDraft =>
    existingDraft({
      stats: { ...existingDraft().stats, assets: 0, located: 0 },
      flights: [reviewDraft().flights[0]],
      ...over,
    });

  const flightsOnly = () => screen.getByRole("button", { name: /flightsOnlyExisting/ });

  beforeEach(() => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValue({ ...RESULT, created: false, roadtrips: [] });
  });

  it("keeps every not-seen stop and removes nothing from the album", async () => {
    await renderDraft(
      emptyExisting({
        areas: [],
        days: [],
        nights: {},
        notSeenStops: [
          station(KEY.tarnside, "Tarnside", "2031-05-07", "2031-05-09", {
            status: "notSeen",
            existingId: "stop-o",
            titleSource: "existing",
            notSeen: { defaultKeep: false, reason: "outsideWindow" },
          }),
        ],
      })
    );
    fireEvent.click(flightsOnly());
    await screen.findByText("tripBuilder:review.success.updated");
    expect(mocks.commit.mock.calls[0][1]).toMatchObject({
      flightIds: [FLIGHT_OUT],
      stops: { keep: ["stop-o"], remove: [] },
      album: { removeOutside: false },
    });
  });

  it("keeps every not-seen station of the areas it never drew", async () => {
    await renderDraft(emptyExisting());
    fireEvent.click(flightsOnly());
    await screen.findByText("tripBuilder:review.success.updated");
    const body = mocks.commit.mock.calls[0][1];
    expect(body.areas[0].keepNotSeen).toEqual(["st-c", "st-d"]);
    expect(body.areas[0].removeNotSeen).toEqual([]);
    expect(body.stops).toEqual({ keep: ["stop-h"], remove: [] });
    expect(body.album.removeOutside).toBe(false);
  });
});

describe("the heading", () => {
  const onlyHeading = async (name: string): Promise<void> => {
    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(name);
  };

  it("is the page's title while the scan runs", async () => {
    mocks.waitForJob.mockReturnValue(new Promise(() => undefined));
    renderAt(`/trips/builder?job=${JOB}`);
    await onlyHeading("tripBuilder:page.title");
  });

  it("is the page's title when there is nothing to review", async () => {
    renderAt("/trips/builder");
    await onlyHeading("tripBuilder:page.title");
  });

  it("is the page's title when the draft could not be loaded", async () => {
    mocks.getDraft.mockRejectedValue(new Error("network"));
    renderAt(`/trips/builder?draft=${DRAFT_ID}`);
    await screen.findByText("tripBuilder:review.loadFailed");
    await onlyHeading("tripBuilder:page.title");
  });

  it("is the page's title once the trip is saved", async () => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
    mocks.waitForJob.mockResolvedValue(RESULT);
    await renderDraft();
    fireEvent.click(createButton());
    await screen.findByText("tripBuilder:review.success.created");
    await onlyHeading("tripBuilder:page.title");
  });

  it("is the review's own, and the only one, while reviewing", async () => {
    await renderDraft();
    await onlyHeading("tripBuilder:review.titleNew");
    expect(screen.queryByText("tripBuilder:page.title")).not.toBeInTheDocument();
  });

  it("is the review's own, and says update, for an existing trip", async () => {
    await renderDraft(
      reviewDraft({
        target: {
          kind: "existing",
          tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
          tripName: "Southern loop",
        },
      })
    );
    await onlyHeading("tripBuilder:review.titleExisting");
  });
});

describe("the route", () => {
  it("is not taken for a trip id: the static segment outranks /trips/:id whatever the order", () => {
    const routes = [{ path: "/trips/:id" }, { path: "/trips/builder" }];
    expect(matchRoutes(routes, "/trips/builder")?.[0].route.path).toBe("/trips/builder");
    expect(matchRoutes(routes, "/trips/3f1c2a4e")?.[0].route.path).toBe("/trips/:id");
  });
});
