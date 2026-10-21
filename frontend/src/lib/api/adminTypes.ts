import type { CountryTier } from "../../types/passport";

export interface InstanceSettings {
  instanceName: string;
  maxUsers: number;
  allowRegistration: boolean;
  /** Instance-wide gate for unfinished features — see config/betaFeatures.ts. */
  betaFeaturesEnabled: boolean;
  /** May the instance ask Open-Meteo, Wikipedia and OpenStreetMap for its users. */
  openDataEnabled: boolean;
  /** May operator logos come from Wikidata / Commons, server side (forgejo#323). On by default. */
  operatorLogosOpenDataEnabled: boolean;
  /** May users create public share links (forgejo#281). Off deletes every link. */
  shareLinksEnabled: boolean;
  frontendUrl: string | null;
  publicUrl: string | null;
  lanUrl: string | null;
  /** Bare domain a passkey is bound to — never a URL. Null until an admin sets it. */
  webauthnRpId: string | null;
  /** Full origins the browser may be on; the first is the primary. */
  webauthnOrigins: string[];
  // Geocoder base URLs — always resolved (DB > ENV > public default),
  // unlike the nullable URL fields above. See `resolveGeocoderUrls()`.
  photonUrl: string;
  nominatimUrl: string;
  /**
   * The instance's starting point for "a country counts as visited from …".
   * Any user may override it in their own settings; this is what applies until
   * they do. Always resolved — there is no "unset" state to handle.
   */
  countryThreshold: CountryTier;
  /** May the rail train lookup ask Transitous / db-rest (both on by default). */
  railTransitousEnabled: boolean;
  railDbRestEnabled: boolean;
  /** A self-hosted OpenRailRouting for rail lines; null = off. Absent before 2.7. */
  railRoutingUrl?: string | null;
}

/**
 * The OpenRailRouting test (`POST /admin/instance-settings/rail-routing/test`):
 * a stable code on failure, which the card maps to DE/EN copy.
 */
export type RailRoutingTestResult =
  | { ok: true; profile: string; dataDate: string | null }
  | { ok: false; code: "notConfigured" | "unreachable" | "notOpenRailRouting" | "profileMissing" };

/**
 * Whether the SAVED configuration actually yields working passkeys. Derived by
 * the server, never stored — the browser must not re-implement the
 * secure-context rule and drift from it.
 */
export interface PasskeyStatus {
  usable: boolean;
  reason: string | null;
}

/** Import mode (forgejo#304); `until` null = off. */
export interface ImportModeState {
  until: string | null;
  /** The one account covered; null = every account. */
  userId: string | null;
  /** How long one switch-on lasts. */
  hours: number;
}

export interface InstanceSettingsResponse {
  settings: InstanceSettings;
  passkeyStatus: PasskeyStatus;
}

export interface InstanceSettingsPatch {
  instanceName?: string;
  maxUsers?: number;
  allowRegistration?: boolean;
  betaFeaturesEnabled?: boolean;
  openDataEnabled?: boolean;
  operatorLogosOpenDataEnabled?: boolean;
  shareLinksEnabled?: boolean;
  frontendUrl?: string;
  publicUrl?: string;
  lanUrl?: string;
  webauthnRpId?: string;
  webauthnOrigins?: string[];
  // Empty string clears the DB override, reverting to ENV/default.
  photonUrl?: string;
  nominatimUrl?: string;
  countryThreshold?: CountryTier;
  railTransitousEnabled?: boolean;
  railDbRestEnabled?: boolean;
  /** "" switches OpenRailRouting off. */
  railRoutingUrl?: string;
}

/**
 * Who reads a booking document first — the same setting in all four domains
 * (backend `getParserOrder`). Default `template_first`, measured 2026-09-17.
 */
export type ParserOrder = "template_first" | "llm_first";

/**
 * Which protocol the instance's language model speaks (backend
 * `llm/llmProvider.ts`). beta.18: `openai_compatible` was renamed `custom`
 * (a free-form base URL — OpenRouter, Ollama Cloud, a LAN vLLM/LM Studio) and
 * three FIXED-endpoint named slots were added, each with its own key/model/
 * consent. There is no longer a single "active" kind on the admin settings —
 * `llmProvider.ts` resolves a FALLBACK CHAIN (Ollama first, then the
 * enabled+consented cloud slots in `llmProviderOrder`) — `kind` here still
 * names which protocol actually answered a given parse.
 */
