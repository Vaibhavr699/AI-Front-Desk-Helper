import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  endInHomeSession,
  fetchInHomeSession,
  startInHomeSession,
  submitSessionFeedback,
} from "./api";
import type { StartSessionInput } from "./types";

export const inHomeKeys = {
  all: ["in-home"] as const,
  session: (id: string) => [...inHomeKeys.all, "session", id] as const,
};

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
    }) =>
      endInHomeSession(input.sessionId, {
        outcome: input.outcome,
        estimate_value_cents: input.estimate_value_cents,
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
