import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Plus } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { useNavBarClearance } from "@/components/FloatingNavBar";
import { listTheses } from "@/lib/api";
import type { ThesisStatus } from "@/types/thesis";

type FilterKey = "all" | ThesisStatus;

interface ApiThesis {
  id: string;
  title: string;
  status: ThesisStatus;
  progress: number;
  updatedAt: string;
  // Stored stats from the thesis row (structure lives in the .docx, not the DB).
  pageCount?: number;
  wordCount?: number;
}

export default function AllThesesScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [theses, setTheses] = useState<ApiThesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const bottomPad = useNavBarClearance();

  // Re-fetch every time the tab regains focus so newly created theses appear
  // without a manual reload.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const data = await listTheses();
          if (active) setTheses(data);
        } catch {
          if (active) setTheses([]);
        }
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const countFor = (key: FilterKey) =>
    key === "all" ? theses.length : theses.filter((th) => th.status === key).length;

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: t("thesis.all"), count: countFor("all") },
    { key: "active", label: t("thesis.active"), count: countFor("active") },
    { key: "completed", label: t("thesis.completed"), count: countFor("completed") },
    { key: "archived", label: t("thesis.archived"), count: countFor("archived") },
  ];

  const filteredTheses =
    activeFilter === "all"
      ? theses
      : theses.filter((th) => th.status === activeFilter);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("thesis.myTheses")}
        </Text>
        <Pressable
          onPress={() => router.push("/(app)/template-picker" as any)}
          style={[styles.newButton, { backgroundColor: colors.brandPrimary }]}
        >
          <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={styles.newButtonText}>{t("template.startNew").split(" ").pop()}</Text>
        </Pressable>
      </View>

      {/* Filter tabs */}
      <View style={styles.filtersWrap}>
        <SegmentedTabs
          segments={filters}
          value={activeFilter}
          onChange={(key) => setActiveFilter(key as FilterKey)}
        />
      </View>

      {/* Thesis list */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
          </View>
        ) : filteredTheses.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t("thesis.noThesesFound")}
            </Text>
          </View>
        ) : (
          filteredTheses.map((thesis) => {
            const pageCount = thesis.pageCount ?? 0;
            const wordCount = thesis.wordCount ?? 0;
            const progress = Math.max(0, Math.min(100, Math.round(thesis.progress || 0)));

            return (
              <Pressable
                key={thesis.id}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/thesis-detail",
                    params: { thesisId: thesis.id },
                  } as any)
                }
              >
                <Card style={styles.thesisCard}>
                  <Text
                    style={[
                      styles.thesisTitle,
                      { color: colors.textPrimary },
                    ]}
                    numberOfLines={2}
                  >
                    {thesis.title}
                  </Text>
                  <View style={styles.thesisMeta}>
                    <Text
                      style={[
                        styles.metaText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {pageCount} {t("home.pages", { defaultValue: "Pages" })}
                    </Text>
                    <Text
                      style={[
                        styles.metaText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {wordCount.toLocaleString()} {t("home.words")}
                    </Text>
                    <Text
                      style={[
                        styles.progressPercent,
                        { color: colors.brandPrimary },
                      ]}
                    >
                      {progress}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressBg,
                      { backgroundColor: colors.bgSurface },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: colors.brandPrimary,
                          width: `${progress || 4}%`,
                        },
                      ]}
                    />
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  newButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  filtersWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 100,
  },
  thesisCard: {
    marginBottom: 0,
  },
  thesisTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
  },
  thesisMeta: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 10,
    alignItems: "center",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  progressPercent: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginLeft: "auto",
  },
  progressBg: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 5,
    borderRadius: 3,
  },
  emptyState: {
    paddingTop: 60,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});
