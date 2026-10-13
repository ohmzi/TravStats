import { useEffect, useState } from "react";
import { immichApi } from "../lib/api/immich";

/**
 * The owner-configured, browser-reachable Immich address, or null.
 *
 * The Immich CONNECTION's base URL is deliberately the internal one (e.g.
 * `http://immich_server:2283` inside Docker) — right for the backend, dead for
 * a browser, and the standing rule is that it is never emitted into a link.
 * "Open in Immich" therefore needs an address only the operator can name; it
 * arrives as `webUrl` on the Immich settings and is never guessed from the
 * connection. Until the backend has one to send, the link simply stays hidden.
 *
 * Only `http(s)` survives: the value goes straight into an `href`, and a
 * stored `javascript:` URL must never become one (see the test that pins it).
 */
export function normalizeImmichWebUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Origin + sub-path only: query and fragment of a settings value are not the
  // address of anything, and credentials in it would be one more leak surface.
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/**
 * `enabled` gates the read: only a live album asset can ever show the link, so
 * an uploads-only gallery never asks for the settings.
 */
export function useImmichWebUrl(enabled: boolean): string | null {
  const [webUrl, setWebUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void immichApi
      .getSettings()
      .then((settings) => {
        if (!cancelled) setWebUrl(normalizeImmichWebUrl(settings.webUrl));
      })
      .catch(() => {
        // A settings read that fails costs the link, not the viewer: the photo
        // still opens, and the viewer is not the place to report this.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return webUrl;
}
