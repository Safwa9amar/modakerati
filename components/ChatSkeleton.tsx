import { View, StyleSheet, type DimensionValue } from "react-native";
import { SkeletonGroup, SkeletonLines } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/useThemeColors";

// A skeleton is a promise about the layout that is coming, so it has to make the
// SAME promise the transcript keeps: the assistant's answer is bare prose running
// the full width, and only the student's own message wears a pill (see
// components/chat/MessageBubble). The old version drew a tinted card on both
// sides, which meant the first real answer arrived by DELETING a box the eye had
// already accepted.

/** The assistant side: full-width lines on the page, no card, no avatar. */
function AnswerRow({ lines, blockColor }: { lines: DimensionValue[]; blockColor: string }) {
  return (
    <View style={styles.answer}>
      <SkeletonLines widths={lines} height={12} gap={9} color={blockColor} />
    </View>
  );
}

/** The student side: a short pill at the reading end. */
function AskRow({ lines, bubbleColor, blockColor }: { lines: DimensionValue[]; bubbleColor: string; blockColor: string }) {
  return (
    <View style={styles.askRow}>
      <View style={[styles.askBubble, { backgroundColor: bubbleColor }]}>
        <SkeletonLines widths={lines} height={12} gap={8} color={blockColor} />
      </View>
    </View>
  );
}

/**
 * Shimmering placeholder shown while the chat history loads from cache/server,
 * so the screen reads as "loading" instead of a blank void.
 */
export function ChatSkeleton() {
  const colors = useThemeColors();
  // On the page, the bars sit on bgPrimary; inside the user pill they sit on a
  // tint, and a placeholder-ink wash is the one value that stays visible on both
  // in either theme.
  const onPage = colors.bgSurface;
  const onPill = colors.textPlaceholder + "55";

  return (
    <SkeletonGroup style={styles.container} label="Loading conversation">
      <AnswerRow lines={["100%", "96%", 210]} blockColor={onPage} />
      <AskRow lines={[160, 90]} bubbleColor={colors.chatUserBubble} blockColor={onPill} />
      <AnswerRow lines={["100%", "92%", "97%", 140]} blockColor={onPage} />
      <AskRow lines={[120]} bubbleColor={colors.chatUserBubble} blockColor={onPill} />
      <AnswerRow lines={["94%", 190]} blockColor={onPage} />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 20 },
  answer: { width: "100%" },
  askRow: { alignItems: "flex-end" },
  askBubble: { maxWidth: "84%", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11 },
});
