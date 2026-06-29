export type DiscLetter = "D" | "I" | "S" | "C";

export type AppointmentLead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  project_type: string | null;
  status: string | null;
  disc_primary: DiscLetter | "unknown" | null;
  disc_secondary: DiscLetter | null;
  disc_confidence: number | null;
  buyer_persona: string | null;
  persona_confidence: number | null;
  has_widget_estimate: boolean;
  widget_estimate_low_cents: number | null;
  widget_estimate_high_cents: number | null;
};

export type Appointment = {
  id: string;
  preferred_date: string;
  appointment_time: string | null;
  status: string | null;
  state: string | null;
  scope: string | null;
  job_type: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  lead: AppointmentLead | null;
};

export type TodayAppointmentsResponse = {
  appointments: Appointment[];
};
