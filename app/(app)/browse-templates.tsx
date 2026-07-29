import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, FlatList, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { FileText, Search, X, GraduationCap, ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useProfileStore } from "@/stores/profile-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { BackButton } from "@/components/BackButton";
import { getStartingPoints } from "@/lib/api";
import type { StartingPoint } from "@/types/thesis";

/**
 * The escape hatch behind "Browse all templates" on the match-first screen.
 *
 * Same ranked data, shown as a list rather than one card. The three filter chips
 * the old picker had (university / discipline / language) are gone: the server
 * already orders by how well each option fits, so a single search field over the
 * results is enough, and filtering by university made no sense once the ladder
 * started answering that question itself.
 */
export default function BrowseTemplatesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t, i18n } = useTranslation();

  const profile = useProfileStore((s) => s.profile);
  const [points, setPoints] = useState<StartingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getStartingPoints({
          universityId: profile?.universityId ?? null,
          level: profile?.level ?? null,
          language: i18n.language,
        });
        if (!cancelled) setPoints(res);
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.universityId, profile?.level, i18n.language]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return points;
    return points.filter((p) => {
      const d = p.display;
      return (
        (d.title ?? "").toLowerCase().includes(q) ||
        (d.universityName ?? "").toLowerCase().includes(q) ||
        (d.universityName ?? "").includes(query.trim()) ||
        d.language.toLowerCase().includes(q) ||
        d.discipline.toLowerCase().includes(q)
      );
    });
  }, [points, query]);

  const handleSelect = (sp: StartingPoint) => {
    if (sp.templateId) {
      router.push(`/(app)/template-preview?templateId=${sp.templateId}` as any);
      return;
    }
    useThesisWizard.getState().set({
      normProfileId: sp.normProfileId,
      language: sp.display.language as any,
      step: "title",
    });
    router.push("/(app)/thesis-title" as any);
  };

  const renderItem = ({ item }: { item: StartingPoint }) => {
    const d = item.display;
    return (
      <Pressable
        onPress={() => handleSelect(item)}
        style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}
      >
        {d.thumbUrl ? (
          <Image source={{ uri: d.thumbUrl }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: colors.bgSurface }]}>
            <FileText size={18} color={colors.textSecondary} strokeWidth={1.8} />
          </View>
        )}

        <View style={styles.flex}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
            {d.title ?? t("startingPoint.noDocument")}
          </Text>

          {/* Only present for rungs 1-3 — the server nulls it below that. */}
          {d.universityName ? (
            <View style={styles.uniRow}>
              {d.logoUrl ? (
                <Image source={{ uri: d.logoUrl }} style={styles.uniLogo} resizeMode="contain" />
              ) : (
                <GraduationCap size={11} color={colors.textSecondary} strokeWidth={2} />
              )}
              <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                {d.universityName}
              </Text>
            </View>
          ) : null}

          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: colors.brandPrimary + "18" }]}>
              <Text style={[styles.badgeText, { color: colors.brandPrimary }]}>
                {t(`startingPoint.reason.${item.reason}`)}
              </Text>
            </View>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {d.language.toUpperCase()} · {d.citationStyle.toUpperCase()}
            </Text>
          </View>
        </View>

        <ChevronRight size={16} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.topRow}>
        <BackButton />
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{t("startingPoint.browseAll")}</Text>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.bgInput, borderColor: colors.borderSubtle }]}>
        <Search size={16} color={colors.textPlaceholder} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("startingPoint.searchPlaceholder")}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.searchInput, { color: colors.textPrimary }]}
          autoCorrect={false}
          spellCheck={false}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <X size={16} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={(p) => `${p.templateId ?? ""}:${p.normProfileId}`}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{t("startingPoint.empty")}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  screenTitle: { fontSize: 18, fontWeight: "700" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  centered: { paddingVertical: 40, alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  thumb: { width: 44, height: 58, borderRadius: 6 },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "600", marginBottom: 3 },
  uniRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  uniLogo: { width: 14, height: 14, borderRadius: 3 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  meta: { fontSize: 11 },
});
