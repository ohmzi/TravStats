/**
 * Annotating a draft for an existing trip (spec 2026-10-09 §K.2).
 *
 * `buildDraftWith` derives the same areas, stations and nights it would for a new
 * trip; this reconciles them with what the trip holds and returns the draft with
 * every station marked (`status`, `existingId`, `before`), each leg that updates
 * a stored one showing that leg's own mode (with the scan's beside it), the
 * stored stations the photos do not show listed beside their area (`notSeen`),
 * the stored timeline stops no area matched (`notSeenStops`), and the album
 * section's re-sync preview.
 * An area matched to a stored roadtrip is shown under that roadtrip's own name,
 * so the review's Name field is the name the commit keeps or renames.
 * It also returns what it offered (`StoredExisting`, server-only), which the
 * commit holds the client to. A stopover the trip already holds is marked
 * `stored` — the review locks both switches on — and offered the same way, for
 * the commit to leave its roadtrip untouched (add-only v1, spec 2026-10-11 §6).
 */
import { deriveStationRows, type NightPlanStation } from "../../shared/tour/builderNightPlan";
import logger from "../../utils/logger";
import { previewAlbumSync, type AlbumResyncClient } from "./albumResync";
import {
  isSleptNight,
  type ExistingRoadtrip,
  type ExistingTripState,
  type StoredExisting,
  type StoredRoadtripOffer,
  type StoredStopoverOffer,
} from "./existingTypes";
import {
  groundSpan,
  reconcileTrip,
  type DerivedStation,
  type NotSeenStation,
  type ReconcileArea,
  type ReconciledStation,
  type StopArea,
} from "./reconcile";
import { claimKey, stationKeyOf } from "./stations";
import type {
  Day,
  DraftArea,
  DraftLeg,
  DraftStation,
  DraftStopover,
  TripBuilderDraft,
} from "./types";

export interface ExistingDeps {
  state: ExistingTripState;
  client: AlbumResyncClient;
  immichUserId: string;
}

/** The first row each station would store, under the draft's default night answers. */
function derivedStationsOf(
  area: DraftArea,
  nights: Readonly<Record<string, string>>
): DerivedStation[] {
  const planStations: NightPlanStation[] = area.stations.map((s) => ({
    key: s.key,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    firstDay: s.firstDay,
    lastDay: s.lastDay,
    notes: s.notes,
  }));
  const rows = deriveStationRows(planStations, nights);
  return area.stations.map((s) => {
    const row = rows.find((r) => r.key === s.key);
    return {
      key: s.key,
      title: s.title,
      titleSource: s.titleSource,
      lat: s.lat,
      lon: s.lon,
      startDate: row?.startDate ?? s.firstDay,
      endDate: row?.endDate ?? s.lastDay,
      slept: row?.slept ?? false,
    };
  });
}

function annotate(station: DraftStation, rec: ReconciledStation | undefined): DraftStation {
  if (rec === undefined) return station;
  if (rec.existing === undefined) return { ...station, status: "new" };
  return {
    ...station,
    title: rec.title,
    lat: rec.lat,
    lon: rec.lon,
    snappedKm: null,
    notes: rec.existing.notes,
    status: rec.status,
    existingId: rec.existing.id,
    before: rec.before,
  };
}

/**
 * The legs of a matched area. A leg both of whose stations are matched, and
 * whose stored pair is a stored leg, updates that leg in place: the commit
 * leaves a stored leg alone unless the reviewed mode differs (spec §K.4), so
 * `mode` becomes the stored mode — read as `road` unless it is exactly
 * `ferry`, the roadtrip editor's own reading (`LegDialog`) — and the scan's
 * derivation stays beside it as `derivedMode` for the review's changed pill.
 * Every other leg keeps the mode the scan built.
 */
function annotateLegs(
  area: DraftArea,
  derived: readonly ReconciledStation[],
  stored: ExistingRoadtrip | undefined
): DraftLeg[] {
  if (stored === undefined) return area.legs;
  return area.legs.map((leg, i) => {
    const from = derived[i]?.existing?.id;
    const to = derived[i + 1]?.existing?.id;
    if (from === undefined || to === undefined) return leg;
    const storedLeg = stored.legs.find((l) => l.fromStopId === from && l.toStopId === to);
    if (storedLeg === undefined) return leg;
    return {
      ...leg,
      mode: storedLeg.mode === "ferry" ? "ferry" : "road",
      derivedMode: leg.mode,
    };
  });
}

