import type { RepUser } from "@/src/shared/types/api";

export type LoginRequest = {
  email: string;
  password: string;
  device_fingerprint: string;
  trusted_device_token?: string;
};

export type LoginResponse =
  | { status: "ok"; token: string; user: RepUser }
  | { status: "otp_required"; challenge_token: string };

export type OtpVerifyRequest = {
  challenge_token: string;
  code: string;
  device_fingerprint: string;
  biometric_type?: string;
  trust_this_device?: boolean;
};

export type ResendOtpRequest = {
  challenge_token: string;
};

export type TrustedDevicePayload = {
  token: string;
  expires_at: string;
};

export type OtpVerifyResponse = {
  status: "ok";
  token: string;
  trusted_device: TrustedDevicePayload | null;
  user: RepUser;
};
