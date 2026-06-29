import { api } from "@/src/shared/api/client";

import type {
  CoachingDimensionAverage,
  CoachingHistoryPage,
  CoachingMeResponse,
  CoachingRecentConversation,
  CoachingTrendPoint,
  ConversationReview,
  ManagerCommentsResponse,
} from "./types";

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDimension(
  d: CoachingDimensionAverage,
): CoachingDimensionAverage {
  return { ...d, avg_score: toNum(d.avg_score), samples: toNum(d.samples) };
}

function normalizeCoachingMe(data: CoachingMeResponse): CoachingMeResponse {
  return {
    ...data,
    overall: {
      conversations: toNum(data.overall?.conversations),
      avg_score: toNumOrNull(data.overall?.avg_score),
    },
    dimensions: (data.dimensions ?? []).map(normalizeDimension),
    best_dimension: data.best_dimension
      ? normalizeDimension(data.best_dimension)
      : null,
    weakest_dimension: data.weakest_dimension
      ? normalizeDimension(data.weakest_dimension)
      : null,
    trend: (data.trend ?? []).map(
      (p: CoachingTrendPoint): CoachingTrendPoint => ({
        ...p,
        avg_score: toNum(p.avg_score),
        conversations: toNum(p.conversations),
      }),
    ),
    recent_conversations: (data.recent_conversations ?? []).map(
      (c: CoachingRecentConversation): CoachingRecentConversation => ({
        ...c,
        overall_score: toNumOrNull(c.overall_score),
      }),
    ),
  };
}

export async function fetchCoachingMe(
  days = 30,
): Promise<CoachingMeResponse> {
  const { data } = await api.get<CoachingMeResponse>("/rep/coaching/me", {
    params: { days },
  });
  return normalizeCoachingMe(data);
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
  return {
    ...data,
    conversations: (data.conversations ?? []).map((c) => ({
      ...c,
      overall_score: toNumOrNull(c.overall_score),
      duration_seconds: toNumOrNull(c.duration_seconds),
    })),
  };
}

export async function fetchConversationReview(
  id: string,
): Promise<ConversationReview> {
  const { data } = await api.get<ConversationReview>(
    `/rep/coaching/conversations/${id}`,
  );
  const normDims = (data.dimensions ?? []).map((d) => ({
    ...d,
    score: toNum(d.score),
  }));
  return {
    ...data,
    conversation: {
      ...data.conversation,
      overall_score: toNumOrNull(data.conversation?.overall_score),
      persona_confidence: toNumOrNull(data.conversation?.persona_confidence),
      duration_seconds: toNumOrNull(data.conversation?.duration_seconds),
    },
    dimensions: normDims,
    strengths: (data.strengths ?? []).map((d) => ({
      ...d,
      score: toNum(d.score),
    })),
    improvements: (data.improvements ?? []).map((d) => ({
      ...d,
      score: toNum(d.score),
    })),
  };
}

export async function fetchManagerComments(
  id: string,
): Promise<ManagerCommentsResponse> {
  const { data } = await api.get<ManagerCommentsResponse>(
    `/rep/coaching/conversations/${id}/manager-comments`,
  );
  return {
    comments: (data.comments ?? []).map((c) => ({
      ...c,
      turn_index: toNum(c.turn_index),
    })),
  };
}
