import type { JSX } from "react";

import { sketchPathThrough, sketchProjector } from "../../lib/roadtrip/roadtripView";

const W = 320;
const H = 120;

/**
 * The list's route sketch: the travelled line with the stations standing on
 * it, fitted into the card. Not a map — no land, no scale — but the SHAPE the
 * way actually took rather than chords between the stops, which is the shape a
 * reader recognises their trip by.
 *
 * `path` is the routed line and `points` the stations. Both go through ONE
 * projection: project them apart and the stations scale to their own bounds and
 * float off the line they are supposed to sit on. A roadtrip whose legs were
 * never routed arrives with no path and falls back to the stations alone, which
 * is what this drew before the path existed.
 *
 * A planned roadtrip draws dashed and fainter, the same mark the map gives what
 * has not happened yet.
 */
export default function RoadtripSketch({
  path,
  points,
  planned = false,
  height = H,
}: {
  path?: ReadonlyArray<readonly [number, number]>;
  points: ReadonlyArray<readonly [number, number]>;
  planned?: boolean;
  height?: number;
}): JSX.Element {
  const line = path && path.length >= 2 ? path : points;
  const project = line.length + points.length > 0 ? sketchProjector([...line, ...points], W, H) : null;
  const d = project ? sketchPathThrough(project, line) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      style={{ display: "block", background: "var(--ts-surface2)" }}
    >
      {d && (
        <path
          d={d}
          fill="none"
          stroke="var(--domain-roadtrip)"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={planned ? "6 5" : undefined}
          strokeOpacity={planned ? 0.7 : 1}
        />
      )}
      {project &&
        points.map((p, i) => {
          const [cx, cy] = project(p);
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={2.4}
              fill="var(--domain-roadtrip)"
              stroke="var(--ts-surface2)"
              strokeWidth={1.2}
            />
          );
        })}
    </svg>
  );
}
