import { useEffect, useRef, useState, type ComponentType } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView as RNScrollView } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Asterisk, ChevronDown, ChevronUp } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { windowLines, formatThinkingDuration } from "@/lib/thinking";

// How many trailing reasoning lines the live window shows.
const LIVE_LINES = 6;

interface Props {
  /** Accumulated reasoning text. */
  text: string;
  /** True while this turn is still reasoning. */
  streaming: boolean;
  /** Once known → renders "Thought for Xs". */
  durationMs?: number;
  /** Initial expanded state (composer live = true; chat = false). */
  defaultOpen?: boolean;
  /** Draw a hairline separator below when an answer follows (chat bubble). */
  dividerBelow?: boolean;
  rtl?: boolean;
  /** The sheet injects BottomSheetScrollView; chat leaves it default. */
  ScrollComponent?: ComponentType<any>;
  /** Background the live-window top-fade blends into (its parent's bg). Defaults
   *  to bgCard; callers pass their actual surface (chat bubble / composer box). */
  surfaceColor?: string;
}

/** A ✻ that spins while the model is reasoning. */
function SpinningAsterisk({ color }: { color: string }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 1200, easing: Easing.linear }), -1);
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Asterisk size={13} color={color} strokeWidth={2.5} />
    </Animated.View>
  );
}

/** Top-edge fade over the live window, built from stacked opacity bands (no
 *  gradient dependency — mirrors chat.tsx's FadeOverlay). */
function TopFade({ color }: { color: string }) {
  const SLICES = 8;
  const H = 22;
  return (
    <View pointerEvents="none" style={[styles.topFade, { height: H }]}>
      {Array.from({ length: SLICES }).map((_, i) => (
        <View key={i} style={{ height: H / SLICES, backgroundColor: color, opacity: (SLICES - i) / SLICES }} />
      ))}
    </View>
  );
}

/**
 * The shared "model thinking" widget. Streams reasoning line-by-line (Claude-Code
 * style) while active, then collapses to a tappable "Thought for Xs" chip.
 */
export function ThinkingTrace({
  text,
  streaming,
  durationMs,
  defaultOpen = false,
  dividerBelow = false,
  rtl = false,
  ScrollComponent,
  surfaceColor,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);

  // Auto-collapse to the chip when a turn ends; re-open when a new turn starts.
  const prevStreaming = useRef(streaming);
  useEffect(() => {
    if (!prevStreaming.current && streaming) setOpen(true);
    else if (prevStreaming.current && !streaming) setOpen(false);
    prevStreaming.current = streaming;
  }, [streaming]);

  const hasText = text.trim().length > 0;
  if (!streaming && !hasText) return null;

  const Scroll = ScrollComponent ?? RNScrollView;
  const durLabel = durationMs != null ? formatThinkingDuration(durationMs) : "";
  const label = streaming
    ? t("chat.thinkingEllipsis", { defaultValue: "Thinking…" })
    : durationMs != null
      ? t("chat.thoughtFor", { d: durLabel, defaultValue: `Thought for ${durLabel}` })
      : t("chat.thinking", { defaultValue: "Thinking" });

  const liveLines = windowLines(text, LIVE_LINES);

  return (
    <View style={dividerBelow ? [styles.dividerWrap, { borderColor: colors.borderDefault }] : undefined}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        accessibilityRole="button"
        style={[styles.header, { flexDirection: rtl ? "row-reverse" : "row" }]}
      >
        {streaming ? (
          <SpinningAsterisk color={colors.brandPrimaryLight} />
        ) : (
          <Asterisk size={13} color={colors.textSecondary} strokeWidth={2.5} />
        )}
        <Text style={[styles.label, { color: streaming ? colors.brandPrimaryLight : colors.textSecondary }]}>
          {label}
        </Text>
        <View style={styles.spacer} />
        {open ? (
          <ChevronUp size={14} color={colors.textSecondary} strokeWidth={2} />
        ) : (
          <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2} />
        )}
      </Pressable>

      {/* Live: last N lines, top-faded, no inner scroll (never fights the sheet). */}
      {streaming && open && hasText ? (
        <View style={[styles.rail, { borderColor: colors.brandPrimary }]}>
          <View style={styles.liveWindow}>
            {liveLines.map((line, i) => (
              <Text
                key={i}
                style={[styles.line, { color: colors.textSecondary, opacity: i === liveLines.length - 1 ? 0.95 : 0.45 }]}
              >
                {line}
              </Text>
            ))}
          </View>
          <TopFade color={surfaceColor ?? colors.bgCard} />
        </View>
      ) : null}

      {/* Done + expanded: full reasoning, scrollable via the injected container. */}
      {!streaming && open && hasText ? (
        <View style={[styles.rail, { borderColor: colors.borderDefault }]}>
          <Scroll style={styles.doneScroll} contentContainerStyle={styles.doneScrollContent}>
            <Text selectable style={[styles.line, { color: colors.textSecondary }]}>
              {text.trim()}
            </Text>
          </Scroll>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dividerWrap: { marginBottom: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { alignItems: "center", gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  spacer: { flex: 1 },
  rail: { marginTop: 8, borderLeftWidth: 2, paddingLeft: 10, position: "relative" },
  liveWindow: { maxHeight: 110, overflow: "hidden", justifyContent: "flex-end" },
  doneScroll: { maxHeight: 220 },
  doneScrollContent: { paddingBottom: 2 },
  // Reasoning is the model's English scratchpad → keep it LTR even in RTL locales.
  line: { fontSize: 11.5, lineHeight: 17, fontFamily: "Inter_400Regular", fontStyle: "italic", writingDirection: "ltr", textAlign: "left" },
  topFade: { position: "absolute", top: 0, left: 0, right: 0 },
});
