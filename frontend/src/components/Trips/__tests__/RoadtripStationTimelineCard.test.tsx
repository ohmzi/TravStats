import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { stationDto } from "../../../lib/__tests__/roadtripStationFixture";
import { buildTimelineEvents, type TimelineEvent } from "../../../lib/tripTimelineEvents";
import type { Trip } from "../../../types";
import type { TripRoadtripStationDto } from "../../../types/tripRoadtripStation";
import { RoadtripStationTimelineCard } from "../RoadtripStationTimelineCard";
import { TransitCard } from "../timelineTransit";

type StationEvent = Extract<TimelineEvent, { kind: "roadtrip-station" }>;

function tripWith(over: Partial<Trip>): Trip {
  return { id: "t1", flights: [], cruises: [], stops: [], journalEntries: [], ...over } as Trip;
}

/** The entry the timeline builds for one station, so the card is tested on what it is given. */
function entry(over: Partial<TripRoadtripStationDto> = {}): StationEvent {
  const [event] = buildTimelineEvents(tripWith({ roadtripStations: [stationDto(over)] }), []);
  if (event?.kind !== "roadtrip-station") throw new Error("the station has no timeline entry");
  return event;
}

const inRouter = (node: JSX.Element): JSX.Element => <MemoryRouter>{node}</MemoryRouter>;

describe("RoadtripStationTimelineCard", () => {
  it("shows the station with its roadtrip and its nights, closed", () => {
    render(inRouter(<RoadtripStationTimelineCard ev={entry()} />));

    expect(screen.getByText("Northvale")).toBeTruthy();
    expect(screen.getByText("Northvale loop · roadtrips:nightsCount")).toBeTruthy();
    expect(screen.getByText("02.05.2031")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("calls a station without a night a pass-through", () => {
    render(inRouter(<RoadtripStationTimelineCard ev={entry({ state: "pass", nights: 0 })} />));

    expect(screen.getByText("Northvale loop · roadtrips:night.pass")).toBeTruthy();
  });

  it("opens in place and links to the roadtrip it belongs to", () => {
    render(
      inRouter(<RoadtripStationTimelineCard ev={entry({ notes: "Camped by the harbour" })} />)
    );

    fireEvent.click(screen.getByRole("button", { name: /Northvale/ }));

    expect(screen.getByText("Camped by the harbour")).toBeTruthy();
    expect(screen.getByText("02.05.2031 → 04.05.2031")).toBeTruthy();
    const link = screen.getByRole("link", { name: /tripBuilder:timeline\.open/ });
    expect(link.getAttribute("href")).toBe("/roadtrips/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");
  });

  it("wears the roadtrip colour", () => {
    const { container } = render(inRouter(<RoadtripStationTimelineCard ev={entry()} />));

    expect(container.innerHTML).toContain("var(--domain-roadtrip)");
  });
});

describe("TransitCard", () => {
  it("draws a roadtrip station", () => {
    render(inRouter(<TransitCard ev={entry()} />));

    expect(screen.getByText("Northvale")).toBeTruthy();
  });

  it("still draws nothing for an entry that is not transit", () => {
    const diary = { id: "j1", tripId: "t1", date: "2031-05-02T00:00:00.000Z", title: "Day one" };
    const [event] = buildTimelineEvents(
      tripWith({ journalEntries: [diary] as unknown as Trip["journalEntries"] }),
      []
    );

    const { container } = render(inRouter(<TransitCard ev={event} />));

    expect(container.innerHTML).toBe("");
  });
});
