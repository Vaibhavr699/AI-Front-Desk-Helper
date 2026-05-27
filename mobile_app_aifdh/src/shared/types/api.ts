export type ApiErrorBody = {
  error: string;
  code?: string;
};

export type SeatTier = "standard" | "pro" | "elite";

export type TenantFlags = {
  rep_coach_enabled: boolean;
  aifdh_enabled: boolean;
};

export type RepUser = {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  seat_tier: SeatTier;
  tenant_flags?: TenantFlags;
};
