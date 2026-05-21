import type { DiscLetter } from "@/src/features/appointments/types";

export type LeadStatus =
  | "New Lead"
  | "contacted"
  | "quoted"
  | "no_answer"
  | "booked"
  | "lost"
  | "dead"
  | "dnc"
  | string;

export type LeadFilter =
  | "all"
  | "today"
  | "week"
  | "needs_followup"
  | "booked"
  | "lost";

export type LeadSummary = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  project_type: string | null;
  status: LeadStatus | null;
  lead_source: string | null;
  estimated_revenue_cents: number | null;
  created_at: string;
  updated_at: string;
  buyer_persona: string | null;
  persona_confidence: number | null;
  disc_primary: DiscLetter | "unknown" | null;
  disc_secondary: DiscLetter | null;
  disc_confidence: number | null;
  has_widget_estimate: boolean;
  widget_estimate_low_cents: number | null;
  widget_estimate_high_cents: number | null;
  do_not_contact: boolean;
  human_handoff_active: boolean;
};

export type LeadsListResponse = {
  leads: LeadSummary[];
  limit: number;
  offset: number;
  has_more: boolean;
};

export type WidgetEstimate = {
  low_cents: number;
  high_cents: number;
  scope_summary: string | null;
  estimated_at: string | null;
};

export type RepQuote = {
  total_cents: number;
  entered_at: string;
  entered_by_user_id: string | null;
};

export type VarianceCoaching = {
  widget_midpoint_cents: number;
  widget_low_cents: number;
  widget_high_cents: number;
  widget_scope_summary: string | null;
  quote_total_cents: number;
  variance_pct: number;
  direction: "above" | "below" | "within";
  reasons: string[];
  talking_points: string[];
  computed_at: string;
};

export type CustomerIntelligence = {
  disc_primary: DiscLetter | "unknown" | null;
  disc_secondary: DiscLetter | null;
  disc_confidence: number | null;
  disc_signals: unknown;
  disc_detected_at: string | null;
  persona: string | null;
  confidence: number | null;
  detected_at: string | null;
  signals: unknown;
};

export type LeadMessage = {
  id: string;
  channel: string;
  direction: "inbound" | "outbound" | string;
  body: string | null;
  created_at: string;
  sent_by_user_id: string | null;
};

export type LeadCall = {
  id: string;
  direction: "inbound" | "outbound" | string;
  status: string | null;
  disposition: string | null;
  transferred: boolean | null;
  duration_minutes: number | null;
  started_at: string;
  ended_at: string | null;
  transcript: string | null;
  recording_sid: string | null;
};

export type CoachingConversationSummary = {
  id: string;
  overall_score: number | null;
  buyer_persona: string | null;
  persona_confidence: number | null;
  scored_at: string | null;
  outcome: string | null;
};

export type UpcomingAppointment = {
  id: string;
  preferred_date: string | null;
  appointment_time: string | null;
  technician_id: string | null;
  status: string | null;
  state: string | null;
};

export type LeadDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  project_type: string | null;
  notes: string | null;
  status: LeadStatus | null;
  lead_source: string | null;
  estimated_revenue_cents: number | null;
  actual_revenue_cents: number | null;
  created_at: string;
  updated_at: string;
  do_not_contact: boolean;
  human_handoff_active: boolean;
  widget_estimate: WidgetEstimate | null;
  rep_quote: RepQuote | null;
  variance_coaching: VarianceCoaching | null;
  intelligence: CustomerIntelligence | null;
  messages: LeadMessage[];
  calls: LeadCall[];
  coaching_conversations: CoachingConversationSummary[];
  upcoming_appointments: UpcomingAppointment[];
};
