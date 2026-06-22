import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";

/** A single dot that bounces up and fades, staggered by `delay`. */
function Dot({ delay, color }: { delay: number; color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 360 }), // pause before the next cycle
        ),
        -1,
      ),
    );
  }, [delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * progress.value }],
    opacity: 0.4 + 0.6 * progress.value,
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/** The three staggered bouncing dots on their own, for reuse inside the inline
 *  "Thinking" toggle so it reads as live without a separate indicator row. */
export function ThinkingDots({ color }: { color: string }) {
  return (
    <View style={styles.dots}>
      <Dot delay={0} color={color} />
      <Dot delay={160} color={color} />
      <Dot delay={320} color={color} />
    </View>
  );
}

/**
 * Messaging-style typing indicator: an AI avatar followed by a bubble with three
 * bouncing dots and an optional state label ("Thinking", etc.). Rendered as a
 * normal chat row so it reads like a real incoming message.
 */
export function TypingIndicator({ label }: { label?: string }) {
  const colors = useThemeColors();

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.row}
    >
      <View style={[styles.avatar, { backgroundColor: colors.brandAccent }]} />
      <View style={[styles.bubble, { backgroundColor: colors.chatAiBubble }]}>
        <ThinkingDots color={colors.textSecondary} />
        {label ? (
          <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  avatar: { width: 28, height: 28, borderRadius: 14, marginTop: 2 },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dots: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
