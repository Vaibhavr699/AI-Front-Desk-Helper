import { useLocalSearchParams } from "expo-router";

import { ConversationReviewScreen } from "@/src/features/coaching/screens/conversation-review-screen";

export default function ConversationReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ConversationReviewScreen id={id} />;
}