function notSeenStation(n: NotSeenStation, taken: Set<string>, fallbackDay: Day): DraftStation {
  const s = n.stored;
  const firstDay = s.startDate ?? s.endDate ?? fallbackDay;
  const lastDay = s.endDate ?? s.startDate ?? fallbackDay;
  return {
    key: claimKey(stationKeyOf(s.lat, s.lon, firstDay), taken),
    title: s.title,
    titleSource: "existing",
    kind: "visit",
    lat: s.lat,
    lon: s.lon,
    snappedKm: null,
    firstDay,
    lastDay,
    firstLocal: null,
    lastLocal: null,
    photoCount: 0,
    previewIdx: [],
    notes: s.notes,
    status: "notSeen",
    existingId: s.id,
    before: {
      startDate: s.startDate,
      endDate: s.endDate,
      slept: isSleptNight(s.night),
      stay: s.night === "stay",
    },
    notSeen: { defaultKeep: n.defaultKeep, reason: n.reason },
  };
}

/** The linked album under exactly this name and its member count; null when none is linked. */
function storedAlbumCount(state: ExistingTripState, name: string): number | null {
  return state.albums.find((album) => album.albumName === name)?.assetCount ?? null;
}

export function annotateDraftForExisting(
  dto: TripBuilderDraft,
  state: ExistingTripState
): { dto: TripBuilderDraft; existing: StoredExisting } {
  const assigns: Record<string, string> = Object.fromEntries(
    Object.entries(dto.nights).map(([day, entry]) => [day, entry.assign] as const)
  );
  const roadtripAreas: ReconcileArea[] = dto.areas
    .filter((a) => a.defaultAs === "roadtrip")
    .map((a) => ({
      key: a.key,
      kind: "roadtrip",
      name: a.suggestedName,
      stations: derivedStationsOf(a, assigns),
    }));
  const stopAreas: StopArea[] = dto.areas
    .filter((a) => a.defaultAs === "stops")
    .map((a) => ({ key: a.key, stations: a.stations }));

  const result = reconcileTrip({
    window: { startDay: dto.window.startDay, endDay: dto.window.endDay },
    roadtripAreas,
    stopAreas,
    // The claim runs over the tour's own span, not the stopover's single day: a
    // midnight-crossing tour spans two, and the commit writes exactly those spans
    // (final review, finding S1).
    stopovers: (dto.stopovers ?? []).map((stopover) => {
      const { startDate: dayFrom, endDate: dayTo } = groundSpan(stopover.stations);
      return { key: stopover.key, title: stopover.title, dayFrom, dayTo };
    }),
    state,
  });
  const matchByArea = new Map(result.roadtrips.map((m) => [m.areaKey, m] as const));

  const taken = new Set<string>(
    dto.areas.flatMap((a) => [
      ...a.stations.map((s) => s.key),
      ...(a.home.start.station ? [a.home.start.station.key] : []),
      ...(a.home.end.station ? [a.home.end.station.key] : []),
    ])
  );
  const offers = new Map<string, StoredRoadtripOffer>();
  const stopoverOffers = new Map<string, StoredStopoverOffer>();
  const matchByStopover = new Map(result.stopovers.map((match) => [match.key, match] as const));
  const annotatedStopovers = dto.stopovers?.map((stopover): DraftStopover => {
    const match = matchByStopover.get(stopover.key);
    if (match === undefined) return stopover;
    const roadtrip = state.roadtrips.find((r) => r.id === match.roadtripId);
    if (roadtrip === undefined) return stopover;
    stopoverOffers.set(match.roadtripId, {
      key: match.key,
      name: match.name,
      stationIds: new Set(
        roadtrip.stations.filter((station) => station.night !== "via").map((station) => station.id)
      ),
    });
    return {
      ...stopover,
      stored: {
        roadtripId: match.roadtripId,
        name: match.name,
        albumAssetCount: storedAlbumCount(state, stopover.title),
      },
    };
  });

  const areas = dto.areas.map((area): DraftArea => {
    if (area.defaultAs === "roadtrip") {
      const match = matchByArea.get(area.key);
      if (!match)
        return { ...area, stations: area.stations.map((s) => ({ ...s, status: "new" as const })) };
      offers.set(match.roadtripId, {
        areaKey: area.key,
        name: match.name,
        matchedIds: new Set(
          match.reconciled.derived.flatMap((d) => (d.existing ? [d.existing.id] : []))
        ),
        notSeenIds: new Set(match.reconciled.notSeen.map((n) => n.stored.id)),
      });
      return {
        ...area,
        // The area IS that stored roadtrip: show its own name, not the derivation for
        // a new one, so the review's Name field holds what the commit keeps or renames.
        suggestedName: match.name,
        roadtripId: match.roadtripId,
        stations: area.stations.map((s, i) => annotate(s, match.reconciled.derived[i])),
        legs: annotateLegs(
          area,
          match.reconciled.derived,
          state.roadtrips.find((r) => r.id === match.roadtripId)
        ),
        notSeen: match.reconciled.notSeen.map((n) => notSeenStation(n, taken, area.startDay)),
      };
    }
    const stop = result.stops.matched.get(area.key);
    return stop === undefined
      ? area
      : {
          ...area,
          stations: area.stations.map((s) => (s.key === stop.key ? annotate(s, stop) : s)),
        };
  });

  const matchedStopIds = new Set(
    [...result.stops.matched.values()].flatMap((rec) => (rec.existing ? [rec.existing.id] : []))
  );
  const flights = dto.flights.map((f) =>
    state.flightIds.includes(f.id) ? { ...f, locked: true, defaultAssign: true } : f
  );

  return {
    dto: {
      ...dto,
      areas,
      flights,
      notSeenStops: result.stops.notSeen.map((n) => notSeenStation(n, taken, dto.window.startDay)),
      ...(annotatedStopovers === undefined ? {} : { stopovers: annotatedStopovers }),
    },
    existing: {
      tripId: state.tripId,
      roadtrips: offers,
      stopovers: stopoverOffers,
      stops: {
        matchedIds: matchedStopIds,
        notSeenIds: new Set(result.stops.notSeen.map((n) => n.stored.id)),
      },
      album: null,
    },
  };
}

