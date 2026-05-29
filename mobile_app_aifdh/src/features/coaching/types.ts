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

export type CoachingEvidence = {
  turn_index?: number;
  quote?: string;
  why?: string;
};

export type CoachingDimensionDetail = {
  dimension: string;
  score: number;
  rationale: string | null;
  evidence: CoachingEvidence[];
};

export type HistoryConversation = {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  overall_score: number | null;
  buyer_persona: string | null;
  disc_primary: string | null;
  scored_at: string | null;
  created_at: string | null;
  outcome: string | null;
  duration_seconds: number | null;
  source_type: string | null;
  scoring_skip_reason: string | null;
};

export type CoachingHistoryPage = {
  window_days: number;
  conversations: HistoryConversation[];
  next_offset: number | null;
};

export type ConversationReview = {
  conversation: {
    id: string;
    lead_id: string | null;
    lead_name: string | null;
    overall_score: number | null;
    buyer_persona: string | null;
    persona_confidence: number | null;
    disc_primary: string | null;
    disc_secondary: string | null;
    scored_at: string | null;
    created_at: string | null;
    outcome: string | null;
    duration_seconds: number | null;
    source_type: string | null;
    scoring_skip_reason: string | null;
  };
  dimensions: CoachingDimensionDetail[];
  strengths: CoachingDimensionDetail[];
  improvements: CoachingDimensionDetail[];
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
