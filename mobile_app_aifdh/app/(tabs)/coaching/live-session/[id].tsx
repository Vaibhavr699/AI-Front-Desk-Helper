import { useLocalSearchParams } from "expo-router";

import { SessionReviewScreen } from "@/src/features/in-home-session/screens/session-review-screen";

export default function LiveSessionReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionReviewScreen sessionId={id} />;
}
