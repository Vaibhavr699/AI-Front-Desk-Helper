import { api } from "@/src/shared/api/client";

import type {
  LoginRequest,
  LoginResponse,
  TotpRequest,
  TotpResponse,
} from "./types";

export async function login(body: LoginRequest): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>("/rep/auth/login", body);
  return data;
}

export async function verifyTotp(body: TotpRequest): Promise<TotpResponse> {
  const { data } = await api.post<TotpResponse>("/rep/auth/totp", body);
  return data;
}

export async function logout(deviceFingerprint: string): Promise<void> {
  await api.post("/rep/auth/logout", { device_fingerprint: deviceFingerprint });
}
