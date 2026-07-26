import { I18nManager, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { SpinningAsterisk } from "@/components/ThinkingTrace";

export type PeekPhase = "thinking" | "writing" | "done";

// Must clear FloatingPill's BUBBLE_SIZE (52) + a small gap. Duplicated as a
// literal (not imported) to avoid a circular import between the two files —
// FloatingPill imports PeekCard, so PeekCard can't import back from it.
const BUBBLE_CLEARANCE = 62;

interface Props {
  /** true → anchor the card's physical-LEFT edge to the bubble (grows
   *  rightward); false → anchor the physical-RIGHT edge (grows leftward).
   *  Picked by the caller from the bubble's last settled position — this
   *  component only renders the resolved side, RTL-compensated below. */
  anchorLeft: boolean;
  phase: PeekPhase;
  /** Plain-text snippet to preview (already the raw message content — this
   *  component trims/truncates it for display). Empty string while there's
   *  no content yet (e.g. still in the "thinking" phase). */
  snippet: string;
  /** Live token estimate for the "thinking" phase only (0/undefined
   *  elsewhere) — an approximation of the streaming reasoning's length, not
   *  the provider's actual billed usage; see lib/thinking.ts's
   *  estimateTokenCount. Appended to the chip's label when > 0. */
  thinkingTokens?: number;
  onPress: () => void;
}

/**
 * The Messenger "chat-heads" style tail-bubble card anchored above the
 * collapsed ✦ AI bubble. Purely presentational — FloatingPill derives `phase`
 * and `snippet` from the shared chat store and owns all screen-position math;
 * this component only owns its own look (a small collapsed chip while
 * thinking, a wider card once there's text to show) and which side its tail
 * points from.
 */
export function PeekCard({ anchorLeft, phase, snippet, thinkingTokens, onPress }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  // RN's global RTL left<->right style swap flips a plain left/right style
  // whenever I18nManager.isRTL, regardless of this view's own layout — so to
  // land on the PHYSICAL side the caller asked for, pick the opposite key
  // when the app is RTL (mirrors FloatingPill's own `hostAnchor` trick).
  const useLeftKey = I18nManager.isRTL ? !anchorLeft : anchorLeft;
  const anchorStyle = useLeftKey ? { left: 0 as const } : { right: 0 as const };

  const label =
    phase === "thinking"
      ? t("aiDock.peek.thinking", { defaultValue: "Thinking…" })
      : phase === "writing"
        ? t("aiDock.peek.writing", { defaultValue: "Writing…" })
        : t("aiDock.peek.done", { defaultValue: "Done" });

  const trimmed = snippet.trim().replace(/\s+/g, " ").slice(0, 220);

  // "Thinking" has no snippet yet, so it renders as a small collapsed chip —
  // spinning ✻ + label, matching the app's shared ThinkingTrace collapsed
  // row — instead of the wider card the writing/done states need for text.
  if (phase === "thinking") {
    const tokenSuffix =
      thinkingTokens && thinkingTokens > 0
        ? ` · ${t("chat.tokenCount", { count: thinkingTokens, defaultValue: `${thinkingTokens} tokens` })}`
        : "";
    return (
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.chipHost, anchorStyle]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label + tokenSuffix}
          style={[styles.chip, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
        >
          <SpinningAsterisk color={colors.brandPrimary} />
          <Text numberOfLines={1} style={[styles.chipLabel, { color: colors.brandPrimary }]}>
            {label}
            {tokenSuffix}
          </Text>
        </Pressable>
        <View
          style={[
            styles.tail,
            { backgroundColor: colors.bgCard, borderColor: colors.borderDefault },
            anchorLeft ? styles.tailLeft : styles.tailRight,
          ]}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.host, anchorStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={trimmed ? `${label}: ${trimmed}` : label}
        style={[
          styles.card,
          { backgroundColor: colors.bgCard, borderColor: phase === "done" ? colors.brandPrimary : colors.borderDefault },
        ]}
      >
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.brandPrimary }]}>{label}</Text>
          {phase === "done" && <View style={[styles.unreadDot, { backgroundColor: colors.brandPrimary }]} />}
        </View>
        {trimmed.length > 0 && (
          <Text numberOfLines={4} style={[styles.snippet, { color: colors.textPrimary }]}>
            {trimmed}
          </Text>
        )}
      </Pressable>
      <View
        style={[
          styles.tail,
          { backgroundColor: colors.bgCard, borderColor: colors.borderDefault },
          anchorLeft ? styles.tailLeft : styles.tailRight,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A firm `width` (not just `maxWidth`) — nested inside FloatingPill's own
  // 52px-wide collapsed host, an absolutely-positioned child with only a cap
  // and no concrete width let Yoga shrink-wrap it far narrower than intended.
  host: { position: "absolute", bottom: BUBBLE_CLEARANCE, width: 240 },
  // Thinking's chip hugs its content (no fixed width) — it's always a short
  // one-line label, unlike the writing/done card which needs room for text.
  chipHost: { position: "absolute", bottom: BUBBLE_CLEARANCE },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    // Same fix as `host` below: an auto-sized absolute child nested inside
    // FloatingPill's 52px collapsed host can get computed narrower than its
    // own content, force-wrapping the label mid-word. A firm minWidth (not
    // a fixed width — still lets a longer translated label grow) fixes it;
    // maxWidth caps it once the token-count suffix makes the label longer
    // (numberOfLines={1} above ellipsizes past it, rather than wrapping).
    minWidth: 96,
    maxWidth: 220,
    gap: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 5,
  },
  chipLabel: { fontSize: 11.5, fontFamily: "Inter_500Medium" },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 10.5, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
  snippet: { fontSize: 12.5, fontFamily: "Inter_400Regular", lineHeight: 16 },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5 },
  tail: {
    position: "absolute",
    bottom: -6,
    width: 12,
    height: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: "45deg" }],
  },
  tailLeft: { left: 18 },
  tailRight: { right: 18 },
});
