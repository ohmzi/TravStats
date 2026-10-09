import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import CardMap, { type CardMapLine } from "../CardMap";

// MapLibre needs WebGL and tiles, which jsdom has neither of; what is under
// test here is the box's measuring and the SVG drawn over it.
vi.mock("react-map-gl/maplibre", () => ({ default: () => <div data-testid="basemap" /> }));

const LINES: CardMapLine[] = [
  {
    coords: [
      [11.79, 48.35],
      [12.65, 55.62],
    ],
  },
];

function viewBoxOf(container: HTMLElement): string | null {
  return container.querySelector("svg")?.getAttribute("viewBox") ?? null;
}

describe("CardMap", () => {
  let clientWidth: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws nothing until the box has a width to fit to", () => {
    clientWidth.mockReturnValue(0);
    const { container, queryByTestId } = render(<CardMap lines={LINES} />);

    expect(container.querySelector("svg")).toBeNull();
    expect(queryByTestId("basemap")).toBeNull();
  });

  it("measures once and still draws where the browser has no ResizeObserver", () => {
    // Old webviews, and jsdom: the effect used to throw out of `new
    // ResizeObserver`, and an uncaught error in an effect unmounts the tree.
    vi.stubGlobal("ResizeObserver", undefined);
    const { container, getByTestId } = render(<CardMap lines={LINES} height={120} />);

    expect(viewBoxOf(container)).toBe("0 0 300 120");
    expect(container.querySelector("polyline")).not.toBeNull();
    // jsdom has no IntersectionObserver either, so the basemap mounts at once.
    expect(getByTestId("basemap")).toBeTruthy();
  });

  it("refits when the box is resized, and stops watching when it unmounts", () => {
    let resized: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(): void {}
        disconnect = disconnect;
      }
    );
    const { container, unmount } = render(<CardMap lines={LINES} height={120} />);
    expect(viewBoxOf(container)).toBe("0 0 300 120");

    clientWidth.mockReturnValue(420);
    act(() => resized());
    expect(viewBoxOf(container)).toBe("0 0 420 120");

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("dots each stop on the point the line passes through", () => {
    const { container } = render(
      <CardMap lines={LINES} stops={LINES[0].coords.map((coord) => ({ coord }))} />
    );

    const points = container
      .querySelector("polyline")!
      .getAttribute("points")!
      .split(" ")
      .map((p) => p.split(",").map(Number));
    // The polyline's points are printed to a tenth of a pixel; the dots are not.
    const tenth = (v: string | null): number => Number(Number(v).toFixed(1));
    const dots = Array.from(container.querySelectorAll("circle")).map((c) => [
      tenth(c.getAttribute("cx")),
      tenth(c.getAttribute("cy")),
    ]);

    expect(dots).toEqual(points);
  });
});
