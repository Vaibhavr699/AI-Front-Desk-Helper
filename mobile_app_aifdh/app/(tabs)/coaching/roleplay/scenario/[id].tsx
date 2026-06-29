import { useLocalSearchParams } from "expo-router";

import { ScenarioSelectionScreen } from "@/src/features/roleplay/screens/scenario-selection-screen";

export default function ScenarioSelectionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScenarioSelectionScreen scenarioId={String(id)} />;
}
