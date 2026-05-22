import { useLocalSearchParams } from "expo-router";

import { RoleplayResultsScreen } from "@/src/features/roleplay/screens/roleplay-results-screen";

export default function ResultsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RoleplayResultsScreen sessionId={String(id)} />;
}
