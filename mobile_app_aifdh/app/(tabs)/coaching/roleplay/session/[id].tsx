import { useLocalSearchParams } from "expo-router";

import { LiveRoleplayScreen } from "@/src/features/roleplay/screens/live-roleplay-screen";

export default function LiveRoleplayRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LiveRoleplayScreen sessionId={String(id)} />;
}
