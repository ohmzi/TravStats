import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobeTimeStrip } from "../GlobeTimeStrip";
import { useTimeSliderStore } from "../../../store/timeSliderStore";
import { PHONE_STRIP_TOP } from "../../map/phoneChrome";
import type { MonthBucket } from "../timeSliderUtils";

/**
 * The activity strip's phone row (2026-10-12 collision 1, measured in Chrome
 * at 390×844): the strip's 300px minimum width, centred, started at x=45 — on
 * top of the Aktivität chip — and ended at x=345, under the "+ Hinzufügen"
 * button whose label starts around x=250. Position and width are the whole
 * fix, so this suite pins both, plus the clamp that keeps the strip inside
 * the row it now owns (`PHONE_STRIP_HEIGHT`): on a phone it may not grow into
 * the expanded bar row or draw the year axis.
 *
 * jsdom has no layout engine: what is asserted is the placement the layout
 * READS (classes, inline styles, which children render), never a measured
 * rectangle. The breakpoint is forced through `window.matchMedia`, the same
 * way DomainFilterButton.test.tsx forces its phone sheet.
 *
 * Deliberate-break protocol: drop `phone` from the wrapper's className/style
 * in GlobeTimeStrip.tsx and the two placement cases fail; drop the
 * `expanded && !phone` guard on the bars in GlobeTimeHistogram.tsx and the
 * "does not grow" case fails.
 */

const BUCKETS: MonthBucket[] = [
  { start: new Date(Date.UTC(2023, 4, 1)), flights: 3, cruises: 1 },
  { start: new Date(Date.UTC(2024, 4, 1)), flights: 5, cruises: 0 },
];

/** Forces `useIsPhoneViewport` (max-width: 639px) one way or the other. */
function setViewport(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderStrip(): ReturnType<typeof render> {
  return render(<GlobeTimeStrip buckets={BUCKETS} visibleFlights={8} visibleCruises={1} />);
}

beforeEach(() => {
  // The strip only draws its controls once a range exists; without one it
  // renders the "keine datierten Reisen" pill.
  useTimeSliderStore.setState({
    mode: "off",
    rangeMin: BUCKETS[0].start,
    rangeMax: BUCKETS[1].start,
    currentDate: null,
    isPlaying: false,
    filterStart: null,
    filterEnd: null,
  });
});

afterEach(() => {
  setViewport(false);
});

describe("GlobeTimeStrip placement", () => {
  it("centres at the top on a desktop, as it always has", () => {
    setViewport(false);
    const { container } = renderStrip();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("top-3");
    expect(wrapper.className).toContain("left-1/2");
    expect(wrapper.className).toContain("-translate-x-1/2");
    expect(wrapper.style.left).toBe("");
  });

  it("takes its own full-width row on a phone, under the Aktivität/+Add row", () => {
    setViewport(true);
    const { container } = renderStrip();
    const wrapper = container.firstElementChild as HTMLElement;
    // No centring transform, and pinned to both edges — full width, so the
    // chip on the left and the + Add button on the right have their edges.
    expect(wrapper.className).not.toContain("-translate-x-1/2");
    expect(wrapper.className).not.toContain("top-3");
    expect(wrapper.style.left).toBe("12px");
    expect(wrapper.style.right).toBe("12px");
    expect(wrapper.style.top).toBe(`${PHONE_STRIP_TOP}px`);
  });

  it("drops the 300/460px minimum width on a phone so it fits the row", () => {
    setViewport(true);
    const { container } = renderStrip();
    const strip = container.querySelector(".rounded-xl") as HTMLElement;
    expect(strip.style.minWidth).toBe("0");
    expect(strip.style.maxWidth).toBe("100%");
  });
});

describe("the strip stays inside the row it owns", () => {
  it("keeps the collapsed bar height and drops the counts on a phone", () => {
    setViewport(true);
    const { container } = renderStrip();
    const bars = container.querySelector(".cursor-crosshair") as HTMLElement;
    expect(bars.style.height).toBe("22px");
    // The readout's "· 8 Flüge · 1 Kreuzfahrten" would overflow the 336px row
    // beside the play button; the date is what a phone reader needs there.
    expect(screen.queryByText(/Kreuzfahrten/)).toBeNull();
  });

  it("does not grow the bars to the desktop expanded height on a phone", () => {
    setViewport(true);
    const { container } = renderStrip();
    fireEvent.pointerOver(container.querySelector(".rounded-xl") as HTMLElement);
    const bars = container.querySelector(".cursor-crosshair") as HTMLElement;
    // Expanded (play + readout) — the strip is still inside its band.
    expect(screen.getByLabelText(/timeSlider\.(play|pause)/)).toBeTruthy();
    expect(bars.style.height).toBe("22px");
  });

  it("still grows and draws the year axis on a desktop", () => {
    setViewport(false);
    const { container } = renderStrip();
    fireEvent.pointerOver(container.querySelector(".rounded-xl") as HTMLElement);
    const bars = container.querySelector(".cursor-crosshair") as HTMLElement;
    expect(bars.style.height).toBe("64px");
    expect(screen.getByText("2023")).toBeTruthy();
  });
});
