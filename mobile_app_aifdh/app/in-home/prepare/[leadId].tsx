import { useLocalSearchParams } from "expo-router";

import { PreSessionScreen } from "@/src/features/in-home-session/screens/pre-session-screen";

export default function PrepareRoute() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  return <PreSessionScreen leadId={String(leadId)} />;
}
