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
 * The "an answer is coming" row: three bouncing dots and an optional state label
 * ("Thinking", etc.).
 *
 * Bare, on the page — no avatar and no bubble, because the answer it stands in
 * for has neither (see components/chat/MessageBubble). A tinted card here would
 * be the only bubble on the assistant's side of the transcript, and it would pop
 * out of existence the moment the first token replaced it with plain prose.
 */
export function TypingIndicator({ label }: { label?: string }) {
  const colors = useThemeColors();

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.row}
    >
      <ThinkingDots color={colors.textSecondary} />
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 6 },
  dots: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
