import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, withSequence, Easing, type SharedValue } from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";

// One pulsing block. All bars share a single driver value so the whole screen
// breathes in sync rather than a mess of out-of-phase fades.
function Bar({ progress, color, style }: { progress: SharedValue<number>; color: string; style?: any }) {
  const animStyle = useAnimatedStyle(() => ({ opacity: 0.35 + progress.value * 0.4 }));
  return <Animated.View style={[{ backgroundColor: color, borderRadius: 6 }, style, animStyle]} />;
}

// A single placeholder row mimicking a chat bubble — AI rows carry an avatar and
// sit left, user rows sit right with no avatar (matches the real message layout).
function SkeletonRow({ progress, role, lines, bubbleColor, blockColor }: { progress: SharedValue<number>; role: "ai" | "user"; lines: number[]; bubbleColor: string; blockColor: string }) {
  const isUser = role === "user";
  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.aiRow]}>
      {!isUser && <Bar progress={progress} color={blockColor} style={styles.avatar} />}
      <View style={[styles.bubble, { backgroundColor: bubbleColor }]}>
        {lines.map((w, i) => (
          <Bar key={i} progress={progress} color={blockColor} style={[styles.line, { width: w, marginBottom: i === lines.length - 1 ? 0 : 8 }]} />
        ))}
      </View>
    </View>
  );
}

/**
 * Shimmering placeholder shown while the chat history loads from cache/server,
 * so the screen reads as "loading" instead of a blank void. Laid out to echo the
 * real conversation: alternating AI/user bubbles with an avatar on the AI side.
 */
export function ChatSkeleton() {
  const colors = useThemeColors();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [progress]);

  return (
    <View style={styles.container} pointerEvents="none" accessibilityLabel="Loading conversation">
      <SkeletonRow progress={progress} role="ai" lines={[180, 210, 130]} bubbleColor={colors.chatAiBubble} blockColor={colors.bgSurface} />
      <SkeletonRow progress={progress} role="user" lines={[160, 90]} bubbleColor={colors.chatUserBubble} blockColor="#FFFFFF" />
      <SkeletonRow progress={progress} role="ai" lines={[200, 170, 190, 110]} bubbleColor={colors.chatAiBubble} blockColor={colors.bgSurface} />
      <SkeletonRow progress={progress} role="user" lines={[120]} bubbleColor={colors.chatUserBubble} blockColor="#FFFFFF" />
      <SkeletonRow progress={progress} role="ai" lines={[190, 150]} bubbleColor={colors.chatAiBubble} blockColor={colors.bgSurface} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 14 },
  row: { flexDirection: "row", gap: 8 },
  aiRow: { justifyContent: "flex-start", alignItems: "flex-start" },
  userRow: { justifyContent: "flex-end" },
  avatar: { width: 28, height: 28, borderRadius: 14, marginTop: 2 },
  bubble: { maxWidth: "75%", borderRadius: 16, padding: 12 },
  line: { height: 12, maxWidth: "100%" },
});
