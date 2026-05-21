import { useQuery } from "@tanstack/react-query";

import { fetchTodayAppointments } from "./api";

export const appointmentsKeys = {
  all: ["appointments"] as const,
  today: () => [...appointmentsKeys.all, "today"] as const,
};

export function useTodayAppointments() {
  return useQuery({
    queryKey: appointmentsKeys.today(),
    queryFn: fetchTodayAppointments,
    staleTime: 60_000,
  });
}
