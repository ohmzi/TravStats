/**
 * `mapAssetDetail` is the trip builder's view of an Immich asset: the base
 * `ImmichAsset` plus the facts the clock model and the cleaner read. Every
 * added field is copied as Immich sent it, or null, so a missing EXIF row or an
 * odd value never turns into an invented one.
 */
import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { mapAssetDetail } from "../services/immich/immichClient";

// Synthetic fixture only (public repository): an invented photo in an invented town.
const RAW = {
  id: "0b6f2a4e-5c1d-4e8a-9f3b-7d2c1a0e9b8c",
  type: "IMAGE",
  ownerId: "a1f0c9d8-7b6a-4c5d-8e4f-3a2b1c0d9e8f",
  fileCreatedAt: "2031-05-03T02:07:09.000Z",
  fileModifiedAt: "2031-05-03T04:07:09+02:00",
  localDateTime: "2031-05-03T14:07:09.000Z",
  originalFileName: "IMG_0412.jpg",
  originalMimeType: "image/jpeg",
  visibility: "timeline",
  livePhotoVideoId: "5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a",
  duplicateId: null,
  isFavorite: true,
  exifInfo: {
    latitude: -45.05,
    longitude: 168.7,
    fileSizeInByte: 2048,
    timeZone: "Pacific/Auckland",
    city: "Northvale",
    state: "Westshire",
    country: "New Zealand",
    make: "Kestrel",
    model: "K1 Pro",
  },
};

describe("mapAssetDetail", () => {
  it("copies every field the trip builder reads, next to the base asset fields", () => {
    expect(mapAssetDetail(RAW)).toEqual({
      id: "0b6f2a4e-5c1d-4e8a-9f3b-7d2c1a0e9b8c",
      type: "IMAGE",
      fileCreatedAt: "2031-05-03T02:07:09.000Z",
      originalFileName: "IMG_0412.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      lat: -45.05,
      lon: 168.7,
      localDateTime: "2031-05-03T14:07:09",
      timeZone: "Pacific/Auckland",
      fileModifiedAt: "2031-05-03T02:07:09.000Z",
      city: "Northvale",
      state: "Westshire",
      country: "New Zealand",
      ownerId: "a1f0c9d8-7b6a-4c5d-8e4f-3a2b1c0d9e8f",
      visibility: "timeline",
      livePhotoVideoId: "5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a",
      duplicateId: null,
      make: "Kestrel",
      model: "K1 Pro",
      isFavorite: true,
    });
  });

  it("answers null, not an invented value, for every field Immich leaves out", () => {
    expect(
      mapAssetDetail({ id: "v1", type: "VIDEO", fileCreatedAt: "2031-05-03T02:07:09Z" })
    ).toEqual({
      id: "v1",
      type: "VIDEO",
      fileCreatedAt: "2031-05-03T02:07:09.000Z",
      originalFileName: "v1.bin",
      mimeType: "application/octet-stream",
      sizeBytes: null,
      lat: null,
      lon: null,
      localDateTime: null,
      timeZone: null,
      fileModifiedAt: null,
      city: null,
      state: null,
      country: null,
      ownerId: null,
      visibility: null,
      livePhotoVideoId: null,
      duplicateId: null,
      make: null,
      model: null,
      isFavorite: false,
    });
  });

  it.each([
    ["2031-05-03T14:07:09.000Z", "2031-05-03T14:07:09"],
    ["2031-05-03T14:07:09Z", "2031-05-03T14:07:09"],
    ["2031-05-03T14:07:09", "2031-05-03T14:07:09"],
    // A REAL offset is an instant, not Immich's fake-Z wall clock; reading it
    // as a wall clock would shift the photo by that offset, so it is refused.
    ["2031-05-03T14:07:09+02:00", null],
    ["14:07", null],
    [1234, null],
    [null, null],
    ["", null],
  ])("reads localDateTime %p as %p", (given, expected) => {
    expect(mapAssetDetail({ ...RAW, localDateTime: given })?.localDateTime).toBe(expected);
  });

  it.each([
    ["2031-05-03T04:07:09+02:00", "2031-05-03T02:07:09.000Z"],
    // No offset means no instant: the same rule fileCreatedAt follows.
    ["2031-05-03T04:07:09", null],
    ["not a time", null],
  ])("reads fileModifiedAt %p as %p", (given, expected) => {
    expect(mapAssetDetail({ ...RAW, fileModifiedAt: given })?.fileModifiedAt).toBe(expected);
  });

  it("accepts the four visibilities Immich has and nothing else", () => {
    for (const visibility of ["timeline", "archive", "hidden", "locked"]) {
      expect(mapAssetDetail({ ...RAW, visibility })?.visibility).toBe(visibility);
    }
    expect(mapAssetDetail({ ...RAW, visibility: "bogus" })?.visibility).toBeNull();
    expect(mapAssetDetail({ ...RAW, visibility: 3 })?.visibility).toBeNull();
  });

  it("turns an empty string into null for the free-text fields", () => {
    const mapped = mapAssetDetail({
      ...RAW,
      ownerId: "",
      exifInfo: {
        ...RAW.exifInfo,
        city: "",
        state: "",
        country: "",
        timeZone: "",
        make: "",
        model: "",
      },
    });
    expect(mapped).toMatchObject({
      ownerId: null,
      city: null,
      state: null,
      country: null,
      timeZone: null,
      make: null,
      model: null,
    });
  });

  it("is a favourite only when Immich says exactly true", () => {
    expect(mapAssetDetail({ ...RAW, isFavorite: true })?.isFavorite).toBe(true);
    expect(mapAssetDetail({ ...RAW, isFavorite: "true" })?.isFavorite).toBe(false);
    expect(mapAssetDetail({ ...RAW, isFavorite: undefined })?.isFavorite).toBe(false);
  });

  it("reads an asset with no EXIF row as having no place and no zone", () => {
    expect(mapAssetDetail({ ...RAW, exifInfo: undefined })).toMatchObject({
      lat: null,
      lon: null,
      timeZone: null,
      city: null,
      make: null,
    });
  });

  it("drops what is not a photo or a video, as mapAsset does", () => {
    expect(mapAssetDetail({ ...RAW, type: "AUDIO" })).toBeNull();
    expect(mapAssetDetail({ ...RAW, id: "" })).toBeNull();
    expect(mapAssetDetail(null)).toBeNull();
    expect(mapAssetDetail("asset")).toBeNull();
  });
});
