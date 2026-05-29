import type { DiscLetter } from "@/src/features/appointments/types";

export type NetworkMode = "online" | "degraded" | "offline";

export type ConsentType = "verbal" | "written" | "not_required";

export type StartSessionInput = {
  lead_id?: string;
  consent_obtained: boolean;
  consent_type: ConsentType | null;
  consent_state: string | null;
  device_type: string;
  network_mode: NetworkMode;
};

export type InHomeSession = {
  id: string;
  tenant_id: string;
  user_id: string;
  lead_id: string | null;
  started_at: string;
  ended_at: string | null;
  consent_obtained: boolean;
  consent_type: ConsentType | null;
  consent_state: string | null;
  device_type: string | null;
  network_mode: NetworkMode | null;
  transcript: TranscriptEntry[];
  outcome: string | null;
  estimate_value_cents: number | null;
  rep_satisfaction: number | null;
  disc_progression: unknown;
  coaching_alerts: unknown;
  walkthrough_checklist_completed: unknown;
  customer_signals: unknown;
  delivery_mode_used: unknown;
};

export type TranscriptEntry = {
  speaker: "rep" | "customer" | "unknown";
  text: string;
  at: string;
};

export type StartSessionResponse = {
  session: InHomeSession;
  ws_path: string;
};

export type CoachingAlertUrgency = "green" | "yellow" | "orange" | "red";

export type CoachingCueType =
  | "ask_discovery"
  | "listen"
  | "disc_reframe"
  | "missing_close"
  | "address_objection"
  | "slow_down"
  | "build_rapport"
  | "confirm_next_step";

export type CoachingAlertType =
  | CoachingCueType
  | "disc_update"
  | "disc_shift"
  | "objection_detected"
  | "buying_signal"
  | "decision_maker"
  | "warning"
  | "suggested_response"
  | "walkthrough_reminder";

export type CoachingAlert = {
  id: string;
  type: CoachingAlertType;
  cue_type?: CoachingCueType;
  urgency: CoachingAlertUrgency;
  headline: string;
  full_text: string | null;
  vibration: "single_tap" | "double_tap" | "long_buzz" | null;
  watch_label?: string;
  disc_type?: DiscLetter | null;
  confidence?: number | null;
  fired_at: string;
};

export type DiscReading = {
  primary: DiscLetter | "unknown";
  secondary: DiscLetter | null;
  confidence: number;
};

export type WalkthroughItem = {
  key: string;
  label: string;
  completed: boolean;
};

export type CuePreferences = Record<CoachingCueType, boolean>;

export type WsServerMessage =
  | { type: "session_status"; status: "connected"; session_id: string; server_time: string }
  | { type: "heartbeat"; t: number }
  | { type: "transcript_update"; entry: TranscriptEntry }
  | { type: "disc_update"; reading: DiscReading }
  | { type: "alert"; alert: CoachingAlert }
  | { type: "coaching_cue"; cue: CoachingAlert; channels?: string[] }
  | { type: "cue_audio"; cue_id: string; format: string; data: string }
  | { type: "checklist_update"; key: string; completed: boolean }
  | { type: "transcriber_error"; message: string }
  | { type: "echo"; received?: unknown; binary?: boolean; bytes?: number };

export type WsClientMessage =
  | { type: "client_heartbeat"; t: number }
  | { type: "transcript_manual"; speaker: string; text: string; at?: string }
  | { type: "cue_dismissed"; cue_id: string }
  | { type: "set_audio_mute"; muted: boolean }
  | { type: "request_mock_alerts" };