export interface AlbumScanFacts {
  windowAssetIds: readonly string[];
  contextIds: ReadonlySet<string>;
  fetchFrom: Date;
  fetchTo: Date;
}

/**
 * The scan's one entry into the re-sync: annotate the draft, then preview the
 * album update. An album that cannot be read is shown as unverified rather than
 * silently previewed as "nothing to do", and one the commit will not write —
 * absent, or blocked by the gate — carries no preview at all: a preview there
 * would offer an update the commit drops as a whole, removal switch included
 * (final review, finding N4-2).
 */
export async function applyExistingTarget(
  existing: ExistingDeps | null | undefined,
  album: AlbumScanFacts,
  dto: TripBuilderDraft
): Promise<{ dto: TripBuilderDraft; existing?: StoredExisting }> {
  if (!existing) return { dto };
  const annotated = annotateDraftForExisting(dto, existing.state);
  const draftAlbum = annotated.dto.album;
  if (!draftAlbum || draftAlbum.allowed === false) return annotated;
  try {
    const preview = await previewAlbumSync({
      client: existing.client,
      immichUserId: existing.immichUserId,
      links: existing.state.albums,
      tripName: existing.state.tripName,
      albumName: draftAlbum.name,
      ...album,
    });
    return {
      dto: { ...annotated.dto, album: { ...draftAlbum, sync: preview.sync } },
      existing: {
        ...annotated.existing,
        album: { immichAlbumId: preview.immichAlbumId, outsideIds: preview.outside },
      },
    };
  } catch (error) {
    logger.warn(
      {
        operation: "tripBuilder.existing.albumPreview",
        error: error instanceof Error ? error.message : String(error),
      },
      "The album could not be read for the re-sync preview"
    );
    return {
      dto: {
        ...annotated.dto,
        album: { ...draftAlbum, allowed: false, blockedReason: "unverified" },
      },
      existing: annotated.existing,
    };
  }
}
