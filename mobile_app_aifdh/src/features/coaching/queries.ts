import { useQuery } from "@tanstack/react-query";

import { fetchCoachingMe } from "./api";

export const coachingKeys = {
  all: ["coaching"] as const,
  me: (days: number) => [...coachingKeys.all, "me", days] as const,
};

export function useCoachingMe(days = 30) {
  return useQuery({
    queryKey: coachingKeys.me(days),
    queryFn: () => fetchCoachingMe(days),
    staleTime: 60_000,
  });
}
