/**
 * What every Immich call shares: reading an untrusted payload field by field, and
 * turning whatever axios threw into the kinds the UI tells apart. Nothing here
 * knows a path or a payload shape of Immich itself; that stays in
 * `immichClient.ts` and `immichAlbums.ts`.
 */
import logger from "../../utils/logger";
import { ImmichError } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** How Immich words a 403 for an API key that lacks a scope. */
const MISSING_PERMISSION = /Missing required permission: (\S+)/;

function missingScopeOf(body: unknown): string | undefined {
  const message = isRecord(body) ? body.message : undefined;
  return typeof message === "string" ? MISSING_PERMISSION.exec(message)?.[1] : undefined;
}

/**
 * Normalise anything thrown by axios into the four kinds the UI distinguishes.
 * An unknown non-axios throw is a protocol error — we never leak a raw stack.
 */
export function toImmichError(error: unknown, context: string): ImmichError {
  if (error instanceof ImmichError) return error;

  if (isRecord(error) && error.isAxiosError === true) {
    const response = isRecord(error.response) ? error.response : undefined;
    const status = typeof response?.status === "number" ? response.status : undefined;

    if (status === 401 || status === 403) {
      // A key that is valid but lacks a scope is told apart from a bad key, so
      // the UI can say WHICH permission to add instead of "rejected".
      const missingScope = status === 403 ? missingScopeOf(response?.data) : undefined;
      if (missingScope) {
        return new ImmichError("auth", `Immich key lacks the ${missingScope} permission`, 403, {
          missingScope,
        });
      }
      return new ImmichError("auth", "Immich rejected the API key", status);
    }
    if (status === 404) {
      return new ImmichError("notFound", `Immich resource not found (${context})`, 404);
    }
    if (status === undefined || status >= 500) {
      return new ImmichError("unreachable", `Immich is unreachable (${context})`, status);
    }
    return new ImmichError("protocol", `Immich returned ${status} for ${context}`, status);
  }

  // Not an axios error at all — something genuinely unexpected (a programming
  // error, a thrown non-Error value, ...). The ImmichError we return keeps the
  // taxonomy the routes/UI depend on, but the original error and its stack
  // would otherwise vanish entirely, so log it here to keep the diagnostic
  // trail.
  logger.error({
    message: "immich_client_unexpected_error",
    error,
    context: { endpoint: context },
  });

  return new ImmichError("protocol", `Unexpected Immich failure (${context})`);
}
