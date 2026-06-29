import { useMutation, useQueryClient } from "@tanstack/react-query";

import { leadsKeys } from "@/src/features/leads/queries";

import { createCustomer, updateCustomer } from "./api";
import type { CreateCustomerInput, UpdateCustomerInput } from "./types";

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => createCustomer(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...leadsKeys.all, "list"] });
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCustomerInput }) =>
      updateCustomer(id, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: [...leadsKeys.all, "list"] });
      qc.invalidateQueries({ queryKey: leadsKeys.detail(variables.id) });
    },
  });
}
