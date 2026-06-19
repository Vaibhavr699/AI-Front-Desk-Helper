import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { RepProfile } from "../types";
import { AvatarPicker } from "./avatar-picker";

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

const TIER_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  standard: { label: "Standard", bg: "bg-slate-100", text: "text-slate-700" },
  pro: { label: "Pro", bg: "bg-brand-100", text: "text-brand-700" },
  elite: { label: "Elite", bg: "bg-amber-100", text: "text-amber-700" },
};

function roleLabel(role: string): string {
  if (role === "admin") return "Account owner";
  if (role === "manager") return "Manager";
  return "Sales rep";
}

function trialDaysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

export function ProfileCard({ profile }: Props) {
  const tier = TIER_LABELS[profile.seat.tier] ?? TIER_LABELS.standard;
  const isStandalone = profile.seat.account_type === "standalone";
  const company =
    !isStandalone && profile.tenant.name ? profile.tenant.name : null;
  const daysLeft = trialDaysLeft(profile.seat.trial_ends_at);

  return (
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-4">
        <AvatarPicker avatarUrl={profile.avatar_url} initials={initials(profile.email)} />
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-ink-primary" numberOfLines={1}>
            {profile.email}
          </Text>
          <Text className="text-sm text-ink-muted" numberOfLines={1}>
            {company ? `${roleLabel(profile.role)} · ${company}` : roleLabel(profile.role)}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <View className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${tier.bg}`}>
          <Ionicons name="ribbon" size={12} color={colors.brand[700]} />
          <Text className={`text-xs font-semibold ${tier.text}`}>
            {tier.label} plan
          </Text>
        </View>
        {daysLeft !== null ? (
          <View className="flex-row items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5">
            <Ionicons name="time-outline" size={12} color="#047857" />
            <Text className="text-xs font-semibold text-emerald-700">
              {daysLeft > 0 ? `${daysLeft}-day trial` : "Trial ended"}
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
