import { toInstant } from "../../../shared/time/instant";
import { inWindow, scanWindow, windowDays } from "../window";

// Synthetic dates only (public repository): shifted years.

describe("scanWindow", () => {
  const trip = scanWindow("2031-05-02", "2031-05-09");

  it("keeps S and E and names three context days either side", () => {
    expect(trip).toMatchObject({
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      contextFromDay: "2031-04-29",
      contextToDay: "2031-05-12",
    });
  });

  it("fetches from S 00:00Z − 3 d − 14 h to (E+1) 00:00Z + 3 d + 12 h", () => {
    expect(trip.fetchFrom.toISOString()).toBe("2031-04-28T10:00:00.000Z");
    expect(trip.fetchTo.toISOString()).toBe("2031-05-13T12:00:00.000Z");
  });

  it("starts exactly at midnight of the first context day at UTC+14", () => {
    const midnight = toInstant("2031-04-29T00:00", "Pacific/Kiritimati").utc;
    expect(trip.fetchFrom.getTime()).toBe(midnight.getTime());
  });

  it("ends one minute after the last minute of the last context day at UTC−12", () => {
    const lastMinute = toInstant("2031-05-12T23:59", "Etc/GMT+12").utc;
    expect(trip.fetchTo.getTime() - lastMinute.getTime()).toBe(60_000);
  });

  it("crosses a year end and a leap day on the calendar alone", () => {
    const yearEnd = scanWindow("2031-12-30", "2032-01-02");
    expect(yearEnd).toMatchObject({ contextFromDay: "2031-12-27", contextToDay: "2032-01-05" });
    expect(yearEnd.fetchFrom.toISOString()).toBe("2031-12-26T10:00:00.000Z");
    expect(yearEnd.fetchTo.toISOString()).toBe("2032-01-06T12:00:00.000Z");
    expect(scanWindow("2032-03-02", "2032-03-02").contextFromDay).toBe("2032-02-28");
  });
});

describe("inWindow", () => {
  const trip = scanWindow("2031-05-02", "2031-05-09");

  it("holds S and E themselves and nothing either side", () => {
    expect(inWindow("2031-05-02", trip)).toBe(true);
    expect(inWindow("2031-05-09", trip)).toBe(true);
    expect(inWindow("2031-05-01", trip)).toBe(false);
    expect(inWindow("2031-05-10", trip)).toBe(false);
  });
});

describe("windowDays", () => {
  it("lists every day S … E across a month end", () => {
    expect(windowDays(scanWindow("2031-05-30", "2031-06-02"))).toEqual([
      "2031-05-30",
      "2031-05-31",
      "2031-06-01",
      "2031-06-02",
    ]);
  });

  it("has one day for a one-day trip", () => {
    expect(windowDays(scanWindow("2031-05-02", "2031-05-02"))).toEqual(["2031-05-02"]);
  });
});
