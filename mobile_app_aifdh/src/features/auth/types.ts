import type { RepUser } from "@/src/shared/types/api";

export type LoginRequest = {
  email: string;
  password: string;
  device_fingerprint: string;
  trusted_device_token?: string;
};

export type EnrollmentPayload = {
  otpauth_uri: string;
  secret: string;
};

export type LoginResponse =
  | { status: "ok"; token: string; user: RepUser }
  | {
      status: "totp_required";
      challenge_token: string;
      enroll: EnrollmentPayload | null;
    };

export type TotpRequest = {
  challenge_token: string;
  code: string;
  device_fingerprint: string;
  biometric_type?: string;
  trust_this_device?: boolean;
};

export type TrustedDevicePayload = {
  token: string;
  expires_at: string;
};

export type TotpResponse = {
  status: "ok";
  token: string;
  trusted_device: TrustedDevicePayload | null;
  user: RepUser;
};
