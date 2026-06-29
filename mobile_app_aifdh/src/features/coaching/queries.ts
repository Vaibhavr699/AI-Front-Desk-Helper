import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  fetchCoachingHistory,
  fetchCoachingMe,
  fetchConversationReview,
  fetchManagerComments,
} from "./api";

export const coachingKeys = {
  all: ["coaching"] as const,
  me: (days: number) => [...coachingKeys.all, "me", days] as const,
  history: (days: number) => [...coachingKeys.all, "history", days] as const,
  conversation: (id: string) =>
    [...coachingKeys.all, "conversation", id] as const,
  managerComments: (id: string) =>
    [...coachingKeys.all, "manager-comments", id] as const,
};

export function useCoachingMe(days = 30) {
  return useQuery({
    queryKey: coachingKeys.me(days),
    queryFn: () => fetchCoachingMe(days),
    staleTime: 60_000,
  });
}

export function useCoachingHistory(days = 30) {
  return useInfiniteQuery({
    queryKey: coachingKeys.history(days),
    queryFn: ({ pageParam }) =>
      fetchCoachingHistory({ days, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function useConversationReview(id: string | null) {
  return useQuery({
    queryKey: coachingKeys.conversation(id ?? "none"),
    queryFn: () => fetchConversationReview(id as string),
    enabled: !!id,
    staleTime: 2 * 60_000,
  });
}

export function useManagerComments(id: string | null) {
  return useQuery({
    queryKey: coachingKeys.managerComments(id ?? "none"),
    queryFn: () => fetchManagerComments(id as string),
    enabled: !!id,
    staleTime: 2 * 60_000,
  });
}
