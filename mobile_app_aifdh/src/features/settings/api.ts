import { api } from "@/src/shared/api/client";

import type { CoachingDeliveryPrefs, RepProfile } from "./types";

export async function fetchProfile(): Promise<RepProfile> {
  const { data } = await api.get<RepProfile>("/rep/profile");
  return data;
}

export async function updateCoachingDeliveryPrefs(
  prefs: CoachingDeliveryPrefs,
): Promise<void> {
  await api.patch("/rep/profile", { coaching_delivery_prefs: prefs });
}

export async function revokeTrustedDevice(fingerprint: string): Promise<void> {
  await api.post("/rep/auth/logout", { device_fingerprint: fingerprint });
}
