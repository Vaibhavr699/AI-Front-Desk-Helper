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

export async function updateRepPhone(phone: string | null): Promise<void> {
  await api.patch("/rep/profile", { phone });
}

export async function updateRepHomeState(home_state: string | null): Promise<void> {
  await api.patch("/rep/profile", { home_state });
}

export async function revokeTrustedDevice(fingerprint: string): Promise<void> {
  await api.post("/rep/auth/logout", { device_fingerprint: fingerprint });
}

export async function uploadAvatar(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}): Promise<{ avatar_url: string | null }> {
  const mimeType = asset.mimeType ?? "image/jpeg";
  const name = asset.fileName ?? `avatar.${mimeType.split("/")[1] ?? "jpg"}`;
  const form = new FormData();
  form.append("avatar", {
    uri: asset.uri,
    name,
    type: mimeType,
  } as unknown as Blob);
  const { data } = await api.post<{ avatar_url: string | null }>(
    "/rep/profile/avatar",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function removeAvatar(): Promise<void> {
  await api.delete("/rep/profile/avatar");
}
