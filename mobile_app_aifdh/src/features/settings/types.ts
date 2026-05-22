import type { SeatTier } from "@/src/shared/types/api";

export type CoachingDeliveryPrefs = {
  audio?: boolean;
  watch?: boolean;
  popup?: boolean;
  sidebar?: boolean;
};

export type TrustedDeviceEntry = {
  fingerprint: string;
  biometric_type: string | null;
  registered_at: string;
  expires_at: string;
};

export type RepProfile = {
  id: string;
  email: string;
  phone: string | null;
  role: string;
  tenant: {
    id: string;
    name: string | null;
    business_type: string | null;
    timezone: string | null;
  };
  seat: {
    tier: SeatTier;
    activated_at: string | null;
  };
  coaching_delivery_prefs: CoachingDeliveryPrefs;
  preferred_earbud_device: string | null;
  push_registered: boolean;
  last_app_open_at: string | null;
  trusted_devices: TrustedDeviceEntry[];
};

export type NotificationKey =
  | "new_lead"
  | "coaching_feedback"
  | "manager_message"
  | "live_coach_alert"
  | "roleplay_invite"
  | "briefing_ready"
  | "appointment_reminder"
  | "variance_coaching";

export type NotificationPrefs = Record<NotificationKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  new_lead: true,
  coaching_feedback: true,
  manager_message: true,
  live_coach_alert: true,
  roleplay_invite: true,
  briefing_ready: true,
  appointment_reminder: true,
  variance_coaching: true,
};

export const NOTIFICATION_LABELS: Record<NotificationKey, { title: string; subtitle: string }> = {
  new_lead: {
    title: "New leads",
    subtitle: "When a new lead is assigned to you",
  },
  appointment_reminder: {
    title: "Appointment reminders",
    subtitle: "Before each in-home visit",
  },
  briefing_ready: {
    title: "Briefing ready",
    subtitle: "When the AI briefing finishes for a lead",
  },
  coaching_feedback: {
    title: "Coaching feedback",
    subtitle: "After a call gets scored",
  },
  manager_message: {
    title: "Manager messages",
    subtitle: "Direct comments from your manager",
  },
  variance_coaching: {
    title: "Quote variance coaching",
    subtitle: "When your quote diverges from the website ballpark",
  },
  live_coach_alert: {
    title: "Live coaching alerts",
    subtitle: "Real-time coaching during in-home sessions (Phase 6 D)",
  },
  roleplay_invite: {
    title: "Roleplay invites",
    subtitle: "When a roleplay scenario is shared with you (Phase 6 C2)",
  },
};
