export type ApiErrorBody = {
  error: string;
  code?: string;
};

export type SeatTier = "standard" | "pro" | "elite";

export type RepUser = {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  seat_tier: SeatTier;
};
