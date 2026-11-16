import type {
  DemoData,
  Platform,
  UserPreferences,
  UserProfile,
  Watch,
} from "../types";

const rawBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export const apiBase = rawBase;
export const apiEnabled = Boolean(rawBase);
const internalToken = import.meta.env.VITE_SCOPEDIFF_INTERNAL_TOKEN || "";

async function request<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${rawBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(internalToken ? { "X-ScopeDiff-Token": internalToken } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload);
      } catch {
        // keep the status text
      }
      throw new Error(detail);
    }
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface Bootstrap extends DemoData {
  meta: DemoData["meta"] & { demo: boolean };
}

export interface MeBootstrap extends DemoData {
  profile?: UserProfile;
  watches?: Watch[];
}

export async function fetchMeProfile(token: string): Promise<UserProfile> {
  return request<UserProfile>("/api/me/profile", {}, token);
}

export async function saveMePreferences(
  token: string,
  preferences: UserPreferences,
): Promise<UserProfile> {
  return request<UserProfile>(
    "/api/me/preferences",
    { method: "PUT", body: JSON.stringify(preferences) },
    token,
  );
}

export async function fetchMeBootstrap(token: string): Promise<MeBootstrap> {
  return request<MeBootstrap>("/api/me/bootstrap", {}, token);
}

export interface AddWatchResponse {
  watch: Watch;
  program: unknown;
  result: { status: string; change_id: string | null; message: string };
}

export async function addMeWatch(
  token: string,
  payload: {
    url: string;
    interval_minutes?: number;
    alert_mode?: string;
    min_materiality?: number;
    slack_webhook?: string;
  },
): Promise<AddWatchResponse> {
  return request<AddWatchResponse>(
    "/api/me/watches",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export async function updateMeWatch(
  token: string,
  programId: string,
  payload: Partial<Pick<Watch, "interval_minutes" | "active" | "alert_mode" | "min_materiality" | "slack_webhook">>,
): Promise<Watch> {
  return request<Watch>(
    `/api/me/watches/${encodeURIComponent(programId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteMeWatch(token: string, programId: string): Promise<void> {
  await request<{ deleted: boolean }>(
    `/api/me/watches/${encodeURIComponent(programId)}`,
    { method: "DELETE" },
    token,
  );
}

export async function testMeAlert(token: string, webhook?: string): Promise<AlertTestResponse> {
  return request<AlertTestResponse>(
    "/api/me/alerts/test",
    { method: "POST", body: JSON.stringify({ webhook_url: webhook || null }) },
    token,
  );
}

export async function fetchBootstrap(): Promise<DemoData> {
  const data = await request<DemoData>("/api/bootstrap");
  return {
    ...data,
    meta: {
      ...data.meta,
      demo: Boolean(data.meta?.demo),
      generated_at: data.meta?.generated_at || new Date().toISOString(),
    },
    viewer: data.viewer || {
      name: "Live hunter",
      handle: "live",
      testing: [],
      watchlist: [],
    },
  };
}

export interface SimulateResponse {
  result: { status: string; change_id: string | null; message: string };
  change: unknown;
}

export async function simulateChange(): Promise<SimulateResponse> {
  return request<SimulateResponse>("/internal/simulate", {
    method: "POST",
    body: JSON.stringify({ scenario: "acme-v8" }),
  });
}

export interface SyncResponse {
  results: Array<{ program_id: string; status: string; message: string; change_id: string | null }>;
}

export async function syncProgram(platform: Platform, handle: string): Promise<SyncResponse> {
  return request<SyncResponse>("/internal/sync", {
    method: "POST",
    body: JSON.stringify({ platform, handle, all: false }),
  });
}

export interface Health {
  ok: boolean;
  demo: boolean;
  store: string;
  slack_configured: boolean;
  hackerone_configured: boolean;
}

export async function fetchHealth(): Promise<Health> {
  return request<Health>("/healthz");
}

export interface AlertTestResponse {
  status: string;
  message: string;
  detail: string | null;
}

export async function testAlert(webhookUrl?: string): Promise<AlertTestResponse> {
  return request<AlertTestResponse>("/internal/alerts/test", {
    method: "POST",
    body: JSON.stringify({ webhook_url: webhookUrl || null }),
  });
}
