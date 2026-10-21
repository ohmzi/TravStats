import { api } from "./client";
import type {
  ApiKeyTestResponse,
  ExportAllDataResponse,
  MessageResponse,
  SmtpConfigInput,
  SmtpConfigResponse,
} from "./types";
import type { RoutingProviderId } from "../../types/tour";
import type {
  LogCleanupResult,
  LogFilesResponse,
  LoggingConfigResponse,
  LogReadResponse,
  LogStatsResponse,
} from "../../shared/logContract";
import type {
  AdminParserSettingsResponse,
  CloudProviderKind,
  ImportModeState,
  InstanceSettingsPatch,
  InstanceSettingsResponse,
  LlmProviderTestResult,
  ParserOrder,
  PasswordResetRequest,
  RailRoutingTestResult,
  RouteFetchStatus,
} from "./adminTypes";

export * from "./adminTypes";

export const adminApi = {
  /**
   * The open password-reset requests.
   *
   * Every caller must be prepared for a 403: the inbox is a normal user's page
   * too, and only the admin half of it may ask for this list.
   */
  getPasswordResetRequests: async (): Promise<{
    requests: PasswordResetRequest[];
    count: number;
  }> => {
    const { data } = await api.get<{ requests: PasswordResetRequest[]; count: number }>(
      "/admin/password-reset-requests"
    );
    return data;
  },

  /** "I have dealt with this" — stamps the request, it leaves the list. */
  markPasswordResetRequestHandled: async (
    id: string
  ): Promise<{ id: string; handledAt: string }> => {
    const { data } = await api.post<{ id: string; handledAt: string }>(
      `/admin/password-reset-requests/${id}/handled`
    );
    return data;
  },

  getSystemInfo: async (): Promise<{
    instanceName: string;
    userCount: number;
    activeUserCount: number;
    flightCount: number;
    maxUsers: number;
    warningThreshold: boolean;
    registrationEnabled: boolean;
    version: string;
    buildVersion: string;
  }> => {
    const { data } = await api.get<{
      instanceName: string;
      userCount: number;
      activeUserCount: number;
      flightCount: number;
      maxUsers: number;
      warningThreshold: boolean;
      registrationEnabled: boolean;
      version: string;
      buildVersion: string;
    }>("/admin/system/info");
    return data;
  },

  getUsers: async (): Promise<{
    users: Array<{
      id: string;
      username: string;
      isAdmin: boolean;
      isActive: boolean;
      invitedBy?: string;
      createdAt: string;
      twoFactorEnabledAt: string | null;
      _count: {
        flights: number;
        userAchievements: number;
      };
    }>;
  }> => {
    const { data } = await api.get<{
      users: Array<{
        id: string;
        username: string;
        isAdmin: boolean;
        isActive: boolean;
        invitedBy?: string;
        createdAt: string;
        twoFactorEnabledAt: string | null;
        _count: {
          flights: number;
          userAchievements: number;
        };
      }>;
    }>("/admin/users");
    return data;
  },

  toggleUserActive: async (
    userId: string
  ): Promise<{
    user: {
      id: string;
      username: string;
      isAdmin: boolean;
      isActive: boolean;
    };
  }> => {
    const { data } = await api.patch<{
      user: {
        id: string;
        username: string;
        isAdmin: boolean;
        isActive: boolean;
      };
    }>(`/admin/users/${userId}/toggle-active`);
    return data;
  },

  /** The way back in for a user who lost both phone and recovery codes. */
  disableUserTwoFactor: async (userId: string): Promise<{ disabled: boolean }> => {
    const { data } = await api.post<{ disabled: boolean }>(`/admin/users/${userId}/disable-2fa`);
    return data;
  },

  deleteUser: async (userId: string): Promise<{ message: string; userId: string }> => {
    const { data } = await api.delete<{ message: string; userId: string }>(
      `/admin/users/${userId}`
    );
    return data;
  },

  createLinkInvitation: async (
    expiresInDays: 1 | 7 | 30 = 7
  ): Promise<{
    invitation: { id: string; email: string | null; token: string; expiresAt: string };
    inviteUrl: string;
  }> => {
    const { data } = await api.post<{
      invitation: { id: string; email: string | null; token: string; expiresAt: string };
      inviteUrl: string;
    }>("/admin/invitations", { expiresInDays });
    return data;
  },

  createEmailInvitation: async (
    email: string,
    expiresInDays: 1 | 7 | 30 = 7
  ): Promise<{
    invitation: { id: string; email: string | null; token: string; expiresAt: string };
    inviteUrl: string;
    emailSent: boolean;
    emailError: string | null;
  }> => {
    const { data } = await api.post<{
      invitation: { id: string; email: string | null; token: string; expiresAt: string };
      inviteUrl: string;
      emailSent: boolean;
      emailError: string | null;
    }>("/admin/invitations/email", { email, expiresInDays });
    return data;
  },

  resendInvitationEmail: async (
    id: string
  ): Promise<{ emailSent: boolean; emailError: string | null }> => {
    const { data } = await api.post<{ emailSent: boolean; emailError: string | null }>(
      `/admin/invitations/${id}/resend`
    );
    return data;
  },

  revokeInvitation: async (id: string): Promise<{ success: true }> => {
    const { data } = await api.delete<{ success: true }>(`/admin/invitations/${id}`);
    return data;
  },

  getInvitations: async (
    status: "all" | "active" | "used" | "expired" = "active"
  ): Promise<{
    invitations: Array<{
      id: string;
      email: string | null;
      token: string;
      expiresAt: string;
      usedAt: string | null;
      createdAt: string;
      emailStatus: string | null;
      emailError: string | null;
      emailSentAt: string | null;
      creator: { username: string };
      user: { username: string } | null;
    }>;
  }> => {
    const { data } = await api.get<{
      invitations: Array<{
        id: string;
        email: string | null;
        token: string;
        expiresAt: string;
        usedAt: string | null;
        createdAt: string;
        emailStatus: string | null;
        emailError: string | null;
        emailSentAt: string | null;
        creator: { username: string };
        user: { username: string } | null;
      }>;
    }>("/admin/invitations", { params: { status } });
    return data;
  },

  exportAllData: async (): Promise<ExportAllDataResponse> => {
    const { data } = await api.get<ExportAllDataResponse>("/admin/export/all-data");
    return data;
  },

  getAdminParserSettings: async (): Promise<AdminParserSettingsResponse> => {
    const { data } = await api.get<AdminParserSettingsResponse>("/admin/parser-settings");
    return data;
  },

  updateAdminParserSettings: async (settings: {
    allowUserApiKeys?: boolean;
    fxCdnFallbackEnabled?: boolean;
    parserOrder?: ParserOrder;
    llmEnabled?: boolean;
    ollamaUrl?: string | null;
    ollamaModel?: string | null;
    llmOllamaOptIn?: boolean;
    llmProviderOrder?: CloudProviderKind[];
    openaiCompatBaseUrl?: string | null;
    openaiCompatModel?: string | null;
    /** The masked echo from the GET keeps the stored key; "" / null clears it. */
    openaiCompatApiKey?: string | null;
    llmCustomOptIn?: boolean;
    llmOpenaiApiKey?: string | null;
    llmOpenaiModel?: string | null;
    llmOpenaiOptIn?: boolean;
    llmAnthropicApiKey?: string | null;
    llmAnthropicModel?: string | null;
    llmAnthropicOptIn?: boolean;
    llmGoogleApiKey?: string | null;
    llmGoogleModel?: string | null;
    llmGoogleOptIn?: boolean;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/parser-settings", settings);
    return data;
  },

  /**
   * "Verbindung testen" for a cloud slot — sends only the key, no document.
   * `openai`/`anthropic`/`google` use their fixed base URL server-side;
   * `baseUrl` is only read (and required) for `kind: "custom"`.
   */
  testLlmProvider: async (input: {
    kind: CloudProviderKind;
    baseUrl?: string | null;
    model: string | null;
    apiKey: string | null;
  }): Promise<LlmProviderTestResult> => {
    const { data } = await api.post<LlmProviderTestResult>("/admin/test-llm-provider", input);
    return data;
  },

  testOllamaConnection: async (
    ollamaUrl: string,
    ollamaModel: string
  ): Promise<{
    success: boolean;
    models?: string[];
    warning?: string | null;
    error?: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      models?: string[];
      warning?: string | null;
      error?: string;
    }>("/admin/test-ollama", { ollamaUrl, ollamaModel });
    return data;
  },

  listOllamaModels: async (
    ollamaUrl: string
  ): Promise<{
    success: boolean;
    models?: Array<{ name: string; size: number; modified: string }>;
    error?: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      models?: Array<{ name: string; size: number; modified: string }>;
      error?: string;
    }>("/admin/ollama-models", { ollamaUrl });
    return data;
  },

  pullOllamaModel: async (
    ollamaUrl: string,
    modelName: string
  ): Promise<{ success: boolean; status?: string; error?: string }> => {
    const { data } = await api.post<{
      success: boolean;
      status?: string;
      error?: string;
    }>("/admin/ollama-pull", { ollamaUrl, modelName });
    return data;
  },

  getGlobalApiKeys: async (): Promise<{
    globalAirlabsApiKey?: string;
    globalAviationstackApiKey?: string;
    globalAerodataboxApiKey?: string;
    globalAeroapiApiKey?: string;
    globalLogostreamApiKey?: string;
    globalOpenskyClientId?: string;
    globalOpenskyClientSecret?: string;
    globalOpenskyUsername?: string;
    globalOpenskyPassword?: string;
    // Tour routing provider (Phase 3): the global key each of the two
    // key-based providers falls back to when a user has none of their own,
    // and which provider/custom URL is active for the whole instance.
    globalOpenrouteserviceApiKey?: string;
    globalGraphhopperApiKey?: string;
    routingProvider: RoutingProviderId | null;
    routingCustomUrl: string | null;
    routingAutoFetchUrl: string | null;
    allowUserFlightApiKeys: boolean;
  }> => {
    const { data } = await api.get<{
      globalAirlabsApiKey?: string;
      globalAviationstackApiKey?: string;
      globalAerodataboxApiKey?: string;
      globalAeroapiApiKey?: string;
      globalLogostreamApiKey?: string;
      globalOpenskyClientId?: string;
      globalOpenskyClientSecret?: string;
      globalOpenskyUsername?: string;
      globalOpenskyPassword?: string;
      globalOpenrouteserviceApiKey?: string;
      globalGraphhopperApiKey?: string;
      routingProvider: RoutingProviderId | null;
      routingCustomUrl: string | null;
      routingAutoFetchUrl: string | null;
      allowUserFlightApiKeys: boolean;
    }>("/admin/api-keys");
    return data;
  },

  updateGlobalApiKeys: async (keys: {
    globalAirlabsApiKey?: string | null;
    globalAviationstackApiKey?: string | null;
    globalAerodataboxApiKey?: string | null;
    globalAeroapiApiKey?: string | null;
    globalLogostreamApiKey?: string | null;
    globalOpenskyClientId?: string | null;
    globalOpenskyClientSecret?: string | null;
    globalOpenskyUsername?: string | null;
    globalOpenskyPassword?: string | null;
    globalOpenrouteserviceApiKey?: string | null;
    globalGraphhopperApiKey?: string | null;
    routingProvider?: RoutingProviderId | null;
    routingCustomUrl?: string | null;
    routingAutoFetchUrl?: string | null;
    allowUserFlightApiKeys?: boolean;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/api-keys", keys);
    return data;
  },

  testApiKey: async (
    provider:
      | "openai"
      | "claude"
      | "airlabs"
      | "aviationstack"
      | "aerodatabox"
      | "aeroapi"
      | "opensky"
      | "openrouteservice"
      | "graphhopper"
      | "logostream"
      | "googlePlaces",
    apiKey?: string,
    openskyCredentials?: {
      clientId?: string;
      clientSecret?: string;
      username?: string;
      password?: string;
    }
  ): Promise<ApiKeyTestResponse> => {
    const endpoint = `/admin/api-keys/test/${provider}`;
    const payload = provider === "opensky" ? openskyCredentials : { apiKey };
    const { data } = await api.post<ApiKeyTestResponse>(endpoint, payload);
    return data;
  },

  // Logging API — every shape here is `shared/logContract.ts`, the file the
  // backend answers with. The two used to be described separately and drifted
  // (the cleanup toast read fields the server never sent).
  getLoggingConfig: async (): Promise<LoggingConfigResponse> => {
    const { data } = await api.get<LoggingConfigResponse>("/admin/logging/config");
    return data;
  },

  updateLoggingConfig: async (
    config: Partial<Omit<LoggingConfigResponse, "effectiveLogLevel" | "logLevelSource">>
  ): Promise<{ message: string; config: LoggingConfigResponse }> => {
    const { data } = await api.put<{ message: string; config: LoggingConfigResponse }>(
      "/admin/logging/config",
      config
    );
    return data;
  },

  toggleDebugLogging: async (
    enabled: boolean
  ): Promise<{ message: string; config: LoggingConfigResponse }> => {
    const { data } = await api.post<{ message: string; config: LoggingConfigResponse }>(
      "/admin/logging/toggle-debug",
      { enabled }
    );
    return data;
  },

  getLogFiles: async (): Promise<LogFilesResponse> => {
    const { data } = await api.get<LogFilesResponse>("/admin/logging/files");
    return data;
  },

  /** One page of a file, newest first. */
  readLogFile: async (
    filename: string,
    params: { level?: string; category?: string; search?: string; offset?: number; limit?: number }
  ): Promise<LogReadResponse> => {
    const { data } = await api.get<LogReadResponse>(
      `/admin/logging/files/${encodeURIComponent(filename)}/entries`,
      { params }
    );
    return data;
  },

  downloadLogFile: async (filename: string): Promise<Blob> => {
    const response = await api.get<Blob>(
      `/admin/logging/files/${encodeURIComponent(filename)}/download`,
      { responseType: "blob" }
    );
    return response.data;
  },

  deleteLogFile: async (filename: string): Promise<MessageResponse> => {
    const { data } = await api.delete<MessageResponse>(
      `/admin/logging/files/${encodeURIComponent(filename)}`
    );
    return data;
  },

  getLogStats: async (): Promise<LogStatsResponse> => {
    const { data } = await api.get<LogStatsResponse>("/admin/logging/stats");
    return data;
  },

  cleanupLogs: async (): Promise<LogCleanupResult> => {
    const { data } = await api.post<LogCleanupResult>("/admin/logging/cleanup");
    return data;
  },

  getSmtpConfig: async (): Promise<SmtpConfigResponse> => {
    const { data } = await api.get<SmtpConfigResponse>("/admin/smtp");
    return data;
  },

  saveSmtpConfig: async (config: SmtpConfigInput): Promise<SmtpConfigResponse> => {
    const { data } = await api.put<SmtpConfigResponse>("/admin/smtp", config);
    return data;
  },

  deleteSmtpConfig: async (): Promise<SmtpConfigResponse> => {
    const { data } = await api.delete<SmtpConfigResponse>("/admin/smtp");
    return data;
  },

  testSmtpConnection: async (
    config: SmtpConfigInput
  ): Promise<{ success: boolean; error?: string }> => {
    const { data } = await api.post<{ success: boolean; error?: string }>(
      "/admin/smtp/test",
      config
    );
    return data;
  },

  adminResetPassword: async (
    userId: string,
    mode: "generate" | "set",
    password?: string,
    mustChangePassword?: boolean
  ): Promise<{ message: string; temporaryPassword?: string }> => {
    const { data } = await api.post<{ message: string; temporaryPassword?: string }>(
      `/admin/users/${userId}/reset-password`,
      { mode, password, mustChangePassword }
    );
    return data;
  },

  /** Import mode (forgejo#304): upload and import limits lifted until `until`. */
  getImportMode: async (): Promise<ImportModeState> => {
    const { data } = await api.get<ImportModeState>("/admin/import-mode");
    return data;
  },

  setImportMode: async (
    body: { enabled: true; userId: string | null } | { enabled: false }
  ): Promise<ImportModeState> => {
    const { data } = await api.put<ImportModeState>("/admin/import-mode", body);
    return data;
  },

  getInstanceSettings: async (): Promise<InstanceSettingsResponse> => {
    const { data } = await api.get<InstanceSettingsResponse>("/admin/instance-settings");
    return data;
  },

  updateInstanceSettings: async (
    patch: InstanceSettingsPatch
  ): Promise<InstanceSettingsResponse> => {
    const { data } = await api.put<InstanceSettingsResponse>("/admin/instance-settings", patch);
    return data;
  },

  /** Tests `url` (typed, not yet saved) or, without it, the saved URL. */
  testRailRouting: async (url?: string): Promise<RailRoutingTestResult> => {
    const { data } = await api.post<RailRoutingTestResult>(
      "/admin/instance-settings/rail-routing/test",
      url ? { url } : {}
    );
    return data;
  },

  getWebDAVSettings: async (): Promise<{
    settings: {
      enabled: boolean;
      url: string | null;
      username: string | null;
      passwordSet: boolean;
      backupPath: string;
    };
  }> => {
    const { data } = await api.get<{
      settings: {
        enabled: boolean;
        url: string | null;
        username: string | null;
        passwordSet: boolean;
        backupPath: string;
      };
    }>("/admin/webdav-settings");
    return data;
  },

  updateWebDAVSettings: async (patch: {
    enabled?: boolean;
    url?: string;
    username?: string;
    password?: string;
    backupPath?: string;
  }): Promise<{
    settings: {
      enabled: boolean;
      url: string | null;
      username: string | null;
      passwordSet: boolean;
      backupPath: string;
    };
  }> => {
    const { data } = await api.put<{
      settings: {
        enabled: boolean;
        url: string | null;
        username: string | null;
        passwordSet: boolean;
        backupPath: string;
      };
    }>("/admin/webdav-settings", patch);
    return data;
  },

  testWebDAVConnection: async (): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post<{ success: boolean; message: string }>(
      "/admin/webdav-settings/test"
    );
    return data;
  },

  /** The on-demand map download's progress (admin-only; see the panel). */
  getRouteFetchStatus: async (): Promise<RouteFetchStatus> => {
    const { data } = await api.get<RouteFetchStatus>("/admin/route-fetch");
    return data;
  },
};
