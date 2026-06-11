import { API_BASE_URL } from "@/src/config/env";
import { api, authTokenHolder } from "@/src/shared/api/client";

import type {
  RoleplayScenario,
  RoleplayScoring,
  RoleplaySession,
  RoleplaySessionSummary,
  RoleplayTranscriptTurn,
  RoleplayVoiceResponse,
} from "./types";

export async function fetchScenarios(): Promise<{ scenarios: RoleplayScenario[] }> {
  const { data } = await api.get<{ scenarios: RoleplayScenario[] }>(
    "/rep/roleplay/scenarios",
  );
  return data;
}

export async function startSession(
  input: { scenario_id?: string; custom_text?: string },
): Promise<{ session: RoleplaySession; opening: string }> {
  const { data } = await api.post<{ session: RoleplaySession; opening: string }>(
    "/rep/roleplay/start",
    input,
  );
  return data;
}

export async function respondToSession(
  sessionId: string,
  message: string,
): Promise<{ rep_turn: RoleplayTranscriptTurn; ai_turn: RoleplayTranscriptTurn }> {
  const { data } = await api.post("/rep/roleplay/respond", {
    session_id: sessionId,
    message,
  });
  return data;
}

export async function respondToSessionVoice(
  sessionId: string,
  uri: string,
): Promise<RoleplayVoiceResponse> {
  const form = new FormData();
  form.append("audio", {
    uri,
    name: `roleplay-${Date.now()}.m4a`,
    type: "audio/mp4",
  } as unknown as Blob);
  form.append("session_id", sessionId);

  const token = authTokenHolder.get();
  const resp = await fetch(`${API_BASE_URL}/api/rep/roleplay/respond-voice`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Voice send failed" }));
    throw new Error(err.error || "Voice send failed");
  }
  return resp.json() as Promise<RoleplayVoiceResponse>;
}

export async function speakText(text: string): Promise<{ audio_base64: string }> {
  const { data } = await api.post<{ audio_base64: string }>(
    "/rep/roleplay/speak",
    { text },
  );
  return data;
}

export async function endSession(sessionId: string): Promise<{
  scoring: RoleplayScoring;
  outcome: string | null;
  duration_seconds: number;
}> {
  const { data } = await api.post("/rep/roleplay/end", { session_id: sessionId });
  return data;
}

export async function fetchSessions(): Promise<{ sessions: RoleplaySessionSummary[] }> {
  const { data } = await api.get<{ sessions: RoleplaySessionSummary[] }>(
    "/rep/roleplay/sessions",
  );
  return data;
}

export async function fetchSessionDetail(id: string): Promise<RoleplaySession> {
  const { data } = await api.get<RoleplaySession>(`/rep/roleplay/sessions/${id}`);
  return data;
}
