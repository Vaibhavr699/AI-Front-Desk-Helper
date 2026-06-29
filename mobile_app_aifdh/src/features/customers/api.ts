import { api } from "@/src/shared/api/client";

import type { CreateCustomerInput, UpdateCustomerInput } from "./types";

export async function createCustomer(input: CreateCustomerInput) {
  const { data } = await api.post("/rep/leads", input);
  return data as { lead: Record<string, unknown>; created: boolean };
}

export async function updateCustomer(id: string, input: UpdateCustomerInput) {
  const { data } = await api.patch(`/rep/leads/${id}`, input);
  return data as { lead: Record<string, unknown> };
}
