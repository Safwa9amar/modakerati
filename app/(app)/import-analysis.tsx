import { View, Text, ScrollView, Pressable, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useImportStore } from "@/stores/import-store";
import { useThesisStore } from "@/stores/thesis-store";
import { BackButton } from "@/components/BackButton";
import { CheckCircle, XCircle, AlertTriangle, AlertCircle, Info } from "lucide-react-native";
import { useCallback } from "react";
import type { AnalysisSuggestion } from "@/lib/api";

const SEVERITY_COLORS = {
  error: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
} as const;

function SeverityIcon({ severity, size = 20 }: { severity: AnalysisSuggestion["severity"]; size?: number }) {
  const color = SEVERITY_COLORS[severity];
  switch (severity) {
    case "error":
      return <AlertCircle size={size} color={color} />;
    case "warning":
      return <AlertTriangle size={size} color={color} />;
    case "info":
      return <Info size={size} color={color} />;
  }
}

function SuggestionSection({
  title,
  suggestions,
  acceptedIds,
  onToggle,
  colors,
}: {
  title: string;
  suggestions: AnalysisSuggestion[];
  acceptedIds: string[];
  onToggle: (id: string) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (suggestions.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {suggestions.map((s, i) => {
          const accepted = acceptedIds.includes(s.id);
          return (
            <View
              key={s.id}
              style={[
                styles.suggestionRow,
                i < suggestions.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
            >
              <SeverityIcon severity={s.severity} />
              <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={3}>
                {s.message}
              </Text>
              <Pressable onPress={() => onToggle(s.id)} hitSlop={8}>
                {accepted ? (
                  <CheckCircle size={24} color="#22C55E" />
                ) : (
                  <XCircle size={24} color="#9CA3AF" />
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function ImportAnalysisScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const analysisReport = useImportStore((s) => s.analysisReport);
  const acceptedIds = useImportStore((s) => s.acceptedIds);
  const thesis = useImportStore((s) => s.thesis);
  const status = useImportStore((s) => s.status);

  const handleToggle = useCallback((id: string) => {
    useImportStore.getState().toggleSuggestion(id);
  }, []);

  const handleAcceptAll = useCallback(() => {
    useImportStore.getState().acceptAll();
  }, []);

  const navigateToWorkspace = useCallback(() => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    router.replace("/(app)/thesis-workspace");
  }, [thesis, router]);

  const handleApply = useCallback(async () => {
    await useImportStore.getState().applyAccepted();
    navigateToWorkspace();
  }, [navigateToWorkspace]);

  const handleSkip = useCallback(() => {
    navigateToWorkspace();
  }, [navigateToWorkspace]);

  const isEmpty =
    !analysisReport ||
    (analysisReport.structure.length === 0 &&
      analysisReport.formatting.length === 0 &&
      analysisReport.content.length === 0);

  const isApplying = status === "applying";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("importAnalysis.title", "Analysis Results")}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <CheckCircle size={48} color="#22C55E" />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t("importAnalysis.noIssues", "No issues found")}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
            {t("importAnalysis.noIssuesDesc", "Your document looks good. You can proceed to the workspace.")}
          </Text>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={handleSkip}
          >
            <Text style={styles.primaryButtonText}>
              {t("importAnalysis.goToWorkspace", "Go to workspace")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <SuggestionSection
              title={t("importAnalysis.structure", "Structure")}
              suggestions={analysisReport.structure}
              acceptedIds={acceptedIds}
              onToggle={handleToggle}
              colors={colors}
            />
            <SuggestionSection
              title={t("importAnalysis.formatting", "Formatting")}
              suggestions={analysisReport.formatting}
              acceptedIds={acceptedIds}
              onToggle={handleToggle}
              colors={colors}
            />
            <SuggestionSection
              title={t("importAnalysis.content", "Content")}
              suggestions={analysisReport.content}
              acceptedIds={acceptedIds}
              onToggle={handleToggle}
              colors={colors}
            />

            {/* Accept all */}
            <Pressable onPress={handleAcceptAll} style={styles.acceptAllButton}>
              <Text style={[styles.acceptAllText, { color: colors.primary }]}>
                {t("importAnalysis.acceptAll", "Accept all")}
              </Text>
            </Pressable>
          </ScrollView>

          {/* Bottom actions */}
          <View style={[styles.bottomActions, { borderTopColor: colors.border }]}>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: colors.primary }, isApplying && styles.disabledButton]}
              onPress={handleApply}
              disabled={isApplying}
            >
              {isApplying ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {t("importAnalysis.applyChanges", "Apply changes")}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              onPress={handleSkip}
              disabled={isApplying}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                {t("importAnalysis.skipToWorkspace", "Skip to workspace")}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  acceptAllButton: {
    alignSelf: "center",
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  acceptAllText: {
    fontSize: 15,
    fontWeight: "600",
  },
  bottomActions: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    gap: 10,
  },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
});
