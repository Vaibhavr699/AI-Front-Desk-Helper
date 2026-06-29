import { useLocalSearchParams } from "expo-router";

import { LeadDetailScreen } from "@/src/features/leads/screens/lead-detail-screen";

export default function LeadDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LeadDetailScreen leadId={String(id)} />;
}
