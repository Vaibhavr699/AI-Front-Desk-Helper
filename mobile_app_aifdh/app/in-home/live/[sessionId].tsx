import { useLocalSearchParams } from "expo-router";

import { LiveSessionScreen } from "@/src/features/in-home-session/screens/live-session-screen";

export default function LiveSessionRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return <LiveSessionScreen sessionId={String(sessionId)} />;
}
