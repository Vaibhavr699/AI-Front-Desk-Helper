import * as Crypto from "expo-crypto";

import { STORAGE_KEYS } from "@/src/config/constants";
import { secureStorage } from "@/src/shared/storage/secure-store";

export async function getOrCreateDeviceFingerprint(): Promise<string> {
  const existing = await secureStorage.get(STORAGE_KEYS.deviceFingerprint);
  if (existing) return existing;
  const fingerprint = Crypto.randomUUID();
  await secureStorage.set(STORAGE_KEYS.deviceFingerprint, fingerprint);
  return fingerprint;
}
