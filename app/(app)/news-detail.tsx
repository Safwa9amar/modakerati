import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { RenderHtml } from "@/components/RenderHtml";
import { getNewsArticle, recordNewsClick } from "@/lib/api";
import { Eye, ExternalLink, Newspaper } from "lucide-react-native";
import type { NewsArticle } from "@/types/news";

export default function NewsDetailScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      try {
        // GET /news/:id also bumps the view counter server-side.
        const data = await getNewsArticle(id);
        if (active) setArticle(data);
      } catch {
        if (active) setNotFound(true);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const onCta = () => {
    if (!article) return;
    void recordNewsClick(article.id);
    if (article.ctaHref) Linking.openURL(article.ctaHref).catch(() => {});
  };

  const formatDate = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("news.title")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : notFound || !article ? (
        <View style={styles.centered}>
          <Newspaper size={48} color={colors.textSecondary} strokeWidth={1.5} />
          <Text style={{ color: colors.textSecondary }}>{t("news.notFound")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {article.imageUrl ? (
            <Image source={{ uri: article.imageUrl }} style={styles.cover} resizeMode="cover" />
          ) : null}

          <View style={styles.metaRow}>
            <View style={[styles.categoryBadge, { backgroundColor: colors.brandPrimary + "1A" }]}>
              <Text style={[styles.categoryText, { color: colors.brandPrimary }]}>{article.category}</Text>
            </View>
            <View style={styles.viewsRow}>
              <Eye size={13} color={colors.textSecondary} strokeWidth={2} />
              <Text style={[styles.viewsText, { color: colors.textSecondary }]}>{article.views}</Text>
            </View>
          </View>

          <Text style={[styles.articleTitle, { color: colors.textPrimary }]}>{article.title}</Text>
          {article.publishedAt ? (
            <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDate(article.publishedAt)}</Text>
          ) : null}

          {article.summary ? (
            <Text style={[styles.summary, { color: colors.textSecondary }]}>{article.summary}</Text>
          ) : null}

          {/* HTML body rendered in the themed WebView viewer */}
          {article.body ? (
            <View style={styles.htmlWrap}>
              <RenderHtml html={article.body} />
            </View>
          ) : null}

          {article.ctaLabel ? (
            <Pressable onPress={onCta} style={[styles.cta, { backgroundColor: colors.brandPrimary }]}>
              <Text style={styles.ctaText}>{article.ctaLabel}</Text>
              {article.ctaHref ? <ExternalLink size={16} color="#FFFFFF" strokeWidth={2} /> : null}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  topTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 32 },
  content: { padding: 20, paddingBottom: 60, gap: 12 },
  cover: { width: "100%", height: 200, borderRadius: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  categoryBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  categoryText: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  viewsRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  viewsText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  articleTitle: { fontSize: 25, fontFamily: "Inter_700Bold", lineHeight: 32 },
  date: { fontSize: 13, fontFamily: "Inter_400Regular" },
  summary: { fontSize: 15, fontFamily: "Inter_500Medium", lineHeight: 23 },
  htmlWrap: { marginTop: 4 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14, marginTop: 8 },
  ctaText: { color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
