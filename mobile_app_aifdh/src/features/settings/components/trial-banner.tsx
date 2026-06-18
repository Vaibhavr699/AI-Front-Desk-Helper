import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useRepProfile } from "../queries";

function daysRemaining(trialEndsAt: string): number {
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function TrialBanner() {
  const { data } = useRepProfile();
  const seat = data?.seat;

  if (seat?.account_type !== "standalone" || !seat?.trial_ends_at) return null;

  const days = daysRemaining(seat.trial_ends_at);
  const ended = days <= 0;
  const urgent = days <= 3;

  return (
    <View
      className={`flex-row items-center gap-2 rounded-sm px-3 py-2 ${
        ended || urgent ? "bg-amber-50" : "bg-brand-50"
      }`}
    >
      <Ionicons
        name={ended ? "alert-circle" : "time-outline"}
        size={15}
        color={ended || urgent ? "#d97706" : "#2563eb"}
      />
      <Text
        className={`flex-1 text-xs font-medium ${
          ended || urgent ? "text-amber-800" : "text-brand-700"
        }`}
      >
        {ended
          ? "Your free trial has ended — billing starts on your card on file."
          : days === 1
            ? "1 day left in your free trial."
            : `${days} days left in your free trial.`}
      </Text>
    </View>
  );
}
