import { useCallback, useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { JobDef, TaskMode } from "@/lib/tasks-api";

/**
 * Pick a job from the menu, fill in its params, choose apply-or-propose.
 *
 * Uses the house BottomSheet wrapper rather than raw gorhom: it owns the
 * mount-fresh-then-present-once dance that the New Architecture needs.
 */
export function JobPickerSheet({
  jobs,
  onPick,
}: {
  jobs: JobDef[];
  onPick: (input: { kind: string; params: Record<string, string>; mode: TaskMode }) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign } = useRTL();

  const [selected, setSelected] = useState<JobDef | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<TaskMode>("apply");

  const choose = useCallback((job: JobDef) => {
    setSelected(job);
    setParams({});
    setMode(job.defaultMode);
  }, []);

  // Every param the job declares must be filled before it can be added — an
  // unattended run has nobody to ask "which chapter?".
  const ready = selected != null && selected.params.every((p) => (params[p] ?? "").trim().length > 0);

  const close = () => {
    useBottomSheet.getState().closeSheet("task-job");
    setSelected(null);
  };

  return (
    <BottomSheet name="task-job" snapPoints={["60%", "90%"]} scrollable keyboardBehavior="extend" onDismiss={() => setSelected(null)}>
      <View style={styles.sheet}>
        {selected === null ? (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{t("tasks.addTask")}</Text>
            {jobs.map((job) => (
              <Pressable key={job.id} onPress={() => choose(job)} style={[styles.jobRow, { borderColor: colors.borderSubtle }]}>
                <Text style={[styles.jobLabel, { color: colors.textPrimary, textAlign }]}>
                  {t(`tasks.jobs.${job.id}`, { defaultValue: job.id })}
                </Text>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>
              {t(`tasks.jobs.${selected.id}`, { defaultValue: selected.id })}
            </Text>

            {selected.params.map((p) => (
              <View key={p} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                  {t(`tasks.params.${p}`, { defaultValue: p })}
                </Text>
                <TextInput
                  value={params[p] ?? ""}
                  onChangeText={(v) => setParams((prev) => ({ ...prev, [p]: v }))}
                  placeholder={t("tasks.params.scopePlaceholder")}
                  placeholderTextColor={colors.textPlaceholder}
                  style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgInput, textAlign }]}
                />
              </View>
            ))}

            <View style={styles.modeRow}>
              {(["apply", "propose"] as TaskMode[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[styles.modeChip, { borderColor: mode === m ? colors.brandPrimary : colors.borderDefault }]}
                >
                  <Text style={{ color: mode === m ? colors.brandPrimary : colors.textSecondary, fontSize: 12 }}>
                    {t(m === "apply" ? "tasks.modeApply" : "tasks.modePropose")}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              disabled={!ready}
              onPress={() => {
                if (!selected) return;
                onPick({ kind: selected.id, params, mode });
                close();
              }}
              style={[styles.cta, { backgroundColor: ready ? colors.brandPrimary : colors.bgSurface }]}
            >
              <Text style={{ color: ready ? colors.brandOnPrimary : colors.textPlaceholder, fontWeight: "600" }}>
                {t("tasks.addTask")}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingBottom: 24 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  jobRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  jobLabel: { fontSize: 14 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  cta: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
