import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonGroup, SkeletonLines } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/useThemeColors";

// A single placeholder row mimicking a chat bubble — AI rows carry an avatar and
// sit left, user rows sit right with no avatar (matches the real message layout).
function SkeletonRow({
  role,
  lines,
  bubbleColor,
  blockColor,
}: {
  role: "ai" | "user";
  lines: number[];
  bubbleColor: string;
  blockColor: string;
}) {
  const isUser = role === "user";
  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.aiRow]}>
      {!isUser && <SkeletonBlock width={28} height={28} radius={14} color={blockColor} style={styles.avatar} />}
      <View style={[styles.bubble, { backgroundColor: bubbleColor }]}>
        <SkeletonLines widths={lines} height={12} gap={8} color={blockColor} />
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

  return (
    <SkeletonGroup style={styles.container} label="Loading conversation">
      <SkeletonRow role="ai" lines={[180, 210, 130]} bubbleColor={colors.chatAiBubble} blockColor={colors.bgSurface} />
      <SkeletonRow role="user" lines={[160, 90]} bubbleColor={colors.chatUserBubble} blockColor="#FFFFFF" />
      <SkeletonRow role="ai" lines={[200, 170, 190, 110]} bubbleColor={colors.chatAiBubble} blockColor={colors.bgSurface} />
      <SkeletonRow role="user" lines={[120]} bubbleColor={colors.chatUserBubble} blockColor="#FFFFFF" />
      <SkeletonRow role="ai" lines={[190, 150]} bubbleColor={colors.chatAiBubble} blockColor={colors.bgSurface} />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 14 },
  row: { flexDirection: "row", gap: 8 },
  aiRow: { justifyContent: "flex-start", alignItems: "flex-start" },
  userRow: { justifyContent: "flex-end" },
  avatar: { marginTop: 2 },
  bubble: { maxWidth: "75%", borderRadius: 16, padding: 12 },
});
