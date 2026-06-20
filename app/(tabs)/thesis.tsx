import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { Plus } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { ThesisStatus } from "@/types/thesis";

type FilterKey = "all" | ThesisStatus;

export default function AllThesesScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { theses } = useThesisStore();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

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
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {filteredTheses.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No theses found
            </Text>
          </View>
        ) : (
          filteredTheses.map((thesis) => {
            const totalChapters = thesis.chapters.length;
            const doneChapters = thesis.chapters.filter(
              (ch) => ch.status === "done"
            ).length;
            const progress = thesis.progress || 0;

            return (
              <Pressable
                key={thesis.id}
                onPress={() => {
                  useThesisStore.getState().setCurrentThesis(thesis.id);
                  router.push("/(tabs)/chat" as any);
                }}
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
                      {totalChapters} chapters
                    </Text>
                    <Text
                      style={[
                        styles.metaText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {doneChapters}/{totalChapters} done
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
                          width: `${progress}%`,
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
