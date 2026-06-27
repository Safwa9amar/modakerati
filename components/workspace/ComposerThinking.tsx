import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { GeneratingPhase } from "@/stores/chat-store";

interface Props {
  isGenerating: boolean;
  phase: GeneratingPhase;
  /** Live reasoning tokens for the streaming message (message.thinking). */
  thinking: string;
  /** Localized idle status line. */
  statusReady: string;
  thinkingLabel: string;
  writingLabel: string;
  rtl: boolean;
}

/**
 * The composer's "model thinking" box. Idle → a one-line muted status. While the
 * AI works → a labelled, scrollable stream of its reasoning (already sent by the
 * server between [[MODK_THINK]] markers → chat-store message.thinking).
 */
export function ComposerThinking({
  isGenerating,
  phase,
  thinking,
  statusReady,
  thinkingLabel,
  writingLabel,
  rtl,
}: Props) {
  const colors = useThemeColors();

  if (!isGenerating) {
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

  const label = phase === "writing" ? writingLabel : thinkingLabel;

  return (
    <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.brandPrimary + "44" }]}>
      <View style={[styles.labelRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <ActivityIndicator size="small" color={colors.brandPrimary} />
        <Text style={[styles.label, { color: colors.brandPrimary }]}>{label}</Text>
      </View>
      {thinking ? (
        <BottomSheetScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.reason, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}>
            {thinking}
          </Text>
        </BottomSheetScrollView>
      ) : null}
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
  labelRow: { alignItems: "center", gap: 8, marginBottom: 4 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  scroll: { maxHeight: 140 },
  scrollContent: { paddingBottom: 2 },
  reason: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
