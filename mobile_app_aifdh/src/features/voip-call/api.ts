import { api } from "@/src/shared/api/client";

export async function initiateCall(leadId: string) {
  const { data } = await api.post("/rep/call/initiate", { lead_id: leadId });
  return data as { call_sid: string; conference: string; status: string; lead_name: string | null };
}

export async function getCallStatus(callSid: string) {
  const { data } = await api.get(`/rep/call/${callSid}/status`);
  return data as { status: string; duration: string | null };
}

export async function endCall(callSid: string) {
  const { data } = await api.post(`/rep/call/${callSid}/end`);
  return data as { status: string };
}
