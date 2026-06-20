import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { PenLine, FolderUp, LayoutGrid, Zap, FileText } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { listTheses } from "@/lib/api";
import { useEffect, useState, useCallback } from "react";

interface ApiThesis {
  id: string;
  title: string;
  status: string;
  progress: number;
  updatedAt: string;
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [apiTheses, setApiTheses] = useState<ApiThesis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTheses();
  }, []);

  async function fetchTheses() {
    try {
      const data = await listTheses();
      setApiTheses(data);
    } catch {
      setApiTheses([]);
    }
    setLoading(false);
  }

  const selectThesis = useCallback((thesis: ApiThesis) => {
    const store = useThesisStore.getState();
    // Ensure thesis exists in local store for chat screen
    if (!store.theses.find((t) => t.id === thesis.id)) {
      store.theses.push({
        id: thesis.id,
        title: thesis.title,
        status: thesis.status as any,
        progress: thesis.progress || 0,
        wordCount: 0,
        pageCount: 0,
        language: "fr",
        chapters: [],
        createdAt: thesis.updatedAt,
        updatedAt: thesis.updatedAt,
      });
    }
    store.setCurrentThesis(thesis.id);
    router.push("/(tabs)/chat" as any);
  }, []);

  const quickActions = [
    { icon: PenLine, label: t("home.newThesis"), color: colors.brandPrimary, onPress: () => router.push("/(app)/template-picker" as any) },
    { icon: FolderUp, label: t("home.importDocx"), color: "#9959FF", onPress: () => {} },
    { icon: LayoutGrid, label: t("home.templates"), color: colors.brandAccent, onPress: () => router.push("/(app)/template-picker" as any) },
    { icon: Zap, label: t("home.aiAssist"), color: colors.semanticWarning, onPress: () => {} },
  ];

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (apiTheses.length === 0) {
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
        <View style={styles.topBar}>
          <View>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>{t("home.goodMorning")}</Text>
            <Text style={[styles.name, { color: colors.textPrimary }]}>Hamza</Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]} />
        </View>

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

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("home.recentTheses")}</Text>
        </View>

        {apiTheses.map((thesis, i) => {
          const progressColors = [colors.brandPrimary, colors.brandAccent, colors.semanticWarning];
          const progressColor = progressColors[i % progressColors.length];
          return (
            <Pressable key={thesis.id} onPress={() => selectThesis(thesis)}>
              <Card style={styles.thesisCard}>
                <Text style={[styles.thesisTitle, { color: colors.textPrimary }]}>{thesis.title}</Text>
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
  thesisCard: { marginBottom: 0 },
  thesisTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  progressBg: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 16 },
  emptyIllustration: { width: 160, height: 160, borderRadius: 80, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  emptyButtons: { width: "100%", gap: 12, marginTop: 16 },
});
