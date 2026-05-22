import { create } from "zustand";

import { STORAGE_KEYS } from "@/src/config/constants";
import { api, authTokenHolder } from "@/src/shared/api/client";
import { isApiError } from "@/src/shared/api/errors";
import { secureStorage } from "@/src/shared/storage/secure-store";
import type { RepUser } from "@/src/shared/types/api";

import * as authApi from "./api";
import {
  authenticateWithBiometric,
  getBiometricCapability,
  readBiometricEnrolled,
  readBiometricType,
  writeBiometricEnrollment,
  type BiometricType,
} from "./biometric";
import { getOrCreateDeviceFingerprint } from "./device";
import type { EnrollmentPayload, TrustedDevicePayload } from "./types";

export type AuthStatus =
  | "booting"
  | "unauthenticated"
  | "awaiting_totp"
  | "authenticated";

type AuthState = {
  status: AuthStatus;
  user: RepUser | null;
  sessionToken: string | null;
  challengeToken: string | null;
  enrollment: EnrollmentPayload | null;
  pendingEmail: string | null;
  lastError: string | null;
  isBusy: boolean;
  biometricEnrolled: boolean;
  biometricType: BiometricType | null;
  isUnlocked: boolean;
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  verifyTotp: (code: string, trustDevice: boolean) => Promise<void>;
  cancelTotp: () => void;
  signOut: () => Promise<void>;
  unlock: () => Promise<{ success: boolean; cancelled: boolean }>;
  enrollBiometric: () => Promise<{ success: boolean; reason?: string }>;
  disableBiometric: () => Promise<void>;
  clearError: () => void;
};

async function persistSession(token: string, user: RepUser): Promise<void> {
  await secureStorage.set(STORAGE_KEYS.sessionToken, token);
  await secureStorage.setJson(STORAGE_KEYS.currentUser, user);
  authTokenHolder.set(token);
}

async function persistTrustedDevice(
  payload: TrustedDevicePayload | null,
): Promise<void> {
  if (!payload) return;
  await secureStorage.set(STORAGE_KEYS.trustedDeviceToken, payload.token);
}

async function clearSession(): Promise<void> {
  await Promise.all([
    secureStorage.remove(STORAGE_KEYS.sessionToken),
    secureStorage.remove(STORAGE_KEYS.currentUser),
  ]);
  authTokenHolder.set(null);
}

