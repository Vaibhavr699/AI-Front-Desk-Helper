import { api } from "@/src/shared/api/client";

import type { TodayAppointmentsResponse } from "./types";

export async function fetchTodayAppointments(): Promise<TodayAppointmentsResponse> {
  const { data } = await api.get<TodayAppointmentsResponse>(
    "/rep/appointments/today",
  );
  return data;
}
