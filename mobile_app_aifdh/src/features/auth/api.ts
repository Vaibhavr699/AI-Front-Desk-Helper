import { api } from "@/src/shared/api/client";

import type {
  LoginRequest,
  LoginResponse,
  OtpVerifyRequest,
  OtpVerifyResponse,
  ResendOtpRequest,
} from "./types";

export async function startStandaloneSignup(
  email: string,
): Promise<{ checkout_url: string }> {
  const { data } = await api.post<{ checkout_url: string }>("/rep/signup/checkout", {
    email,
  });
  return data;
}

export async function login(body: LoginRequest): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>("/rep/auth/login", body);
  return data;
}

export async function verifyOtp(body: OtpVerifyRequest): Promise<OtpVerifyResponse> {
  const { data } = await api.post<OtpVerifyResponse>("/rep/auth/verify-otp", body);
  return data;
}

export async function resendOtp(body: ResendOtpRequest): Promise<void> {
  await api.post("/rep/auth/resend-otp", body);
}

export async function logout(deviceFingerprint: string): Promise<void> {
  await api.post("/rep/auth/logout", { device_fingerprint: deviceFingerprint });
}
