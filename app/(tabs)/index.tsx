import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, useWindowDimensions, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { PenLine, FolderUp, LayoutGrid, Zap, FileText, Layers, List, ChevronRight, Newspaper } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useNavBarClearance } from "@/components/FloatingNavBar";
import { useProfileStore } from "@/stores/profile-store";
import { useImportStore } from "@/stores/import-store";
import { useThesisStore } from "@/stores/thesis-store";
import { listTheses, listNews } from "@/lib/api";
import type { NewsArticle } from "@/types/news";
import { useEffect, useState, useCallback } from "react";

interface ApiThesis {
  id: string;
  title: string;
  status: string;
  progress: number;
  updatedAt: string;
  // Stored stats from the thesis row (structure lives in the .docx, not the DB).
  pageCount?: number;
  wordCount?: number;
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const bottomPad = useNavBarClearance();
  const avatarUrl = useProfileStore((s) => s.profile?.avatarUrl);
  const { width } = useWindowDimensions();
  // 2-column grid: subtract the 20px screen padding on each side and the 12px
  // gutter between the two cards, then split what's left.
  const cardWidth = (width - 20 * 2 - 12) / 2;
  const [apiTheses, setApiTheses] = useState<ApiThesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [news, setNews] = useState<NewsArticle[]>([]);

  useEffect(() => {
    fetchTheses();
    listNews({ limit: 6 })
      .then((res) => setNews(res.news))
      .catch(() => setNews([]));
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

  const openNews = useCallback(
    (article: NewsArticle) =>
      router.push({ pathname: "/(app)/news-detail", params: { id: article.id } } as any),
    [router]
  );

  const selectThesis = useCallback((thesis: ApiThesis) => {
    router.push({
      pathname: "/(app)/thesis-detail",
      params: { thesisId: thesis.id },
    } as any);
  }, [router]);

  const handleImport = useCallback(async () => {
    const store = useImportStore.getState();
    store.reset();
    const result = await store.pickAndImport();
    if (result === "ok") {
      const thesis = useImportStore.getState().thesis;
      if (thesis) {
        useThesisStore.getState().upsertThesis(thesis);
      }
      router.push("/(app)/import-analysis" as any);
    } else if (result === "error") {
      const msg = useImportStore.getState().errorMessage;
      Alert.alert(t("import.title"), msg || "Import failed");
    }
  }, [router, t]);

  const quickActions = [
    { icon: PenLine, label: t("home.newThesis"), color: colors.brandPrimary, onPress: () => router.push("/(app)/template-picker" as any) },
    { icon: FolderUp, label: t("home.importDocx"), color: "#9959FF", onPress: handleImport },
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
            <Button title={t("home.importExisting")} onPress={handleImport} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <View>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>{t("home.goodMorning")}</Text>
            <Text style={[styles.name, { color: colors.textPrimary }]}>Hamza</Text>
          </View>
          <Pressable onPress={() => router.push("/(tabs)/profile" as any)} hitSlop={6}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={[styles.avatar, { borderColor: colors.brandPrimaryLight, borderWidth: 2 }]} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]} />
            )}
          </Pressable>
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

        <View style={styles.grid}>
          {apiTheses.map((thesis, i) => {
            const progressColors = [colors.brandPrimary, colors.brandAccent, colors.semanticWarning];
            const progressColor = progressColors[i % progressColors.length];
            const progress = Math.max(0, Math.min(100, Math.round(thesis.progress || 0)));
            const pageCount = thesis.pageCount ?? 0;
            const wordCount = thesis.wordCount ?? 0;
            return (
              <Pressable key={thesis.id} onPress={() => selectThesis(thesis)} style={{ width: cardWidth }}>
                <Card style={styles.thesisCard}>
                  <View style={styles.cardTop}>
                    <View style={[styles.cardIcon, { backgroundColor: progressColor + "22" }]}>
                      <FileText size={18} color={progressColor} strokeWidth={1.8} />
                    </View>
                    <Text style={[styles.cardProgressPct, { color: progressColor }]}>{progress}%</Text>
                  </View>

                  <Text numberOfLines={3} style={[styles.thesisTitle, { color: colors.textPrimary }]}>
                    {thesis.title}
                  </Text>

                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <Layers size={13} color={colors.textSecondary} strokeWidth={1.8} />
                      <Text style={[styles.statText, { color: colors.textSecondary }]}>
                        {pageCount} {t("home.pages", { defaultValue: "Pages" })}
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <List size={13} color={colors.textSecondary} strokeWidth={1.8} />
                      <Text style={[styles.statText, { color: colors.textSecondary }]}>
                        {wordCount.toLocaleString()} {t("home.words")}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.progressBg, { backgroundColor: colors.bgSurface }]}>
                    <View style={[styles.progressFill, { backgroundColor: progressColor, width: `${progress || 4}%` }]} />
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>

        {news.length > 0 && (
          <View style={styles.newsSection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("home.modakeratiNews")}</Text>
              <Pressable onPress={() => router.push("/(app)/news" as any)} style={styles.seeAll} hitSlop={8}>
                <Text style={[styles.seeAllText, { color: colors.brandPrimary }]}>{t("common.seeAll")}</Text>
                <ChevronRight size={16} color={colors.brandPrimary} strokeWidth={2.2} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.newsRow}>
              {news.map((a) => (
                <Pressable key={a.id} onPress={() => openNews(a)} style={[styles.newsCard, { backgroundColor: colors.bgCard }]}>
                  {a.imageUrl ? (
                    <Image source={{ uri: a.imageUrl }} style={styles.newsCardImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.newsCardImage, styles.newsCardPlaceholder, { backgroundColor: colors.bgSurface }]}>
                      <Newspaper size={22} color={colors.textPlaceholder} strokeWidth={1.5} />
                    </View>
                  )}
                  <View style={styles.newsCardBody}>
                    <Text style={[styles.newsCardCategory, { color: colors.brandPrimary }]} numberOfLines={1}>
                      {a.category.toUpperCase()}
                    </Text>
                    <Text style={[styles.newsCardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                      {a.title}
                    </Text>
                    <Text style={[styles.newsCardSummary, { color: colors.textSecondary }]} numberOfLines={2}>
                      {a.summary}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
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
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAllText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  newsSection: { gap: 12 },
  newsRow: { gap: 12, paddingRight: 4 },
  newsCard: { width: 230, borderRadius: 16, overflow: "hidden" },
  newsCardImage: { width: "100%", height: 120 },
  newsCardPlaceholder: { alignItems: "center", justifyContent: "center" },
  newsCardBody: { padding: 12, gap: 4 },
  newsCardCategory: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  newsCardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  newsCardSummary: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  thesisCard: { padding: 14, gap: 10, minHeight: 168 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardProgressPct: { fontSize: 13, fontFamily: "Inter_700Bold" },
  thesisTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19, flex: 1 },
  statsRow: { gap: 5 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  statText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cardWords: { fontSize: 11, fontFamily: "Inter_400Regular" },
  progressBg: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 16 },
  emptyIllustration: { width: 160, height: 160, borderRadius: 80, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  emptyButtons: { width: "100%", gap: 12, marginTop: 16 },
});
