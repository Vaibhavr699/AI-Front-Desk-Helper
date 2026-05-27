import { useMutation, useQueryClient } from "@tanstack/react-query";

import { leadsKeys } from "@/src/features/leads/queries";

import { createCustomer, updateCustomer } from "./api";
import type { CreateCustomerInput, UpdateCustomerInput } from "./types";

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => createCustomer(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsKeys.all });
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCustomerInput }) =>
      updateCustomer(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsKeys.all });
    },
  });
}
