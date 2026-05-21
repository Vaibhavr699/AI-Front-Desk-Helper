export type CoachingDimensionAverage = {
  dimension: string;
  avg_score: number;
  samples: number;
};

export type CoachingTrendPoint = {
  day: string;
  avg_score: number;
  conversations: number;
};

export type CoachingRecentConversation = {
  id: string;
  lead_id: string | null;
  overall_score: number | null;
  buyer_persona: string | null;
  scored_at: string | null;
  outcome: string | null;
};

export type CoachingMeResponse = {
  window_days: number;
  overall: {
    conversations: number;
    avg_score: number | null;
  };
  dimensions: CoachingDimensionAverage[];
  best_dimension: CoachingDimensionAverage | null;
  weakest_dimension: CoachingDimensionAverage | null;
  trend: CoachingTrendPoint[];
  recent_conversations: CoachingRecentConversation[];
};
