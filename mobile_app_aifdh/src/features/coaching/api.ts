import { api } from "@/src/shared/api/client";

import type { CoachingMeResponse } from "./types";

export async function fetchCoachingMe(
  days = 30,
): Promise<CoachingMeResponse> {
  const { data } = await api.get<CoachingMeResponse>("/rep/coaching/me", {
    params: { days },
  });
  return data;
}
