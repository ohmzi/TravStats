import { dayMonthLabel, roadtripAreaNames } from "../builderNightPlan";

// Synthetic fixtures only (public repository): invented places, shifted years.
const NORTHVALE = { key: "2031-05-02#1", mainCity: "Northvale", startDay: "2031-05-02" };
const SOUTHBRIDGE = { key: "2031-05-05#1", mainCity: "Southbridge", startDay: "2031-05-05" };

describe("dayMonthLabel", () => {
  it("writes the day of the month and an English short month", () => {
    expect(dayMonthLabel("2031-05-02")).toBe("2 May");
    expect(dayMonthLabel("2031-12-31")).toBe("31 Dec");
    expect(dayMonthLabel("2032-02-29")).toBe("29 Feb");
  });
});

describe("roadtripAreaNames", () => {
  it("names nothing when no area becomes a roadtrip", () => {
    expect(roadtripAreaNames([], "Southern loop", new Set())).toEqual({});
  });

  it("gives a single area exactly the trip's name", () => {
    expect(roadtripAreaNames([NORTHVALE], "Southern loop", new Set())).toEqual({
      "2031-05-02#1": "Southern loop",
    });
  });

  it("uses the city form for a single area when the trip already holds a roadtrip of that name", () => {
    const taken = new Set(["Southern loop"]);
    expect(roadtripAreaNames([NORTHVALE], "Southern loop", taken)).toEqual({
      "2031-05-02#1": "Southern loop · Northvale",
    });
  });

  it("names several areas after their main city", () => {
    expect(roadtripAreaNames([NORTHVALE, SOUTHBRIDGE], "Southern loop", new Set())).toEqual({
      "2031-05-02#1": "Southern loop · Northvale",
      "2031-05-05#1": "Southern loop · Southbridge",
    });
  });

  it("falls back to the trip's name for an area with no main city", () => {
    const nameless = { key: "2031-05-05#1", mainCity: null, startDay: "2031-05-05" };
    expect(roadtripAreaNames([NORTHVALE, nameless], "Southern loop", new Set())).toEqual({
      "2031-05-02#1": "Southern loop · Northvale",
      "2031-05-05#1": "Southern loop · Southern loop",
    });
  });

  it("tells two areas of one city apart by their first day", () => {
    const again = { key: "2031-05-09#1", mainCity: "Northvale", startDay: "2031-05-09" };
    expect(roadtripAreaNames([NORTHVALE, again], "Southern loop", new Set())).toEqual({
      "2031-05-02#1": "Southern loop · Northvale (2 May)",
      "2031-05-09#1": "Southern loop · Northvale (9 May)",
    });
  });

  it("tells an area from a roadtrip that is already named so", () => {
    const taken = new Set(["Southern loop · Northvale"]);
    expect(roadtripAreaNames([NORTHVALE, SOUTHBRIDGE], "Southern loop", taken)).toEqual({
      "2031-05-02#1": "Southern loop · Northvale (2 May)",
      "2031-05-05#1": "Southern loop · Southbridge",
    });
  });

  it("does not hand out a date-form name the trip already holds", () => {
    const again = { key: "2031-05-09#1", mainCity: "Northvale", startDay: "2031-05-09" };
    const taken = new Set(["Southern loop · Northvale (2 May)"]);
    expect(roadtripAreaNames([NORTHVALE, again], "Southern loop", taken)).toEqual({
      "2031-05-02#1": "Southern loop · Northvale (2 May) 2",
      "2031-05-09#1": "Southern loop · Northvale (9 May)",
    });
  });

  it("does not hand out a numbered name the trip already holds", () => {
    const twin = { key: "2031-05-02#2", mainCity: "Northvale", startDay: "2031-05-02" };
    const taken = new Set(["Southern loop · Northvale (2 May) 2"]);
    expect(roadtripAreaNames([NORTHVALE, twin], "Southern loop", taken)).toEqual({
      "2031-05-02#1": "Southern loop · Northvale (2 May)",
      "2031-05-02#2": "Southern loop · Northvale (2 May) 3",
    });
  });

  it("numbers two areas of one city that start on the same day", () => {
    const twin = { key: "2031-05-02#2", mainCity: "Northvale", startDay: "2031-05-02" };
    expect(roadtripAreaNames([NORTHVALE, twin], "Southern loop", new Set())).toEqual({
      "2031-05-02#1": "Southern loop · Northvale (2 May)",
      "2031-05-02#2": "Southern loop · Northvale (2 May) 2",
    });
  });
});
