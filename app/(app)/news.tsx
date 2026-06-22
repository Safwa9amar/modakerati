import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { useNavBarClearance } from "@/components/FloatingNavBar";
import { listNews, getNewsCategories } from "@/lib/api";
import { Search, Eye, Pin, Newspaper } from "lucide-react-native";
import type { NewsArticle } from "@/types/news";

const PAGE_SIZE = 20;

export default function NewsListScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { textAlign } = useRTL();
  const bottomPad = useNavBarClearance();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);

  // Debounce the search field so we don't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    getNewsCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(
    async (opts?: { refresh?: boolean }) => {
      pageRef.current = 1;
      if (opts?.refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await listNews({ q: debounced, category, page: 1, limit: PAGE_SIZE });
        setArticles(res.news);
        setTotal(res.pagination.total);
      } catch {
        setArticles([]);
        setTotal(0);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [debounced, category]
  );

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || articles.length >= total) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const res = await listNews({ q: debounced, category, page: next, limit: PAGE_SIZE });
      setArticles((prev) => [...prev, ...res.news]);
      pageRef.current = next;
    } catch {
      // keep what we have
    }
    setLoadingMore(false);
  }, [loadingMore, articles.length, total, debounced, category]);

  const openArticle = (a: NewsArticle) =>
    router.push({ pathname: "/(app)/news-detail", params: { id: a.id } } as any);

  const filters = ["all", ...categories];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("news.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchBox, { backgroundColor: colors.bgInput, borderColor: colors.borderSubtle }]}>
          <Search size={18} color={colors.textPlaceholder} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("news.searchPlaceholder")}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.searchInput, { color: colors.textPrimary, textAlign }]}
            returnKeyType="search"
          />
        </View>
      </View>

      {/* Category filter chips */}
      {filters.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chips}>
          {filters.map((cat) => {
            const active = cat === category;
            return (
              <Pressable
                key={cat}
                onPress={() => setCategory(cat)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.brandPrimary : colors.bgCard,
                    borderColor: active ? colors.brandPrimary : colors.borderSubtle,
                  },
                ]}>
                <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.textSecondary }]}>
                  {cat === "all" ? t("news.allCategories") : cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : articles.length === 0 ? (
        <View style={styles.centered}>
          <Newspaper size={48} color={colors.textSecondary} strokeWidth={1.5} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t("news.empty")}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load({ refresh: true })}
              tintColor={colors.brandPrimary}
            />
          }
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) loadMore();
          }}
          scrollEventThrottle={400}>
          {articles.map((a) => (
            <Pressable key={a.id} onPress={() => openArticle(a)}>
              <Card style={styles.newsCard}>
                {a.imageUrl ? (
                  <Image source={{ uri: a.imageUrl }} style={styles.newsImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.newsImage, { backgroundColor: colors.bgSurface, alignItems: "center", justifyContent: "center" }]}>
                    <Newspaper size={22} color={colors.textPlaceholder} strokeWidth={1.5} />
                  </View>
                )}
                <View style={styles.newsBody}>
                  <View style={styles.newsMetaTop}>
                    <Text style={[styles.newsCategory, { color: colors.brandPrimary }]} numberOfLines={1}>
                      {a.category.toUpperCase()}
                    </Text>
                    {a.pinned && <Pin size={12} color={colors.semanticWarning} strokeWidth={2} fill={colors.semanticWarning} />}
                  </View>
                  <Text style={[styles.newsTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                    {a.title}
                  </Text>
                  <Text style={[styles.newsSummary, { color: colors.textSecondary }]} numberOfLines={2}>
                    {a.summary}
                  </Text>
                  <View style={styles.newsFooter}>
                    <Eye size={12} color={colors.textPlaceholder} strokeWidth={2} />
                    <Text style={[styles.newsViews, { color: colors.textPlaceholder }]}>{a.views}</Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))}
          {loadingMore && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 12 }} />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  searchWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 46 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  chips: { maxHeight: 44, flexGrow: 0 },
  chipsRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 32 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  list: { paddingHorizontal: 20, gap: 12, paddingBottom: 100 },
  newsCard: { flexDirection: "row", gap: 12, padding: 12 },
  newsImage: { width: 96, height: 96, borderRadius: 12 },
  newsBody: { flex: 1, gap: 4 },
  newsMetaTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  newsCategory: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5, flex: 1 },
  newsTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  newsSummary: { fontSize: 12.5, fontFamily: "Inter_400Regular", lineHeight: 18 },
  newsFooter: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  newsViews: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
