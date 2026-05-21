import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { RepProfile } from "../types";

type Props = {
  profile: RepProfile;
};

function initials(email: string): string {
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TIER_LABELS: Record<string, { label: string; price: string; bg: string; text: string }> = {
  standard: { label: "Standard", price: "$119", bg: "bg-slate-100", text: "text-slate-700" },
  pro: { label: "Pro", price: "$199", bg: "bg-brand-100", text: "text-brand-700" },
  elite: { label: "Elite", price: "$249", bg: "bg-amber-100", text: "text-amber-700" },
};

export function ProfileCard({ profile }: Props) {
  const tier = TIER_LABELS[profile.seat.tier] ?? TIER_LABELS.standard;
  return (
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-4">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-100">
          <Text className="text-xl font-bold text-brand-700">
            {initials(profile.email)}
          </Text>
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-ink-primary" numberOfLines={1}>
            {profile.email}
          </Text>
          <Text className="text-sm capitalize text-ink-muted">
            {profile.role}
            {profile.tenant.name ? ` · ${profile.tenant.name}` : ""}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <View className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${tier.bg}`}>
          <Ionicons name="ribbon" size={12} color={colors.brand[700]} />
          <Text className={`text-xs font-semibold ${tier.text}`}>
            {tier.label} seat · {tier.price}/mo
          </Text>
        </View>
        {profile.tenant.business_type ? (
          <View className="rounded-full bg-slate-100 px-3 py-1.5">
            <Text className="text-xs font-medium text-slate-700">
              {profile.tenant.business_type}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="border-t border-surface-divider pt-3">
        <Text className="text-xs text-ink-muted">
          Last app open · {formatLastSeen(profile.last_app_open_at)}
        </Text>
      </View>
    </View>
  );
}
