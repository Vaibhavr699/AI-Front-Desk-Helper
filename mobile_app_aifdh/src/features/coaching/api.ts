import { api } from "@/src/shared/api/client";

import type {
  CoachingHistoryPage,
  CoachingMeResponse,
  ConversationReview,
} from "./types";

export async function fetchCoachingMe(
  days = 30,
): Promise<CoachingMeResponse> {
  const { data } = await api.get<CoachingMeResponse>("/rep/coaching/me", {
    params: { days },
  });
  return data;
}

export async function fetchCoachingHistory(params: {
  days?: number;
  limit?: number;
  offset?: number;
}): Promise<CoachingHistoryPage> {
  const { data } = await api.get<CoachingHistoryPage>(
    "/rep/coaching/me/history",
    { params },
  );
  return data;
}

export async function fetchConversationReview(
  id: string,
): Promise<ConversationReview> {
  const { data } = await api.get<ConversationReview>(
    `/rep/coaching/conversations/${id}`,
  );
  return data;
}
