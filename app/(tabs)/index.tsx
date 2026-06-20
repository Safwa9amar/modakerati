import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useSettingsStore } from "@/stores/settings-store";
import { PenLine, FolderUp, LayoutGrid, Zap, FileText } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { loadSampleData } from "@/lib/sample-data";
import { useEffect } from "react";

export default function HomeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { theses, loadTemplates } = useThesisStore();

  useEffect(() => {
    loadTemplates();
    loadSampleData();
  }, []);

  const quickActions = [
    { icon: PenLine, label: t("home.newThesis"), color: colors.brandPrimary, onPress: () => router.push("/(app)/template-picker" as any) },
    { icon: FolderUp, label: t("home.importDocx"), color: "#9959FF", onPress: () => {} },
    { icon: LayoutGrid, label: t("home.templates"), color: colors.brandAccent, onPress: () => router.push("/(app)/template-picker" as any) },
    { icon: Zap, label: t("home.aiAssist"), color: colors.semanticWarning, onPress: () => {} },
  ];

  if (theses.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIllustration, { backgroundColor: colors.bgSurface }]}>
            <FileText size={60} color={colors.textSecondary} strokeWidth={1.5} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t("home.noThesesYet")}</Text>
          <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>{t("home.noThesesDesc")}</Text>
          <View style={styles.emptyButtons}>
            <Button title={t("home.createFirst")} onPress={() => router.push("/(app)/template-picker" as any)} />
            <Button title={t("home.importExisting")} onPress={() => {}} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>{t("home.goodMorning")}</Text>
            <Text style={[styles.name, { color: colors.textPrimary }]}>Hamza</Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]} />
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          {quickActions.map((action, i) => (
            <Pressable key={i} onPress={action.onPress} style={[styles.quickCard, { backgroundColor: colors.bgCard }]}>
              <View style={[styles.quickIconBg, { backgroundColor: action.color + "22" }]}>
                <action.icon size={20} color={action.color} strokeWidth={1.8} />
              </View>
              <Text style={[styles.quickLabel, { color: colors.textPrimary }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Recent Theses */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("home.recentTheses")}</Text>
          <Pressable onPress={() => router.push("/(tabs)/thesis" as any)}>
            <Text style={[styles.seeAll, { color: colors.brandPrimaryLight }]}>{t("common.seeAll")}</Text>
          </Pressable>
        </View>

        {/* Thesis cards */}
        {theses.map((thesis, i) => {
          const totalChapters = thesis.chapters.length;
          const doneChapters = thesis.chapters.filter((ch) => ch.status === "done").length;
          const progressColors = [colors.brandPrimary, colors.brandAccent, colors.semanticWarning];
          const progressColor = progressColors[i % progressColors.length];

          return (
            <Pressable
              key={thesis.id}
              onPress={() => {
                useThesisStore.getState().setCurrentThesis(thesis.id);
                router.push("/(tabs)/chat" as any);
              }}
            >
              <Card style={styles.thesisCard}>
                <Text style={[styles.thesisTitle, { color: colors.textPrimary }]}>{thesis.title}</Text>
                <View style={styles.thesisMeta}>
                  <Text style={[styles.thesisMetaText, { color: colors.textSecondary }]}>
                    {doneChapters}/{totalChapters} {t("home.chapters")}
                  </Text>
                  <Text style={[styles.thesisMetaText, { color: colors.textSecondary }]}>
                    2 {t("home.hoursAgo")}
                  </Text>
                </View>
                <View style={[styles.progressBg, { backgroundColor: colors.bgSurface }]}>
                  <View style={[styles.progressFill, { backgroundColor: progressColor, width: `${thesis.progress || 10}%` }]} />
                </View>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 20 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  greeting: { fontSize: 14, fontFamily: "Inter_400Regular" },
  name: { fontSize: 22, fontFamily: "Inter_700Bold" },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  quickRow: { flexDirection: "row", gap: 12 },
  quickCard: { flex: 1, borderRadius: 16, padding: 14, alignItems: "center", gap: 8 },
  quickIconBg: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  thesisCard: { marginBottom: 0 },
  thesisTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  thesisMeta: { flexDirection: "row", gap: 16, marginBottom: 10 },
  thesisMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progressBg: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 16 },
  emptyIllustration: { width: 160, height: 160, borderRadius: 80, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  emptyButtons: { width: "100%", gap: 12, marginTop: 16 },
});
