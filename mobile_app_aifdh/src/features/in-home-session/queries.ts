import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  endInHomeSession,
  fetchCuePreferences,
  fetchInHomeSession,
  fetchInHomeSessions,
  startInHomeSession,
  submitSessionFeedback,
  updateCuePreferences,
} from "./api";
import type { CuePreferences, StartSessionInput } from "./types";

export const inHomeKeys = {
  all: ["in-home"] as const,
  session: (id: string) => [...inHomeKeys.all, "session", id] as const,
  sessions: () => [...inHomeKeys.all, "sessions"] as const,
};

export function useInHomeSessions() {
  return useQuery({
    queryKey: inHomeKeys.sessions(),
    queryFn: fetchInHomeSessions,
    staleTime: 30_000,
  });
}

export function useStartInHomeSession() {
  return useMutation({
    mutationFn: (input: StartSessionInput) => startInHomeSession(input),
  });
}

export function useEndInHomeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sessionId: string;
      outcome?: string;
      estimate_value_cents?: number;
      disc_progression?: unknown;
    }) =>
      endInHomeSession(input.sessionId, {
        outcome: input.outcome,
        estimate_value_cents: input.estimate_value_cents,
        disc_progression: input.disc_progression,
      }),
    onSuccess: (_, { sessionId }) => {
      qc.invalidateQueries({ queryKey: inHomeKeys.session(sessionId) });
    },
  });
}

export function useInHomeSession(sessionId: string | null) {
  return useQuery({
    queryKey: sessionId
      ? inHomeKeys.session(sessionId)
      : ["in-home", "session", "_none"],
    queryFn: () => fetchInHomeSession(sessionId as string),
    enabled: !!sessionId,
    staleTime: 30_000,
  });
}

export function useSessionFeedback() {
  return useMutation({
    mutationFn: (input: { sessionId: string; satisfaction: number }) =>
      submitSessionFeedback(input.sessionId, input.satisfaction),
  });
}

export function useCuePreferences() {
  return useQuery({
    queryKey: ["cue-preferences"],
    queryFn: fetchCuePreferences,
    staleTime: 60_000,
  });
}

export function useUpdateCuePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<CuePreferences>) => updateCuePreferences(updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cue-preferences"] });
    },
  });
}
