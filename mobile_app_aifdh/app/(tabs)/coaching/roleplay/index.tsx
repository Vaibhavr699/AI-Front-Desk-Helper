import { useLocalSearchParams } from "expo-router";

import { RoleplayHubScreen } from "@/src/features/roleplay/screens/roleplay-hub-screen";

export default function RoleplayHubRoute() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  return (
    <RoleplayHubScreen
      focusDimension={typeof focus === "string" ? focus : undefined}
    />
  );
}
