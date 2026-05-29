import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  fetchCoachingHistory,
  fetchCoachingMe,
  fetchConversationReview,
} from "./api";

export const coachingKeys = {
  all: ["coaching"] as const,
  me: (days: number) => [...coachingKeys.all, "me", days] as const,
  history: (days: number) => [...coachingKeys.all, "history", days] as const,
  conversation: (id: string) =>
    [...coachingKeys.all, "conversation", id] as const,
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
  });
}

export function useConversationReview(id: string | null) {
  return useQuery({
    queryKey: coachingKeys.conversation(id ?? "none"),
    queryFn: () => fetchConversationReview(id as string),
    enabled: !!id,
  });
}