function toMessage(err: unknown): string {
  if (isApiError(err)) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

async function pingBiometricVerify(biometricType: BiometricType | null) {
  try {
    const fingerprint = await getOrCreateDeviceFingerprint();
    await api.post("/rep/auth/biometric-verify", {
      device_fingerprint: fingerprint,
      biometric_type: biometricType,
    });
  } catch {}
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "booting",
  user: null,
  sessionToken: null,
  challengeToken: null,
  enrollment: null,
  pendingEmail: null,
  lastError: null,
  isBusy: false,
  biometricEnrolled: false,
  biometricType: null,
  isUnlocked: false,

  hydrate: async () => {
    const [token, user, enrolled, biometricType] = await Promise.all([
      secureStorage.get(STORAGE_KEYS.sessionToken),
      secureStorage.getJson<RepUser>(STORAGE_KEYS.currentUser),
      readBiometricEnrolled(),
      readBiometricType(),
    ]);
    if (token && user) {
      authTokenHolder.set(token);
      set({
        status: "authenticated",
        sessionToken: token,
        user,
        biometricEnrolled: enrolled,
        biometricType,
        isUnlocked: !enrolled,
      });
      return;
    }
    set({
      status: "unauthenticated",
      biometricEnrolled: enrolled,
      biometricType,
      isUnlocked: false,
    });
  },

  signIn: async (email, password) => {
    set({ isBusy: true, lastError: null });
    try {
      const fingerprint = await getOrCreateDeviceFingerprint();
      const trustedDeviceToken = await secureStorage.get(
        STORAGE_KEYS.trustedDeviceToken,
      );
      const response = await authApi.login({
        email: email.trim().toLowerCase(),
        password,
        device_fingerprint: fingerprint,
        trusted_device_token: trustedDeviceToken ?? undefined,
      });
      if (response.status === "ok") {
        await persistSession(response.token, response.user);
        set({
          status: "authenticated",
          user: response.user,
          sessionToken: response.token,
          challengeToken: null,
          enrollment: null,
          pendingEmail: null,
          isBusy: false,
          isUnlocked: true,
        });
        return;
      }
      set({
        status: "awaiting_totp",
        challengeToken: response.challenge_token,
        enrollment: response.enroll,
        pendingEmail: email.trim().toLowerCase(),
        isBusy: false,
      });
    } catch (err) {
      set({ isBusy: false, lastError: toMessage(err) });
    }
  },

  verifyTotp: async (code, trustDevice) => {
    const challenge = get().challengeToken;
    if (!challenge) {
      set({ lastError: "Session expired. Please sign in again." });
      return;
    }
    set({ isBusy: true, lastError: null });
    try {
      const fingerprint = await getOrCreateDeviceFingerprint();
      const response = await authApi.verifyTotp({
        challenge_token: challenge,
        code: code.trim(),
        device_fingerprint: fingerprint,
        trust_this_device: trustDevice,
      });
      await persistSession(response.token, response.user);
      await persistTrustedDevice(response.trusted_device);
      set({
        status: "authenticated",
        user: response.user,
        sessionToken: response.token,
        challengeToken: null,
        enrollment: null,
        pendingEmail: null,
        isBusy: false,
        isUnlocked: true,
      });
    } catch (err) {
      set({ isBusy: false, lastError: toMessage(err) });
    }
  },

  cancelTotp: () => {
    set({
      status: "unauthenticated",
      challengeToken: null,
      enrollment: null,
      pendingEmail: null,
      lastError: null,
    });
  },

  signOut: async () => {
    set({ isBusy: true });
    try {
      const fingerprint = await getOrCreateDeviceFingerprint();
      try {
        await authApi.logout(fingerprint);
      } catch {}
      await clearSession();
      set({
        status: "unauthenticated",
        user: null,
        sessionToken: null,
        challengeToken: null,
        enrollment: null,
        pendingEmail: null,
        lastError: null,
        isBusy: false,
        isUnlocked: false,
      });
    } catch (err) {
      set({ isBusy: false, lastError: toMessage(err) });
    }
  },

  unlock: async () => {
    const { biometricType } = get();
    const cap = await getBiometricCapability();
    if (!cap.hasHardware || !cap.hasEnrolledInOs) {
      set({ lastError: `${cap.label} is not available on this device.` });
      return { success: false, cancelled: false };
    }
    const result = await authenticateWithBiometric(
      `Unlock AI Rep Coach`,
    );
    if (result.success) {
      set({ isUnlocked: true, lastError: null });
      pingBiometricVerify(biometricType ?? cap.type);
      return { success: true, cancelled: false };
    }
    if (!result.cancelled) {
      set({ lastError: "Biometric check failed. Try again or sign in with your password." });
    }
    return { success: false, cancelled: result.cancelled };
  },

  enrollBiometric: async () => {
    const cap = await getBiometricCapability();
    if (!cap.hasHardware) {
      return { success: false, reason: "This device has no biometric hardware." };
    }
    if (!cap.hasEnrolledInOs) {
      return {
        success: false,
        reason: `${cap.label} is not set up on this device yet. Add it in your device settings first.`,
      };
    }
    const result = await authenticateWithBiometric(
      `Enable ${cap.label} for AI Rep Coach`,
    );
    if (!result.success) {
      return {
        success: false,
        reason: result.cancelled ? undefined : "Biometric check failed.",
      };
    }
    await writeBiometricEnrollment(true, cap.type);
    set({ biometricEnrolled: true, biometricType: cap.type });
    return { success: true };
  },

  disableBiometric: async () => {
    await writeBiometricEnrollment(false, null);
    set({ biometricEnrolled: false, biometricType: null, isUnlocked: true });
  },

  clearError: () => set({ lastError: null }),
}));
