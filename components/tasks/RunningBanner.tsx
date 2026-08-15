import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { Loader } from "lucide-react-native";

/**
 * Shown across the top of the Writer while a scheduled run is working on this
 * thesis. The student's own edits and the run's edits both land on the same
 * .docx, so at minimum they must know it is happening.
 *
 * NOT a read-only lock: see the note in the phase-2 plan. The executor cannot
 * hold the thesis lock across a run, so a run interleaves exactly like an
 * ordinary chat turn — which this app has never blocked editing for.
 */
export function RunningBanner() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();

  return (
    <View style={[styles.bar, { flexDirection, backgroundColor: colors.bgSurface }]}>
      <Loader size={14} color={colors.textSecondary} strokeWidth={2} />
      <Text style={[styles.text, { color: colors.textSecondary, textAlign }]}>{t("tasks.running")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  text: { fontSize: 12, flex: 1 },
});