export type LlmProviderKind = "ollama" | "openai" | "anthropic" | "google" | "custom";

/** The four cloud slots an admin may enable and order (Ollama is implicit, always first). */
export const CLOUD_PROVIDER_KINDS = ["openai", "anthropic", "google", "custom"] as const;
export type CloudProviderKind = (typeof CLOUD_PROVIDER_KINDS)[number];

export interface AdminParserSettingsResponse {
  allowUserApiKeys: boolean;
  fxCdnFallbackEnabled: boolean;
  /** Who reads a booking document first, in every domain. Absent on a
   *  backend older than 2.7 — treat a missing value as "template_first". */
  parserOrder?: ParserOrder;
  /** The "KI-Parser aus" switch; absent on a backend older than 2.7 (= on). */
  llmEnabled?: boolean;
  ollamaUrl: string | null;
  ollamaModel: string | null;
  /** Consent for a REMOTE Ollama only — the local/LAN case never needs this. */
  llmOllamaOptIn?: boolean;
  /** The admin's priority among the four cloud slots — always all four, in order. */
  llmProviderOrder?: CloudProviderKind[];

  /** The `custom` slot (beta.17's `openai_compatible`) — a free-form base URL. */
  openaiCompatBaseUrl?: string | null;
  openaiCompatModel?: string | null;
  /** Masked ("abcd****wxyz") or null — the key itself never leaves the server. */
  openaiCompatApiKey?: string | null;
  /** The SAVED endpoint is outside the local network. */
  openaiCompatIsCloud?: boolean;
  llmCustomOptIn?: boolean;

  /** OpenAI — fixed endpoint, key + model only. */
  llmOpenaiModel?: string | null;
  llmOpenaiApiKey?: string | null;
  llmOpenaiOptIn?: boolean;
  /** Anthropic — native Messages API, fixed endpoint, key + model only. */
  llmAnthropicModel?: string | null;
  llmAnthropicApiKey?: string | null;
  llmAnthropicOptIn?: boolean;
  /** Google — Gemini's own OpenAI-compatible endpoint, fixed, key + model only. */
  llmGoogleModel?: string | null;
  llmGoogleApiKey?: string | null;
  llmGoogleOptIn?: boolean;
}

/** Stable codes the admin page words itself (`test.errors.*`). */
export type LlmProviderTestErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_in_url"
  | "https_required"
  | "auth"
  | "unreachable";

export type LlmProviderTestResult =
  | { ok: true; isCloud: boolean; modelCount: number; modelFound: boolean | null }
  | {
      ok: false;
      errorCode: LlmProviderTestErrorCode;
      /** Protocol/status line for the log — never shown raw. */
      detail?: string | null;
      isCloud?: boolean;
    };

/**
 * One password-reset request waiting for an administrator (forgejo#88, point 2).
 * Only reachable with an admin session — see `routes/admin/passwordResetRequests.ts`.
 */
export interface PasswordResetRequest {
  id: string;
  userId: string;
  username: string;
  /** ISO 8601. */
  requestedAt: string;
}

/**
 * The admin map-download progress panel's read (owner request 2026-10-14):
 * `GET /admin/route-fetch`, which proxies the host's `osrm-autofetch`
 * `GET /status`. `configured` is false when no auto-fetch URL is set; when
 * configured, `reachable` is false if the service did not answer — the
 * endpoint never errors for that, so the panel has its own state for it.
 */
export interface RouteFetchJob {
  state: "queued" | "downloading" | "building" | "swapping" | "restoring";
  regions: string[];
  label: string;
  /** Epoch seconds. */
  startedAt: number;
  /** Absent until the service exposes an ETA on /status; absent = no ETA shown. */
  etaMinutes?: number | null;
}

/** How the last download/build ended. */
export interface RouteFetchLastResult {
  status: "built" | "failed";
  regions: string[];
  error?: string | null;
  /** Epoch seconds. */
  at: number;
}

export interface RouteFetchStatus {
  configured: boolean;
  reachable?: boolean;
  built?: string[];
  job?: RouteFetchJob | null;
  lastResult?: RouteFetchLastResult | null;
}
