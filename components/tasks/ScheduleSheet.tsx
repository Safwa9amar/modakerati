import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { SCHEDULE_PRESETS, resolvePreset, presetClock } from "@/lib/task-schedule";

/**
 * When should this run? Preset chips, plus Run now.
 *
 * No date picker on purpose — see lib/task-schedule.ts for why (it would be a
 * native module, which moves the fingerprint and cuts installed binaries off
 * from OTA updates).
 */
export function ScheduleSheet({
  onSchedule,
  onRunNow,
}: {
  onSchedule: (whenIso: string) => void;
  onRunNow: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();

  const close = () => useBottomSheet.getState().closeSheet("task-schedule");

  return (
    <BottomSheet name="task-schedule">
      <View style={styles.sheet}>
        <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{t("tasks.when.heading")}</Text>

        {SCHEDULE_PRESETS.map((preset) => (
          <Pressable
            key={preset.id}
            onPress={() => {
              onSchedule(resolvePreset(preset).toISOString());
              close();
            }}
            style={[styles.row, { flexDirection, borderColor: colors.borderSubtle }]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary, textAlign }]}>{t(preset.labelKey)}</Text>
            <Text style={[styles.rowClock, { color: colors.textSecondary }]}>{presetClock(preset)}</Text>
          </Pressable>
        ))}

        <Pressable
          onPress={() => {
            onRunNow();
            close();
          }}
          style={[styles.cta, { backgroundColor: colors.brandPrimary }]}
        >
          <Text style={{ color: colors.brandOnPrimary, fontWeight: "600" }}>{t("tasks.runNow")}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingBottom: 24 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 14 },
  row: { alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14, flex: 1 },
  rowClock: { fontSize: 13, fontVariant: ["tabular-nums"] },
  cta: { marginTop: 18, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
