import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { enterQuote, fetchLeadDetail, fetchLeads, sendBriefingToPhone } from "./api";
import type { LeadFilter } from "./types";

export const leadsKeys = {
  all: ["leads"] as const,
  list: (params: { filter: LeadFilter; search: string; mine: boolean }) =>
    [...leadsKeys.all, "list", params] as const,
  detail: (id: string) => [...leadsKeys.all, "detail", id] as const,
};

const PAGE_SIZE = 50;

type ListInput = {
  filter: LeadFilter;
  search: string;
  mine: boolean;
};

export function useLeadsList(input: ListInput) {
  return useInfiniteQuery({
    queryKey: leadsKeys.list(input),
    queryFn: ({ pageParam }) =>
      fetchLeads({
        filter: input.filter,
        search: input.search,
        mine: input.mine,
        offset: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.has_more ? last.offset + last.leads.length : undefined,
    staleTime: 30_000,
  });
}

export function useLeadDetail(leadId: string | null) {
  return useQuery({
    queryKey: leadId ? leadsKeys.detail(leadId) : ["leads", "detail", "_none"],
    queryFn: () => fetchLeadDetail(leadId as string),
    enabled: !!leadId,
    staleTime: 30_000,
  });
}

export function useSendBriefing(leadId: string) {
  return useMutation({
    mutationFn: () => sendBriefingToPhone(leadId),
  });
}

export function useEnterQuote(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (totalCents: number) => enterQuote(leadId, totalCents),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsKeys.detail(leadId) });
    },
  });
}
