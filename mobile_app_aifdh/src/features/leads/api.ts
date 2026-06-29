import { api } from "@/src/shared/api/client";

import type {
  LeadDetail,
  LeadFilter,
  LeadsListResponse,
  VarianceCoaching,
} from "./types";

const PAGE_SIZE = 50;

type ListParams = {
  filter?: LeadFilter;
  search?: string;
  mine?: boolean;
  offset?: number;
  limit?: number;
};

export async function fetchLeads(params: ListParams = {}): Promise<LeadsListResponse> {
  const query: Record<string, string | number> = {
    limit: params.limit ?? PAGE_SIZE,
    offset: params.offset ?? 0,
  };
  if (params.filter && params.filter !== "all") query.filter = params.filter;
  if (params.search) query.q = params.search;
  if (params.mine) query.mine = "true";

  const { data } = await api.get<LeadsListResponse>("/rep/leads", { params: query });
  return data;
}

function toNumOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function fetchLeadDetail(leadId: string): Promise<LeadDetail> {
  const { data } = await api.get<LeadDetail>(`/rep/leads/${leadId}`);
  return {
    ...data,
    coaching_conversations: (data.coaching_conversations ?? []).map((c) => ({
      ...c,
      overall_score: toNumOrNull(c.overall_score),
      persona_confidence: toNumOrNull(c.persona_confidence),
    })),
  };
}

export async function enterQuote(
  leadId: string,
  totalCents: number,
): Promise<{ status: "ok"; variance_coaching: VarianceCoaching | null }> {
  const { data } = await api.post(`/rep/leads/${leadId}/quote-entered`, {
    total_cents: totalCents,
  });
  return data;
}

export async function sendBriefingToPhone(leadId: string): Promise<void> {
  await api.post(`/rep/leads/${leadId}/send-briefing`);
}
