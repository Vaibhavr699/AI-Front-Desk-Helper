import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchProfile,
  revokeTrustedDevice,
  updateCoachingDeliveryPrefs,
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
    staleTime: 60_000,
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

export function useRevokeTrustedDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fingerprint: string) => revokeTrustedDevice(fingerprint),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.profile() });
    },
  });
}
