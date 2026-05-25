import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";

import type { CoachingAlert, CoachingAlertUrgency } from "../types";

type Props = {
  cue: CoachingAlert | null;
  onDismiss: (cueId: string) => void;
};

const AUTO_DISMISS_MS = 8_000;

const URGENCY_STYLE: Record<
  CoachingAlertUrgency,
  { bg: string; text: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }
> = {
  green: { bg: "#ecfdf5", text: "#065f46", icon: "checkmark-circle", iconColor: "#059669" },
  yellow: { bg: "#fffbeb", text: "#92400e", icon: "information-circle", iconColor: "#d97706" },
  orange: { bg: "#fff7ed", text: "#9a3412", icon: "alert-circle", iconColor: "#ea580c" },
  red: { bg: "#fef2f2", text: "#991b1b", icon: "warning", iconColor: "#dc2626" },
};

const HAPTIC_MAP: Record<string, () => void> = {
  single_tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  double_tap: () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 120);
  },
  long_buzz: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
};

export function CueOverlayBanner({ cue, onDismiss }: Props) {
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!cue) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -120, duration: 250, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
      return;
    }

    if (cue.vibration && HAPTIC_MAP[cue.vibration]) {
      HAPTIC_MAP[cue.vibration]();
    }

    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onDismiss(cue.id);
    }, AUTO_DISMISS_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cue?.id]);

  if (!cue) return null;

  const style = URGENCY_STYLE[cue.urgency];

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999,
        transform: [{ translateY: slideAnim }],
        opacity: opacityAnim,
      }}
    >
      <Pressable onPress={() => onDismiss(cue.id)}>
        <View
          style={{
            backgroundColor: style.bg,
            marginHorizontal: 12,
            marginTop: 8,
            borderRadius: 16,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <Ionicons name={style.icon} size={22} color={style.iconColor} />
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontSize: 14, fontWeight: "700", color: style.text }}
              numberOfLines={1}
            >
              {cue.watch_label ? `${cue.watch_label} — ` : ""}{cue.headline}
            </Text>
            {cue.full_text ? (
              <Text
                style={{ fontSize: 12, color: style.text, opacity: 0.8, marginTop: 2 }}
                numberOfLines={2}
              >
                {cue.full_text}
              </Text>
            ) : null}
          </View>
          <Ionicons name="close" size={16} color={style.text} />
        </View>
      </Pressable>
    </Animated.View>
  );
}
