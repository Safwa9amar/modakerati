import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useChatStore } from "@/stores/chat-store";
import { useWorkingClock } from "@/hooks/useWorkingClock";
import { SpinningAsterisk } from "@/components/ThinkingTrace";
import { formatElapsed } from "@/lib/thinking";
import { visualRow, visualTextAlign } from "@/lib/rtl-layout";

interface Props {
  /** Drive the note from an explicit request instead of the chat turn — for
   *  surfaces with their own store (the inline suggestion). Pair with `stream`. */
  active?: boolean;
  /** Text that request is producing; its growth is what proves it's alive. */
  stream?: string;
  /** Match the surrounding text's direction (the bubble's, the composer's). */
  rtl?: boolean;
  /** Whether this surface offers a Stop control — the longest wait line points
   *  at it. False on surfaces where the only option is to wait. */
  stoppable?: boolean;
  /** Fixed muted ink for callers on a surface where textSecondary vanishes
   *  (the always-light document paper). Defaults to the theme's. */
  ink?: string;
  /** Fixed accent ink for the spinner, same rationale. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * "The AI is still working" — the missing indicator for the long middle of an
 * agentic turn.
 *
 * A turn that copies a chapter with its figures and tables spends minutes
 * running tools: reasoning has ended (its trace collapsed to "Thought for Xs")
 * and no answer token has been produced yet, so every live affordance in the
 * chat has gone quiet and the turn is indistinguishable from a hang. This fills
 * that gap with a spinner, a running m:ss clock and a line that escalates the
 * longer it takes.
 *
 * It reads the turn state from the store itself, so mounting it costs the caller
 * no prop plumbing — mount it wherever the live turn is visible and it decides
 * for itself whether there's anything to say.
 */
export function AiWorkingNote({ active, stream, rtl = false, stoppable = true, ink, accent, style }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const mutedInk = ink ?? colors.textSecondary;
  const accentInk = accent ?? colors.brandPrimaryLight;

  const isGenerating = useChatStore((s) => s.isGenerating);
  const turnStartedAt = useChatStore((s) => s.turnStartedAt);
  const lastEventAt = useChatStore((s) => s.lastEventAt);
  const toolTrace = useChatStore((s) => s.toolTrace);

  // Caller-driven when `active` is given, else the chat turn in the store.
  const owned = active !== undefined;
  const clock = useWorkingClock({
    active: owned ? active : isGenerating,
    startedAt: owned ? undefined : turnStartedAt,
    lastEventAt: owned ? undefined : lastEventAt,
    stream,
  });
  if (!clock) return null;

  const { elapsedMs: elapsed, stage } = clock;
  const label =
    stage === "veryLong"
      ? stoppable
        ? t("working.veryLongStoppable", { defaultValue: "Still working on a long task — keep waiting, or tap Stop." })
        : t("working.veryLong", { defaultValue: "Still working on a long task — please keep waiting." })
      : stage === "long"
        ? t("working.long", { defaultValue: "Still working — this can take a while. Please wait." })
        : t("working.short", { defaultValue: "Working on it…" });

  // Developer tool trace. Empty unless the server runs with AI_SHOW_TOOLS (dev
  // only), so a student's build renders exactly what it did before. Untranslated
  // on purpose — these are raw tool names, not product copy.
  const trace = owned ? [] : toolTrace.slice(-TRACE_ROWS);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={style}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <View style={[styles.row, { flexDirection: visualRow(rtl) }]}>
        <SpinningAsterisk color={accentInk} />
        <Text style={[styles.label, { color: mutedInk, textAlign: visualTextAlign(rtl) }]}>{label}</Text>
        <View style={styles.spacer} />
        {/* Fixed-width m:ss — the proof that something is still moving. */}
        <Text style={[styles.clock, { color: mutedInk }]}>{formatElapsed(elapsed)}</Text>
      </View>
      {trace.map((t) => (
        <Text key={t.id} numberOfLines={1} style={[styles.tool, { color: t.state === "error" ? colors.semanticError : mutedInk }]}>
          {t.state === "running" ? "▸" : t.state === "error" ? "✕" : "✓"} {t.name}
          {t.detail ? `  ${t.detail}` : ""}
          {t.ms !== undefined ? `  ${(t.ms / 1000).toFixed(1)}s` : ""}
        </Text>
      ))}
    </Animated.View>
  );
}

// How many tool rows to keep on screen — enough to read the shape of what the
// turn is doing without pushing the answer off the top.
const TRACE_ROWS = 6;

const styles = StyleSheet.create({
  row: { alignItems: "center", gap: 6, marginTop: 8 },
  // Dev trace: monospaced and always LTR — tool names and indices are code, and
  // must not reorder inside an Arabic bubble.
  tool: {
    marginTop: 3,
    fontSize: 10.5,
    fontFamily: "monospace",
    writingDirection: "ltr",
    textAlign: "left",
    opacity: 0.85,
  },
  label: { flexShrink: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  spacer: { flexGrow: 1 },
  // Digits stay LTR in every locale so the clock never reorders in Arabic.
  clock: { fontSize: 11.5, fontFamily: "Inter_400Regular", fontVariant: ["tabular-nums"], writingDirection: "ltr" },
});
