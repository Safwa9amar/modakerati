import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

// A brief, non-blocking celebratory pill fired when the word count crosses a
// round milestone. Fades up, holds ~2.2s, fades out, then calls onDone so the
// parent clears it. Remount it (key on the count) to replay the animation.
// pointerEvents:none — it must never intercept touches on the doc below.
export function MilestoneToast({ count, onDone }: { count: number; onDone: () => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
    opacity.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      withDelay(
        2200,
        withTiming(0, { duration: 280 }, (finished) => {
          if (finished) runOnJS(onDone)();
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.toast, { backgroundColor: colors.bgModal, borderColor: colors.borderDefault }, animStyle]}
    >
      <Text style={[styles.text, { color: colors.textPrimary }]}>
        {t("workspace.milestoneWords", {
          count: count.toLocaleString(),
          defaultValue: "🎉 {{count}} words!",
        })}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    // Soft lift so it reads as a floating notification, not a doc element.
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
