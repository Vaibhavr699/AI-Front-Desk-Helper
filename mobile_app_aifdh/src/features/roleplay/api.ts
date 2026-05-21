import { api } from "@/src/shared/api/client";

import type {
  RoleplayScenario,
  RoleplayScoring,
  RoleplaySession,
  RoleplaySessionSummary,
  RoleplayTranscriptTurn,
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
