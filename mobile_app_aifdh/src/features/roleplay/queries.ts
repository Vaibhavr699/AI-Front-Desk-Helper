import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  endSession,
  fetchScenarios,
  fetchSessionDetail,
  fetchSessions,
  respondToSession,
  respondToSessionVoice,
  startSession,
} from "./api";

export const roleplayKeys = {
  all: ["roleplay"] as const,
  scenarios: () => [...roleplayKeys.all, "scenarios"] as const,
  sessions: () => [...roleplayKeys.all, "sessions"] as const,
  session: (id: string) => [...roleplayKeys.all, "session", id] as const,
};

export function useScenarios() {
  return useQuery({
    queryKey: roleplayKeys.scenarios(),
    queryFn: fetchScenarios,
    staleTime: 5 * 60_000,
  });
}

export function useStartSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scenario_id?: string; custom_text?: string }) =>
      startSession(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: roleplayKeys.sessions() });
    },
  });
}

export function useRespond(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => respondToSession(sessionId, message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: roleplayKeys.session(sessionId) });
    },
  });
}

export function useRespondVoice(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uri: string) => respondToSessionVoice(sessionId, uri),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: roleplayKeys.session(sessionId) });
    },
  });
}

export function useEndSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: roleplayKeys.session(sessionId) });
      qc.invalidateQueries({ queryKey: roleplayKeys.sessions() });
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: roleplayKeys.sessions(),
    queryFn: fetchSessions,
    staleTime: 30_000,
  });
}

export function useSessionDetail(id: string | null) {
  return useQuery({
    queryKey: id ? roleplayKeys.session(id) : ["roleplay", "session", "_none"],
    queryFn: () => fetchSessionDetail(id as string),
    enabled: !!id,
    staleTime: 30_000,
  });
}
