import { describe, it, expect } from "vitest";
import { tripEntryCounts, tripEntryTotal } from "../tripEntryCount";
import type { Trip } from "../../types";

const all = (): boolean => true;

describe("tripEntryCounts (forgejo#169)", () => {
  it("counts a trip holding only a train ride as one entry", () => {
    const trip = {
      _count: { flights: 0, cruises: 0, lodgingStays: 0, railJourneys: 1 },
    } as unknown as Trip;
    expect(tripEntryTotal(tripEntryCounts(trip, all))).toBe(1);
  });

  it("counts every area the trip page lists", () => {
    const trip = {
      _count: {
        flights: 2,
        cruises: 1,
        lodgingStays: 3,
        railJourneys: 1,
        rentalBookings: 1,
        roadtrips: 1,
        routes: 4,
        photos: 9,
      },
    } as unknown as Trip;
    const counts = tripEntryCounts(trip, all);
    // `roadtrips` (1) is only the kind='roadtrip' subset of `routes` (4); the
    // page lists every section, so the card counts all four.
    expect(counts).toMatchObject({ rail: 1, rental: 1, roadtrip: 4, poi: 0 });
    // Photos are not entries; every route section is (tours included): 2 + 1 + 3 + 1 + 1 + 4.
    expect(tripEntryTotal(counts)).toBe(12);
  });

  it("counts a trip of day tours, which `_count.roadtrips` misses (d23d143b8)", () => {
    const trip = { _count: { routes: 2, roadtrips: 0 } } as unknown as Trip;
    expect(tripEntryCounts(trip, all).roadtrip).toBe(2);
  });

  it("falls back to _count.roadtrips when the payload has no routes", () => {
    const trip = { _count: { roadtrips: 3 } } as unknown as Trip;
    expect(tripEntryCounts(trip, all).roadtrip).toBe(3);
  });

  it("hides route sections when the roadtrip domain is not visible", () => {
    const trip = { _count: { flights: 1, routes: 2 } } as unknown as Trip;
    const counts = tripEntryCounts(trip, (d) => d !== "roadtrip");
    expect(counts.roadtrip).toBe(0);
    // The gate is narrow: the other areas still count.
    expect(tripEntryTotal(counts)).toBe(1);
  });

  it("leaves out an area the reader cannot see", () => {
    const trip = { _count: { flights: 1, railJourneys: 2 } } as unknown as Trip;
    const counts = tripEntryCounts(trip, (d) => d !== "rail");
    expect(tripEntryTotal(counts)).toBe(1);
  });

  it("falls back to the arrays when no _count came along", () => {
    const trip = { flights: [{}], railJourneys: [{}, {}] } as unknown as Trip;
    expect(tripEntryTotal(tripEntryCounts(trip, all))).toBe(3);
  });
});
