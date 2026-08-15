import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import { TaskRow } from "@/components/tasks/TaskRow";
import { getRun, type TaskRun, type TaskItem, type TaskProposal } from "@/lib/tasks-api";
import { useTasksStore } from "@/stores/tasks-store";

/**
 * What one run did. Owns the things the document itself cannot show: what was
 * applied, what is waiting, what failed and WHY, and cancelling a run that is
 * still going.
 *
 * Reviewing the proposals happens in the Writer, not here — that is phase 3.
 * This screen only counts them.
 */
export default function TaskRunScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();
  const bottomPad = useSafeAreaInsets().bottom + 24;
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const cancel = useTasksStore((s) => s.cancel);

  const [run, setRun] = useState<TaskRun | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [proposals, setProposals] = useState<TaskProposal[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    try {
      const r = await getRun(runId);
      setRun(r.run);
      setTasks(r.tasks);
      setProposals(r.proposals);
    } catch {
      // Keep whatever is on screen; pull-to-refresh is the retry.
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  // A run in flight changes underneath this screen, so poll while it does.
  // Stops the moment it settles — no timer left running on a finished run.
  const live = run?.status === "running" || run?.status === "cancelling";
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void fetchRun(), 5000);
    return () => clearInterval(id);
  }, [live, fetchRun]);

  const pending = proposals.filter((p) => p.status === "pending").length;

  const summaryLine = live
    ? t("tasks.running")
    : [
        (run?.summary?.applied ?? 0) > 0 ? `${run?.summary?.applied} ${t("tasks.done")}` : null,
        pending > 0 ? `${pending} ${t("tasks.waitingForYou")}` : null,
        (run?.summary?.failed ?? 0) > 0 ? `${run?.summary?.failed} ${t("tasks.failed")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary, textAlign }]}>{t("tasks.title")}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await fetchRun();
              setRefreshing(false);
            }}
            tintColor={colors.textSecondary}
          />
        }
      >
        {run ? (
          <View style={[styles.summary, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
            <Text style={[styles.summaryText, { color: colors.textPrimary, textAlign }]}>{summaryLine}</Text>
            {/* Honest about the ways a run can end short of its list. */}
            {run.summary?.stoppedForBudget ? (
              <Text style={[styles.note, { color: colors.semanticWarning, textAlign }]}>{t("tasks.stoppedEarly")}</Text>
            ) : null}
            {run.summary?.lateMinutes ? (
              <Text style={[styles.note, { color: colors.textSecondary, textAlign }]}>{t("tasks.ranLate")}</Text>
            ) : null}
            {run.status === "cancelling" ? (
              <Text style={[styles.note, { color: colors.textSecondary, textAlign }]}>{t("tasks.cancelling")}</Text>
            ) : null}
          </View>
        ) : null}

        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}

        {run && (run.status === "scheduled" || run.status === "running") ? (
          <Pressable
            onPress={() => void cancel(run.id).then(fetchRun)}
            style={[styles.cancel, { borderColor: colors.semanticError }]}
          >
            <Text style={{ color: colors.semanticError, fontWeight: "600" }}>{t("tasks.cancel")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", flex: 1 },
  summary: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  summaryText: { fontSize: 14, fontWeight: "600" },
  note: { fontSize: 12, marginTop: 6 },
  cancel: { marginTop: 18, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
});
