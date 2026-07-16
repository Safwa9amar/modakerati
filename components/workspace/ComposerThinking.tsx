import { View, Text, StyleSheet } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useThemeColors } from "@/hooks/useThemeColors";
import { ThinkingTrace } from "@/components/ThinkingTrace";

interface Props {
  isGenerating: boolean;
  /** True only while actively reasoning (phase === "thinking"). Drives the live
   *  stream; once the model starts writing this is false so the chip appears. */
  reasoning: boolean;
  /** Reasoning to surface: the live turn's, else the last turn's (for review). */
  thinking: string;
  /** Duration of the completed reasoning → "Thought for Xs". */
  durationMs?: number;
  /** Localized idle status line. */
  statusReady: string;
  rtl: boolean;
}

/**
 * The composer's "model thinking" area. When there's nothing to show it's a
 * one-line status; otherwise it renders the shared ThinkingTrace — live while
 * reasoning, then a reviewable "Thought for Xs" chip (through the writing phase
 * and until the next turn).
 */
export function ComposerThinking({ isGenerating, reasoning, thinking, durationMs, statusReady, rtl }: Props) {
  const colors = useThemeColors();

  if (!isGenerating && !thinking) {
    return (
      <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}>
        <Text
          style={[styles.status, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}
          numberOfLines={1}
        >
          {statusReady}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.brandPrimary + "44" }]}>
      <ThinkingTrace
        text={thinking}
        streaming={reasoning}
        durationMs={reasoning ? undefined : durationMs}
        defaultOpen={reasoning}
        rtl={rtl}
        ScrollComponent={BottomSheetScrollView}
        surfaceColor={colors.bgSurface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 2,
  },
  status: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
