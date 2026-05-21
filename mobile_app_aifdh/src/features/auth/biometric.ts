import * as LocalAuthentication from "expo-local-authentication";

import { secureStorage } from "@/src/shared/storage/secure-store";

const BIOMETRIC_ENROLLED_KEY = "aifdh.biometric_enrolled";
const BIOMETRIC_TYPE_KEY = "aifdh.biometric_type";

export type BiometricType = "face_id" | "touch_id" | "iris" | "biometric";

export type BiometricCapability = {
  hasHardware: boolean;
  hasEnrolledInOs: boolean;
  type: BiometricType | null;
  label: string;
};

const LABELS: Record<BiometricType, string> = {
  face_id: "Face ID",
  touch_id: "Touch ID",
  iris: "Iris",
  biometric: "Biometric",
};

export async function getBiometricCapability(): Promise<BiometricCapability> {
  const [hasHardware, hasEnrolledInOs, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  let type: BiometricType | null = null;
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    type = "face_id";
  } else if (
    types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
  ) {
    type = "touch_id";
  } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    type = "iris";
  } else if (types.length > 0) {
    type = "biometric";
  }

  return {
    hasHardware,
    hasEnrolledInOs,
    type,
    label: type ? LABELS[type] : "Biometric",
  };
}

export async function authenticateWithBiometric(reason: string): Promise<{
  success: boolean;
  cancelled: boolean;
  error?: string;
}> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    fallbackLabel: "Use passcode",
  });
  if (result.success) return { success: true, cancelled: false };
  const cancelled =
    "error" in result &&
    typeof result.error === "string" &&
    (result.error === "user_cancel" ||
      result.error === "system_cancel" ||
      result.error === "app_cancel");
  return {
    success: false,
    cancelled,
    error: "error" in result ? result.error : undefined,
  };
}

export async function readBiometricEnrolled(): Promise<boolean> {
  const value = await secureStorage.get(BIOMETRIC_ENROLLED_KEY);
  return value === "true";
}

export async function readBiometricType(): Promise<BiometricType | null> {
  const value = await secureStorage.get(BIOMETRIC_TYPE_KEY);
  if (!value) return null;
  return value as BiometricType;
}

export async function writeBiometricEnrollment(
  enrolled: boolean,
  type: BiometricType | null,
): Promise<void> {
  await secureStorage.set(BIOMETRIC_ENROLLED_KEY, enrolled ? "true" : "false");
  if (enrolled && type) {
    await secureStorage.set(BIOMETRIC_TYPE_KEY, type);
  } else if (!enrolled) {
    await secureStorage.remove(BIOMETRIC_TYPE_KEY);
  }
}
