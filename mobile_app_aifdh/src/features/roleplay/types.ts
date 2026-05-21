import type { DiscLetter } from "@/src/features/appointments/types";

export type RoleplayOutcome = "closed" | "warm_followup" | "stalled" | "lost";

export type RoleplayScenario = {
  id: string;
  title: string;
  description: string | null;
  industry: string | null;
  scenario_type: string | null;
  difficulty: number | null;
  skills_trained: string[];
  disc_type: DiscLetter | "unknown" | null;
  is_template: boolean;
  is_custom: boolean;
};

export type RoleplayTranscriptTurn = {
  role: "customer" | "rep";
  text: string;
  at: string;
};

export type RoleplayScoring = {
  overall_score: number | null;
  dimensions: Record<string, number | null>;
  what_worked: string[];
  what_to_improve: string[];
  outcome: RoleplayOutcome | null;
  scored_at: string;
};

export type RoleplaySession = {
  id: string;
  scenario_id: string | null;
  scenario: RoleplayScenario | null;
  custom_scenario_text: string | null;
  custom_opening: string | null;
  transcript: RoleplayTranscriptTurn[];
  scoring: RoleplayScoring | null;
  outcome: RoleplayOutcome | null;
  duration_seconds: number | null;
  started_at: string;
  completed_at: string | null;
};

export type RoleplaySessionSummary = {
  id: string;
  scenario_id: string | null;
  scenario_title: string;
  scenario_disc: DiscLetter | "unknown" | null;
  overall_score: number | null;
  outcome: RoleplayOutcome | null;
  duration_seconds: number | null;
  started_at: string;
  completed_at: string | null;
};
