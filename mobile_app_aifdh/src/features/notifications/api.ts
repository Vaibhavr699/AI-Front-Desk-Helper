import { api } from "@/src/shared/api/client";

export async function registerPushToken(token: string): Promise<void> {
  await api.post("/rep/push-token", { expo_push_token: token });
}
