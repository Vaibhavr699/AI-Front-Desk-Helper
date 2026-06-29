import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTenantFlags } from "@/src/features/auth/store";
import { CreateCustomerFab } from "@/src/features/customers/components/create-customer-fab";
import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { FilterChips } from "../components/filter-chips";
import { LeadCard } from "../components/lead-card";
import { useLeadDetail, useLeadsList } from "../queries";
import type { LeadFilter, LeadSummary } from "../types";

import { LeadDetailBody } from "./lead-detail-screen";

export function LeadsListScreen() {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { rep_coach_enabled } = useTenantFlags();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<LeadFilter>("all");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useLeadsList({ filter, search: debouncedSearch, mine: true });

  const leads: LeadSummary[] =
    data?.pages.flatMap((page) => page.leads) ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [filter, debouncedSearch]);

  useEffect(() => {
    if (isTablet && leads.length > 0 && !selectedId) {
      setSelectedId(leads[0].id);
    }
  }, [isTablet, leads, selectedId]);

  const handlePress = useCallback(
    (lead: LeadSummary) => {
      if (isTablet) {
        setSelectedId(lead.id);
      } else {
        router.push(`/(tabs)/leads/${lead.id}`);
      }
    },
    [isTablet, router],
  );

  const renderLead = useCallback(
    ({ item }: { item: LeadSummary }) => (
      <LeadCard
        lead={item}
        selected={isTablet && item.id === selectedId}
        onPress={handlePress}
      />
    ),
    [isTablet, selectedId, handlePress],
  );

  const list = (
    <FlatList
      data={leads}
      className="flex-1"
      keyExtractor={(l) => l.id}
      contentContainerClassName="gap-3 px-4 pb-8 pt-2"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={colors.brand[600]}
        />
      }
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      renderItem={renderLead}
      ListFooterComponent={
        isFetchingNextPage ? (
          <View className="py-4">
            <ActivityIndicator color={colors.brand[600]} />
          </View>
        ) : null
      }
    />
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <Header />
      <SearchBar value={searchInput} onChange={setSearchInput} />
      <FilterChips value={filter} onChange={setFilter} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError ? (
        <ErrorState message={extractMessage(error)} onRetry={refetch} />
      ) : leads.length === 0 ? (
        <EmptyState />
      ) : isTablet ? (
        <View className="flex-1 flex-row">
          <View
            className="w-[478px]"
            style={{
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: colors.surface.divider,
            }}
          >
            {list}
          </View>
          <View className="flex-1">
            <TabletDetailPane leadId={selectedId} />
          </View>
        </View>
      ) : (
        list
      )}
      {rep_coach_enabled && <CreateCustomerFab />}
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View className="px-6 pb-3 pt-6 md:px-8">
      <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
        Conversations
      </Text>
      <Text className="mt-1 text-3xl font-bold text-ink-primary">Leads</Text>
    </View>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View className="px-4 pb-3">
      <View className="flex-row items-center gap-2 rounded-sm border border-surface-border bg-white px-3">
        <Ionicons name="search-outline" size={18} color={colors.ink.muted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Search name or phone"
          placeholderTextColor={colors.ink.dim}
          autoCapitalize="none"
          autoCorrect={false}
          className="h-11 flex-1 text-base text-ink-primary"
        />
        {value.length > 0 ? (
          <Pressable onPress={() => onChange("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.ink.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TabletDetailPane({ leadId }: { leadId: string | null }) {
  const { data, isLoading, isError, error, refetch } = useLeadDetail(leadId);

  if (!leadId) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="hand-left-outline" size={32} color={colors.ink.muted} />
        <Text className="mt-3 text-base text-ink-muted">
          Select a lead to preview
        </Text>
      </View>
    );
  }
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.brand[600]} />
      </View>
    );
  }
  if (isError || !data) {
    return <ErrorState message={extractMessage(error)} onRetry={refetch} />;
  }
  return <LeadDetailBody lead={data} />;
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
        <Ionicons name="people-outline" size={32} color={colors.ink.muted} />
      </View>
      <Text className="text-lg font-semibold text-ink-primary">
        No leads found
      </Text>
      <Text className="text-center text-sm text-ink-muted">
        Try a different search or check back later.
      </Text>
    </View>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Ionicons name="alert-circle-outline" size={32} color="#dc2626" />
      <Text className="text-base font-semibold text-ink-primary">
        Couldn't load leads
      </Text>
      <Text className="text-center text-sm text-ink-muted">{message}</Text>
      <Pressable
        onPress={onRetry}
        className="h-11 items-center justify-center rounded-xl bg-brand-600 px-6 active:bg-brand-700"
      >
        <Text className="text-sm font-semibold text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Please check your connection and try again.";
}
