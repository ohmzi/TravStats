import { useCallback, useEffect, useRef, useState } from "react";
import { tripBuilderApi } from "../../../lib/api/tripBuilder";
import type { CreateTripInput } from "../../../lib/api/trips";
import { logger } from "../../../lib/logger";
import { scanWindowIssue, type ScanWindowIssue } from "../../../lib/tripBuilder/scanWindow";
import type { CapabilitiesDto } from "../../../types/tripBuilder";

/**
 * The create-trip popup's photo-scan state (spec 2026-10-09 §G), kept out of
 * `TripModal.tsx`, which has about 200 lines of room, and out of
 * `TripImmichOptions`, which unmounts with its tab: the verdict on the
 * account's Immich must outlive a visit to another tab, or the popup would
 * ask again each time it came back.
 */

/** The two switches. Both off: Save creates a plain trip. */
export interface ImmichScanOptions {
  inspect: boolean;
  createAlbum: boolean;
}

/**
 * Where the capability check stands. `ready` is kept for the life of the popup;
 * `unpaired` and `failed` are asked again on the next flip, because the answer
 * can change while the form is open (Immich connected in the other tab).
 */
export type ImmichCheck =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "failed" }
  | { phase: "unpaired" }
  | { phase: "ready"; caps: CapabilitiesDto };

const OFF: ImmichScanOptions = { inspect: false, createAlbum: false };

/** The switches a verdict allows: whatever it forbids is switched off again. */
function allowed(check: ImmichCheck, options: ImmichScanOptions): ImmichScanOptions {
  if (check.phase === "unpaired" || check.phase === "failed") return OFF;
  if (check.phase !== "ready") return options;
  const { inspect, album } = check.caps.immich;
  if (inspect.ok === false) return OFF;
  return album.canCreate === false ? { ...options, createAlbum: false } : options;
}

/** What `TripBuilderLauncher` is handed once Save is pressed with a switch on. */
export interface LaunchRequest {
  form: CreateTripInput;
  options: ImmichScanOptions;
  /** The scan did not start: the popup takes its form back. */
  onFailed: () => void;
}

export interface ImmichBuild {
  options: ImmichScanOptions;
  /** Turns one switch on or off. The first time one goes on, the account's capabilities are asked. */
  flip: (key: keyof ImmichScanOptions, on: boolean) => void;
  check: ImmichCheck;
  /** A switch is on: Save scans the photos instead of creating the trip. */
  scanning: boolean;
  /** Why the dates cannot be scanned; null while they can, and while no switch is on. */
  issue: ScanWindowIssue | null;
  /** Save must wait: the dates cannot be scanned, or the scan is already starting. */
  busy: boolean;
  /** Set between Save and the hand-off to the review page. */
  launchProps: LaunchRequest | null;
  launch: (form: CreateTripInput) => void;
}

/** `initialInspect` is the chooser's "from photos" route: that switch starts on. */
export function useImmichBuild(
  initialInspect: boolean,
  startDay: string,
  endDay: string
): ImmichBuild {
  const [options, setOptions] = useState<ImmichScanOptions>({
    inspect: initialInspect,
    createAlbum: false,
  });
  const [check, setCheck] = useState<ImmichCheck>({ phase: "idle" });
  const [form, setForm] = useState<CreateTripInput | null>(null);
  // The switches as they are NOW, for the revert that follows an await.
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  /** Asks the server once; a connected answer is kept, so later flips cost no request. */
  const ask = (): void => {
    if (check.phase === "ready" || pending.current) return;
    setCheck({ phase: "loading" });
    pending.current = tripBuilderApi
      .capabilities()
      .then(
        (caps): ImmichCheck =>
          caps.immich.configured ? { phase: "ready", caps } : { phase: "unpaired" },
        (err: unknown): ImmichCheck => {
          logger.warn("trip builder: the capability check failed", err);
          return { phase: "failed" };
        }
      )
      .then((next) => {
        pending.current = null;
        if (!mounted.current) return;
        setCheck(next);
        setOptions(allowed(next, latest.current));
      });
  };

  // A switch that starts on is its own first flip.
  useEffect(() => {
    mounted.current = true;
    if (options.inspect || options.createAlbum) ask();
    return () => {
      mounted.current = false;
    };
  }, []);

  const flip = (key: keyof ImmichScanOptions, on: boolean): void => {
    setOptions({ ...options, [key]: on });
    if (on) ask();
  };

  const cancel = useCallback(() => setForm(null), []);
  const scanning = options.inspect || options.createAlbum;
  const issue = scanning ? scanWindowIssue(startDay, endDay) : null;
  return {
    options,
    flip,
    check,
    scanning,
    issue,
    busy: issue !== null || form !== null,
    launchProps: form === null ? null : { form, options, onFailed: cancel },
    launch: setForm,
  };
}
