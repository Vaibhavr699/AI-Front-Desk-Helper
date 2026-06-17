import { api, authTokenHolder } from "@/src/shared/api/client";
import { API_BASE_URL } from "@/src/config/env";

import type {
  CuePreferences,
  InHomeSession,
  InHomeSessionAlert,
  InHomeSessionSummary,
  SessionComment,
  StartSessionInput,
  StartSessionResponse,
} from "./types";

export async function startInHomeSession(
  input: StartSessionInput,
): Promise<StartSessionResponse> {
  const { data } = await api.post<StartSessionResponse>(
    "/rep/in-home/start",
    input,
  );
  return data;
}

export async function endInHomeSession(
  sessionId: string,
  patch: {
    outcome?: string;
    estimate_value_cents?: number;
    customer_signals?: unknown;
    delivery_mode_used?: unknown;
    disc_progression?: unknown;
  } = {},
): Promise<{ session: InHomeSession }> {
  const { data } = await api.post("/rep/in-home/end", {
    session_id: sessionId,
    ...patch,
  });
  return data;
}

export async function fetchInHomeSession(
  sessionId: string,
): Promise<{
  session: InHomeSession;
  alerts: InHomeSessionAlert[];
  comments: SessionComment[];
}> {
  const { data } = await api.get(`/rep/in-home/sessions/${sessionId}`);
  return data;
}

export async function fetchInHomeSessions(): Promise<{
  sessions: InHomeSessionSummary[];
}> {
  const { data } = await api.get("/rep/in-home/sessions");
  return data;
}

export async function submitSessionFeedback(
  sessionId: string,
  satisfaction: number,
): Promise<{ session: InHomeSession }> {
  const { data } = await api.post(
    `/rep/in-home/sessions/${sessionId}/feedback`,
    { rep_satisfaction: satisfaction },
  );
  return data;
}

export async function fetchCuePreferences(): Promise<{
  cue_preferences: CuePreferences;
}> {
  const { data } = await api.get("/rep/cue-settings");
  return data;
}

export async function updateCuePreferences(
  updates: Partial<CuePreferences>,
): Promise<{ cue_preferences: CuePreferences }> {
  const { data } = await api.patch("/rep/cue-settings", updates);
  return data;
}

export async function uploadSessionChunk(
  sessionId: string,
  seq: number,
  uri: string,
): Promise<void> {
  const form = new FormData();
  form.append("chunk", {
    uri,
    name: `${String(seq).padStart(6, "0")}.m4a`,
    type: "audio/mp4",
  } as any);
  form.append("seq", String(seq));

  const token = authTokenHolder.get();
  const resp = await fetch(
    `${API_BASE_URL}/api/rep/in-home/sessions/${sessionId}/chunks`,
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Chunk upload failed" }));
    throw new Error(err.error || "Chunk upload failed");
  }
}

export function buildWsUrl(wsPath: string, sessionToken: string): string {
  const base = API_BASE_URL.replace(/^http/i, "ws");
  return `${base}${wsPath}?token=${encodeURIComponent(sessionToken)}`;
}
