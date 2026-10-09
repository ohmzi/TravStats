import { localMinuteOf, minutesOfDay, nightDayOf } from "../clock";

// Synthetic instants only (public repository): shifted years.

describe("localMinuteOf", () => {
  it("reads an instant on the place's clock, to the minute", () => {
    expect(localMinuteOf(Date.parse("2031-05-02T18:30:00Z"), "Pacific/Auckland")).toBe(
      "2031-05-03 06:30"
    );
  });

  it("drops the seconds instead of rounding them", () => {
    expect(localMinuteOf(Date.parse("2031-05-02T18:30:59Z"), "Pacific/Auckland")).toBe(
      "2031-05-03 06:30"
    );
  });

  it("puts one instant on three calendar days at the widest offsets on Earth", () => {
    const t = Date.parse("2031-05-01T10:30:00Z");
    expect(localMinuteOf(t, "Pacific/Kiritimati")).toBe("2031-05-02 00:30");
    expect(localMinuteOf(t, "UTC")).toBe("2031-05-01 10:30");
    expect(localMinuteOf(t, "Pacific/Pago_Pago")).toBe("2031-04-30 23:30");
  });

  it("follows a half-hour zone across its daylight change", () => {
    expect(localMinuteOf(Date.parse("2031-05-02T17:15:00Z"), "Australia/Adelaide")).toBe(
      "2031-05-03 02:45"
    );
    expect(localMinuteOf(Date.parse("2031-01-10T12:00:00Z"), "Australia/Adelaide")).toBe(
      "2031-01-10 22:30"
    );
  });
});

describe("nightDayOf", () => {
  it("gives a photo at 02:53 to the night before", () => {
    expect(nightDayOf("2031-05-03 02:53")).toBe("2031-05-02");
  });

  it("ends the night at 04:00", () => {
    expect(nightDayOf("2031-05-03 03:59")).toBe("2031-05-02");
    expect(nightDayOf("2031-05-03 04:00")).toBe("2031-05-03");
    expect(nightDayOf("2031-05-03 23:59")).toBe("2031-05-03");
  });

  it("steps back across a month end, a year end and a leap day on the calendar alone", () => {
    expect(nightDayOf("2031-06-01 01:00")).toBe("2031-05-31");
    expect(nightDayOf("2032-01-01 00:10")).toBe("2031-12-31");
    expect(nightDayOf("2032-03-01 00:30")).toBe("2032-02-29");
  });
});

describe("minutesOfDay", () => {
  it("counts the minutes since local midnight", () => {
    expect(minutesOfDay("2031-05-03 18:05")).toBe(1085);
    expect(minutesOfDay("2031-05-03 00:00")).toBe(0);
    expect(minutesOfDay("2031-05-03 23:59")).toBe(1439);
  });
});
