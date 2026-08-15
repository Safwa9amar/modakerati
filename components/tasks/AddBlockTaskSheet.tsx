import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { TaskMode } from "@/lib/tasks-api";

/**
 * "Add as task" for the block the student is looking at.
 *
 * Free text is safe here precisely BECAUSE the scope is pinned: the anchor is
 * the paragraph they selected, so the unattended run never has to guess which
 * one they meant. The snippet travels with it so the server can re-find the
 * block if the document moves before the run fires (see the server's
 * lib/tasks/anchor.ts).
 */
export function AddBlockTaskSheet({
  snippet,
  onAdd,
}: {
  snippet: string;
  onAdd: (input: { request: string; mode: TaskMode }) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();

  const [request, setRequest] = useState("");
  // Defaults to propose: this rewrites the student's own sentence, and they are
  // not going to be watching when it happens.
  const [mode, setMode] = useState<TaskMode>("propose");

  const ready = request.trim().length > 0;

  return (
    <BottomSheet
      name="task-from-block"
      snapPoints={["50%", "85%"]}
      keyboardBehavior="extend"
      onDismiss={() => setRequest("")}
    >
      <View style={styles.sheet}>
        <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{t("tasks.addFromBlock")}</Text>

        <Text numberOfLines={2} style={[styles.snippet, { color: colors.textSecondary, textAlign }]}>
          {snippet}
        </Text>

        <TextInput
          value={request}
          onChangeText={setRequest}
          placeholder={t("tasks.params.request")}
          placeholderTextColor={colors.textPlaceholder}
          multiline
          style={[
            styles.input,
            { color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgInput, textAlign },
          ]}
        />

        <View style={[styles.modeRow, { flexDirection }]}>
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
            onAdd({ request: request.trim(), mode });
            setRequest("");
            useBottomSheet.getState().closeSheet("task-from-block");
          }}
          style={[styles.cta, { backgroundColor: ready ? colors.brandPrimary : colors.bgSurface }]}
        >
          <Text style={{ color: ready ? colors.brandOnPrimary : colors.textPlaceholder, fontWeight: "600" }}>
            {t("tasks.addTask")}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingBottom: 24 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  snippet: { fontSize: 12, marginBottom: 14, fontStyle: "italic" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 72, textAlignVertical: "top" },
  modeRow: { gap: 8, marginVertical: 14 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  cta: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
