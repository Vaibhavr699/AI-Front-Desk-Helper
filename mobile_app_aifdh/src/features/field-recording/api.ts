import { api } from "@/src/shared/api/client";
import { API_BASE_URL } from "@/src/config/env";
import { authTokenHolder } from "@/src/shared/api/client";

export async function uploadFieldRecording(
  uri: string,
  metadata: {
    lead_id: string;
    consent_status: string;
    consent_method: string;
    consent_state: string | null;
    duration_seconds: number;
  },
) {
  const form = new FormData();
  form.append("audio", {
    uri,
    name: `recording-${Date.now()}.m4a`,
    type: "audio/mp4",
  } as any);
  form.append("lead_id", metadata.lead_id);
  form.append("consent_status", metadata.consent_status);
  form.append("consent_method", metadata.consent_method);
  if (metadata.consent_state) form.append("consent_state", metadata.consent_state);
  form.append("duration_seconds", String(metadata.duration_seconds));

  const token = authTokenHolder.get();
  const resp = await fetch(`${API_BASE_URL}/api/rep/recording/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  return resp.json() as Promise<{ conversation_id: string; status: string }>;
}
