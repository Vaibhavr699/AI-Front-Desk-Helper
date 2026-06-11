import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchProfile,
  revokeTrustedDevice,
  updateCoachingDeliveryPrefs,
  updateRepHomeState,
  updateRepPhone,
} from "./api";
import type { CoachingDeliveryPrefs } from "./types";

export const settingsKeys = {
  all: ["settings"] as const,
  profile: () => [...settingsKeys.all, "profile"] as const,
};

export function useRepProfile() {
  return useQuery({
    queryKey: settingsKeys.profile(),
    queryFn: fetchProfile,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateCoachingDeliveryPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: CoachingDeliveryPrefs) =>
      updateCoachingDeliveryPrefs(prefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.profile() });
    },
  });
}

export function useUpdateRepPhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string | null) => updateRepPhone(phone),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.profile() });
    },
  });
}

export function useUpdateRepHomeState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (home_state: string | null) => updateRepHomeState(home_state),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.profile() });
    },
  });
}

export function useRevokeTrustedDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fingerprint: string) => revokeTrustedDevice(fingerprint),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.profile() });
    },
  });
}
