/**
 * Synthetic builders for the trip builder's tests. The repository is public,
 * so nothing here is anyone's real trip. The places are invented (Northvale
 * and Port Carrow in Westshire) and sit in a real zone only so the clock has
 * one. The years are 2031 and later, and the owner ids are random v4 UUIDs.
 *
 * No `.test.ts` suffix: jest does not run it as a suite; tsc and eslint check it.
 */
import { addDays } from "../../../shared/tour/builderNightPlan";
import type { ImmichAssetDetail } from "../../immich/types";
import { NIGHT_BOUNDARY_H } from "../thresholds";
import type { FlightAnchor, PhotoFlags, PhotoPoint } from "../types";

/** The caller's Immich user. */
export const OWNER = "5b7e1c2a-3d4f-4a6b-9c8d-7e6f5a4b3c2d";
/** A partner whose library shows on the caller's timeline. */
export const PARTNER = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

/** Northvale, Westshire: Pacific/Auckland, UTC+12 in May. */
export const NORTHVALE = { lat: -45.05, lon: 168.7 } as const;
/** Port Carrow, about 50 km north-east of Northvale, in the same zone. */
export const PORT_CARROW = { lat: -44.7, lon: 169.15 } as const;
/** Pacific/Auckland's offset in May 2031 (NZST), in hours. */
export const NZST_H = 12;

const HOUR_MS = 3_600_000;

/** The instant a `YYYY-MM-DD HH:MM` wall clock names at a fixed offset, in hours east of UTC. */
export function msAt(local: string, offsetH: number): number {
  return Date.parse(`${local.replace(" ", "T")}:00Z`) - offsetH * HOUR_MS;
}

/** The flags `clockAssets` hands over for a case-A photo with GPS: every movement flag off. */
export const NO_FLAGS: PhotoFlags = {
  clockCase: "A",
  zoneSource: "gps",
  dayGuessed: false,
  exifZoneOverridden: false,
  located: false,
  duplicate: false,
  misdated: null,
  atSea: false,
  inFlight: false,
  layover: false,
};

export type PhotoInput = Partial<Omit<PhotoPoint, "flags">> & { flags?: Partial<PhotoFlags> };

/**
 * A photo after the clock and `cleanAssets`. By default it is the caller's own
 * iPhone shot at Northvale, located, at 12:00 NZST on 3 May 2031. When `tMs`,
 * `day` or `nightDay` is not given, it follows `local`, read at NZST.
 */
export function makePhoto(input: PhotoInput = {}): PhotoPoint {
  const { flags, ...over } = input;
  const local = over.local ?? "2031-05-03 12:00";
  const day = local.slice(0, 10);
  return {
    id: "p-1",
    type: "IMAGE",
    ownerId: OWNER,
    visibility: "timeline",
    tMs: msAt(local, NZST_H),
    zone: "Pacific/Auckland",
    local,
    day,
    nightDay: Number(local.slice(11, 13)) < NIGHT_BOUNDARY_H ? addDays(day, -1) : day,
    lat: NORTHVALE.lat,
    lon: NORTHVALE.lon,
    city: "Northvale",
    state: "Westshire",
    country: null,
    make: "Apple",
    model: "iPhone 14",
    originalFileName: "IMG_0001.HEIC",
    isFavorite: false,
    duplicateId: null,
    ...over,
    flags: { ...NO_FLAGS, located: true, ...flags },
  };
}

/** Saltmere: America/La_Paz, UTC−4 all year. */
export const SALTMERE = { lat: -16.52, lon: -68.12 } as const;

/**
 * An Immich asset as the client maps it (spec §B). By default it is the
 * caller's own iPhone photo with no zone and no GPS, whose `fileCreatedAt`
 * and `localDateTime` both read 12:00 on 3 May 2031. That is what Immich
 * stores for a naive camera clock.
 */
export function makeAsset(over: Partial<ImmichAssetDetail> = {}): ImmichAssetDetail {
  return {
    id: "a-1",
    type: "IMAGE",
    fileCreatedAt: "2031-05-03T12:00:00.000Z",
    originalFileName: "IMG_0001.HEIC",
    mimeType: "image/heic",
    sizeBytes: 2_000_000,
    lat: null,
    lon: null,
    localDateTime: "2031-05-03T12:00:00",
    timeZone: null,
    fileModifiedAt: null,
    city: null,
    state: null,
    country: null,
    ownerId: OWNER,
    visibility: "timeline",
    livePhotoVideoId: null,
    duplicateId: null,
    make: "Apple",
    model: "iPhone 14",
    isFavorite: false,
    ...over,
  };
}

/**
 * Flight ZZ101 from Northvale to Saltmere, precise, on no trip. It leaves at
 * 13:00 NZST on 4 May 2031 (01:00Z) and lands at 09:00 local the same day
 * (13:00Z).
 */
export function makeAnchor(over: Partial<FlightAnchor> = {}): FlightAnchor {
  return {
    id: "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b",
    label: "ZZ101 NVL→SLM",
    depIata: "NVL",
    arrIata: "SLM",
    dep: { ...NORTHVALE },
    arr: { ...SALTMERE },
    depZone: "Pacific/Auckland",
    arrZone: "America/La_Paz",
    depDay: "2031-05-04",
    arrDay: "2031-05-04",
    depClock: "13:00",
    arrClock: "09:00",
    precise: true,
    depMs: Date.parse("2031-05-04T01:00:00Z"),
    arrMs: Date.parse("2031-05-04T13:00:00Z"),
    hasActualDep: false,
    hasActualArr: false,
    tripId: null,
    tripName: null,
    listed: true,
    defaultAssign: true,
    locked: false,
    ...over,
  };
}
