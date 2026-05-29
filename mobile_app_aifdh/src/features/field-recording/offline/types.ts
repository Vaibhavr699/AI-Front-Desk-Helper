export type PendingStatus = "pending" | "uploading" | "failed";

export type PendingRecording = {
  id: string;
  lead_id: string;
  lead_name: string | null;
  file_uri: string;
  consent_status: string;
  consent_method: string;
  consent_state: string | null;
  duration_seconds: number;
  created_at: number;
  status: PendingStatus;
  attempts: number;
  last_error: string | null;
};

export type EnqueueInput = {
  leadId: string;
  leadName?: string | null;
  fileUri: string;
  consentStatus: string;
  consentMethod: string;
  consentState: string | null;
  durationSeconds: number;
};

export const MAX_BUFFER_SECONDS = 60 * 60;
