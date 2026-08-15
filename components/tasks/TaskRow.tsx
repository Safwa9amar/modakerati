import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { Check, X, CircleDashed, Clock, Trash2 } from "lucide-react-native";
import type { TaskItem } from "@/lib/tasks-api";

/**
 * One task line. Shows what it is, where it applies and whether it will be
 * applied or proposed — and, once a run has happened, what became of it.
 *
 * `onRemove` is passed only while the run is still a draft; a scheduled or
 * finished run's tasks are history and must not sprout a delete button.
 */
export function TaskRow({ task, onRemove }: { task: TaskItem; onRemove?: (id: string) => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();

  const label = t(`tasks.jobs.${task.kind}`, { defaultValue: task.kind });
  const scope = task.target.scope ?? task.params.scope ?? task.target.anchor?.snippet;

  const statusColor =
    task.status === "done" ? colors.semanticSuccess
    : task.status === "failed" ? colors.semanticError
    : colors.textSecondary;

  const StatusIcon =
    task.status === "done" ? Check
    : task.status === "failed" ? X
    : task.status === "skipped" ? CircleDashed
    : Clock;

  const modeColor = task.mode === "apply" ? colors.semanticSuccess : colors.semanticWarning;

  return (
    <View style={[styles.row, { flexDirection, backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
      <StatusIcon size={16} color={statusColor} strokeWidth={2} />

      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.textPrimary, textAlign }]}>
          {label}
        </Text>
        {scope ? (
          <Text numberOfLines={1} style={[styles.scope, { color: colors.textSecondary, textAlign }]}>
            {scope}
          </Text>
        ) : null}
        {/* The reason a task could not be done is the whole point of the report —
            never truncate it to one line. */}
        {task.status === "failed" && task.result?.reason ? (
          <Text style={[styles.reason, { color: colors.semanticError, textAlign }]}>{task.result.reason}</Text>
        ) : null}
      </View>

      <View style={[styles.badge, { borderColor: modeColor }]}>
        <Text style={[styles.badgeText, { color: modeColor }]}>
          {t(task.mode === "apply" ? "tasks.modeApply" : "tasks.modePropose")}
        </Text>
      </View>

      {onRemove ? (
        <Pressable
          onPress={() => onRemove(task.id)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("tasks.remove")}
        >
          <Trash2 size={16} color={colors.textPlaceholder} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, fontWeight: "600" },
  scope: { fontSize: 12, marginTop: 2 },
  reason: { fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: "600" },
});
