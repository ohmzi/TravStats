import type { HomePeriod } from "../../../utils/homeAirport";
import type { ImmichAssetDetail } from "../../immich/types";
import type { Coord } from "../../tour/tourDistance";
import type { FlightAnchor } from "../types";

/** The caller's Immich user, and a partner who shares a library with them. */
export const ME = "0b6f3a52-5d1c-4f43-9c1e-6a7b8c9d0e1f";
export const PARTNER = "1c7a4b63-6e2d-4a54-8d2f-7b8c9d0e1f20";

/** Pacific/Auckland is UTC+12 from April to September; every fixture date falls in that span. */
const NZST_MS = 12 * 3_600_000;

export interface Place {
  lat: number;
  lon: number;
  city?: string;
  state?: string;
}

export const NORTHVALE: Place = { lat: -45.05, lon: 168.7, city: "Northvale", state: "Westshire" };
export const PORT_CARROW: Place = {
  lat: -44.7,
  lon: 169.15,
  city: "Port Carrow",
  state: "Westshire",
};
export const SELBY_BAY: Place = { lat: -44.2, lon: 169.95, city: "Selby Bay", state: "Westshire" };
/** Two points in the open water the fixture ferry crosses (see `countryAtFixture`). */
export const OPEN_WATER_A: Place = { lat: -44.4, lon: 169.6 };
export const OPEN_WATER_B: Place = { lat: -44.38, lon: 169.62 };

/** A country resolver for the fixtures: everything is "NZ" except one box of open water. */
export function countryAtFixture(lat: number, lon: number): string | null {
  const openWater = lat >= -44.5 && lat <= -44.3 && lon >= 169.5 && lon <= 169.7;
  return openWater ? null : "NZ";
}

export const at = (place: Place) => ({
  lat: place.lat,
  lon: place.lon,
  city: place.city ?? null,
  state: place.state ?? null,
});

export interface PhotoSpec {
  id: string;
  /** `YYYY-MM-DDTHH:MM` on the Pacific/Auckland wall clock. */
  local: string;
  lat: number | null;
  lon: number | null;
  city?: string | null;
  state?: string | null;
  ownerId?: string;
  type?: "IMAGE" | "VIDEO";
  visibility?: NonNullable<ImmichAssetDetail["visibility"]>;
}

/** An Immich asset whose zone is known (clock case A): `fileCreatedAt` is the real instant. */
export function nzAsset(spec: PhotoSpec): ImmichAssetDetail {
  const utcMs = Date.parse(`${spec.local}:00Z`) - NZST_MS;
  return {
    id: spec.id,
    type: spec.type ?? "IMAGE",
    fileCreatedAt: new Date(utcMs).toISOString(),
    originalFileName: `${spec.id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1_000_000,
    lat: spec.lat,
    lon: spec.lon,
    localDateTime: `${spec.local}:00`,
    timeZone: "Pacific/Auckland",
    fileModifiedAt: new Date(utcMs + 60_000).toISOString(),
    city: spec.city ?? null,
    state: spec.state ?? null,
    country: spec.city ? "New Zealand" : null,
    ownerId: spec.ownerId ?? ME,
    visibility: spec.visibility ?? "timeline",
    livePhotoVideoId: null,
    duplicateId: null,
    make: "Fixtureco",
    model: "Phone 1",
    isFavorite: false,
  };
}

/** One photo per entry of `locals`, all at `place`, with ids `<prefix>-1`, `<prefix>-2` … */
export function photosAt(
  prefix: string,
  place: Place,
  locals: readonly string[]
): ImmichAssetDetail[] {
  return locals.map((local, i) => nzAsset({ id: `${prefix}-${i + 1}`, local, ...at(place) }));
}

/** A residence in "Kelmore, Westshire" with one home airport, confirmed. */
export const HOME_PERIODS: HomePeriod[] = [
  {
    fromDate: "2020-01-01",
    toDate: null,
    residence: { name: "Kelmore, Westshire", lat: -45.6, lon: 169.3 },
    residenceConfirmed: true,
    airports: [{ code: "ZKM", primary: true }],
  },
];

export interface FlightSpec {
  id: string;
  label: string;
  depIata: string;
  arrIata: string;
  dep: Coord;
  arr: Coord;
  /** `YYYY-MM-DDTHH:MM` on the Pacific/Auckland clock, for both ends. */
  depLocal: string;
  arrLocal: string;
  tripId?: string | null;
  tripName?: string | null;
  listed?: boolean;
}

/** A flight with real UTC times at both ends (`precise`). */
export function preciseFlight(spec: FlightSpec): FlightAnchor {
  const tripId = spec.tripId ?? null;
  return {
    id: spec.id,
    label: spec.label,
    depIata: spec.depIata,
    arrIata: spec.arrIata,
    dep: spec.dep,
    arr: spec.arr,
    depZone: "Pacific/Auckland",
    arrZone: "Pacific/Auckland",
    depDay: spec.depLocal.slice(0, 10),
    arrDay: spec.arrLocal.slice(0, 10),
    depClock: spec.depLocal.slice(11, 16),
    arrClock: spec.arrLocal.slice(11, 16),
    precise: true,
    depMs: Date.parse(`${spec.depLocal}:00Z`) - NZST_MS,
    arrMs: Date.parse(`${spec.arrLocal}:00Z`) - NZST_MS,
    hasActualDep: false,
    hasActualArr: false,
    tripId,
    tripName: spec.tripName ?? null,
    listed: spec.listed ?? true,
    defaultAssign: tripId === null,
    locked: false,
  };
}
