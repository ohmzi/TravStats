/**
 * The shared first half of a scan (spec 2026-10-09 §C.1–C.2): fetch the padded
 * window from Immich, read the flights, put every asset on a clock and clean
 * the lot. The scan and the album retry both start here, so a retry rebuilds
 * the same asset list the scan showed.
 *
 * Impure only through `deps`; tests hand it fakes.
 */
import type { HomePeriod } from "../../utils/homeAirport";
import type { ImmichClient } from "../immich/immichClient";
import { cleanAssets } from "./clean";
import { areaZoneSpans, clockAssets } from "./clock";
import { homeAt } from "./home";
import type { ClockContext, CleanResult, Day, FlightAnchor, HomeAtDay, ScanWindow } from "./types";
import { scanWindow } from "./window";

export interface CollectDeps {
  immich: Pick<ImmichClient, "searchWindowAssets">;
  loadFlights(window: ScanWindow, targetTripId: string | null): Promise<FlightAnchor[]>;
  homePeriods: readonly HomePeriod[];
}

export interface CollectedWindow {
  window: ScanWindow;
  anchors: FlightAnchor[];
  clean: CleanResult;
  truncated: boolean;
  clock: ClockContext;
  homeAt: (day: Day) => HomeAtDay | null;
}

export async function collectWindow(
  deps: CollectDeps,
  input: {
    immichUserId: string;
    startDay: Day;
    endDay: Day;
    targetTripId: string | null;
    onPage?: (page: number, collected: number) => void;
  }
): Promise<CollectedWindow> {
  const window = scanWindow(input.startDay, input.endDay);
  const [page, anchors] = await Promise.all([
    deps.immich.searchWindowAssets(
      { takenAfter: window.fetchFrom, takenBefore: window.fetchTo },
      input.onPage
    ),
    deps.loadFlights(window, input.targetTripId),
  ]);
  // Immich leaves locked assets out of a search on its own. Dropping them here as well keeps a
  // private-folder photo out of the album list and the zone spans even if a server version ever
  // returns one; hidden Live Photo halves are `cleanAssets`' to count.
  const assets = page.assets.filter((asset) => asset.visibility !== "locked");
  const homeAtDay = (day: Day): HomeAtDay | null => homeAt(deps.homePeriods, day);
  const clock: ClockContext = {
    homeZone: homeAtDay(input.startDay)?.zone ?? null,
    areaZones: areaZoneSpans(assets, anchors),
  };
  const photos = clockAssets(assets, clock);
  // The exact departures gate the location carry (`carryLocations`): a GPS-less
  // photo after a take-off never takes a fix from before it.
  const clean = cleanAssets(photos, {
    ownerId: input.immichUserId,
    window,
    flightDeparturesMs: anchors.flatMap((anchor) => (anchor.depMs === null ? [] : [anchor.depMs])),
  });
  return { window, anchors, clean, truncated: page.truncated, clock, homeAt: homeAtDay };
}
