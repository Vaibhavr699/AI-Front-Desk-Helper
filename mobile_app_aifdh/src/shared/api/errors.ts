import type { ApiErrorBody } from "@/src/shared/types/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  static fromAxios(err: unknown): ApiError {
    const e = err as {
      response?: { status: number; data?: ApiErrorBody };
      request?: unknown;
      message?: string;
    };
    if (e?.response) {
      return new ApiError(
        e.response.data?.error ?? "Request failed",
        e.response.status,
        e.response.data?.code,
      );
    }
    if (e?.request) return new ApiError("Network error", 0);
    return new ApiError(e?.message ?? "Unknown error", 0);
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
