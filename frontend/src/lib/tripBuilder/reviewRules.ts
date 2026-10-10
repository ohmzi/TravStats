/**
 * Facts about the review state that every edit needs (spec §G): where a station
 * is, the days an area covers, the limits the commit schema sets, the names
 * that follow the trip's name. Pure.
 */
import { roadtripAreaNames } from "../../shared/tour/builderNightPlan";
import type { Day, TripBuilderDraft } from "../../types/tripBuilder";
import type { ReviewArea, ReviewState } from "./draftEdits";

/** What the commit schema allows: a title or name, a note, and the countries of a trip. */
export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 5000;
export const MAX_COUNTRIES = 60;

/** Where a station sits: its area's index and its own index in that area. */
export function locate(
  areas: readonly ReviewArea[],
  stationKey: string
): { a: number; i: number } | null {
  for (let a = 0; a < areas.length; a++) {
    const i = areas[a].stations.findIndex((station) => station.key === stationKey);
    if (i >= 0) return { a, i };
  }
  return null;
}

/** The days the scan gave an area; the days of its stations when the draft does not know it. */
export function spanOf(
  draft: TripBuilderDraft,
  area: Pick<ReviewArea, "key" | "stations">
): { startDay: Day; endDay: Day } {
  const offered = draft.areas.find((candidate) => candidate.key === area.key);
  if (offered) return { startDay: offered.startDay, endDay: offered.endDay };
  const days = area.stations.flatMap((station) => [station.firstDay, station.lastDay]).sort();
  return {
    startDay: days[0] ?? draft.window.startDay,
    endDay: days[days.length - 1] ?? draft.window.endDay,
  };
}

/** The area with its home flags and leg modes read again from its stations and legs. */
export function syncArea(area: ReviewArea): ReviewArea {
  const last = area.stations[area.stations.length - 1];
  return {
    ...area,
    homeStart: area.stations[0]?.kind === "home",
    homeEnd: last?.kind === "home",
    legModes: area.legs.map((leg) => leg.mode),
  };
}

/**
 * Area names that follow the trip name and the number of roadtrips, for every
 * area the user has not named themselves. The names the scan gave are kept for
 * everything else (an area that is not a roadtrip has no name of its own).
 */
export function withSuggestedNames(draft: TripBuilderDraft, state: ReviewState): ReviewState {
  const tripName = state.tripName.trim();
  if (tripName === "") return state;
  const names = roadtripAreaNames(
    state.areas
      .filter((area) => area.as === "roadtrip")
      .map((area) => {
        const offered = draft.areas.find((candidate) => candidate.key === area.key);
        return {
          key: area.key,
          mainCity: offered?.mainCity ?? null,
          startDay: offered?.startDay ?? draft.window.startDay,
        };
      }),
    tripName,
    new Set()
  );
  return {
    ...state,
    areas: state.areas.map((area) =>
      area.as === "roadtrip" && !area.nameEdited && names[area.key] !== undefined
        ? { ...area, name: names[area.key] }
        : area
    ),
  };
}
