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
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getThesis, getThesisOutline, type OutlineDTO } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import {
  Layers,
  List,
  Type,
  MessageSquare,
  ChevronRight,
  FileText,
} from "lucide-react-native";
import type { Thesis, ThesisStatus } from "@/types/thesis";

// getThesis() returns the thesis row (no structure — that lives in the .docx).
// Normalise defensively so the chat / workspace screens work after opening here.
function normalize(raw: any): Thesis {
  return {
    id: raw.id,
    title: raw.title,
    templateId: raw.templateId ?? undefined,
    language: raw.language ?? "fr",
    status: (raw.status ?? "active") as ThesisStatus,
    progress: raw.progress ?? 0,
    wordCount: raw.wordCount ?? 0,
    pageCount: raw.pageCount ?? 0,
    frontMatter: raw.frontMatter ?? undefined,
    resume: raw.resume ?? undefined,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export default function ThesisDetailScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  const [thesis, setThesis] = useState<Thesis | null>(null);
  // Docx-as-source structure: the Partie/Chapitre outline derived from the live
  // .docx. The DB section/chapter rows are no longer the source of truth here.
  const [outline, setOutline] = useState<OutlineDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Refetch on focus so AI edits to the .docx are reflected on return. The
  // thesis row gives status/progress/title; the outline gives the structure.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!thesisId) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        try {
          const [data, outlineData] = await Promise.all([
            getThesis(thesisId),
            getThesisOutline(thesisId).catch(() => null),
          ]);
          if (!active) return;
          const normalized = normalize(data);
          setThesis(normalized);
          setOutline(outlineData);
          // Mirror into the store so chat / workspace have the full record.
          useThesisStore.setState((state) => ({
            theses: [normalized, ...state.theses.filter((th) => th.id !== normalized.id)],
          }));
        } catch {
          if (active) setNotFound(true);
        }
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [thesisId])
  );

  const openChat = () => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    router.push("/(tabs)/chat" as any);
  };

  const openWorkspace = () => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    router.push({
      pathname: "/(app)/thesis-workspace",
      params: { thesisId: thesis.id },
    });
  };

  // Tapping a Partie opens the live-docx workspace scrolled to that heading
  // block (the .docx is the source of truth; editing happens there via the AI /
  // engine). `blockIndex` is the engine block index from the outline.
  const openSectionAt = (blockIndex?: number, title?: string) => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    if (typeof blockIndex === "number") {
      useWorkspaceStore.getState().selectBlock(blockIndex, title ?? "");
    }
    router.push({
      pathname: "/(app)/thesis-workspace",
      params: {
        thesisId: thesis.id,
        ...(typeof blockIndex === "number" ? { blockIndex: String(blockIndex) } : {}),
      },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>{t("thesis.thesisDetails")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !thesis) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>{t("thesis.thesisDetails")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>{t("thesis.noThesesFound")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Structure + counts come from the live .docx outline (the source of truth).
  // Unseeded theses (outline unavailable) show an empty list + the row's stats.
  const liveOutline = outline?.available ? outline : null;
  const outlineSections: { index?: number; title: string; chapterCount: number }[] = liveOutline
    ? liveOutline.sections.map((s) => ({ index: s.index, title: s.title, chapterCount: s.chapters.length }))
    : [];

  const sectionCount = liveOutline ? liveOutline.sectionCount : 0;
  const chapterCount = liveOutline ? liveOutline.chapterCount : 0;
  const wordCount = liveOutline ? liveOutline.wordCount : thesis.wordCount || 0;
  const progress = Math.max(0, Math.min(100, Math.round(thesis.progress || 0)));

  const statusLabelMap: Record<ThesisStatus, string> = {
    active: t("thesis.active"),
    completed: t("thesis.completed"),
    archived: t("thesis.archived"),
  };
  const thesisStatusColor =
    thesis.status === "completed"
      ? colors.semanticSuccess
      : thesis.status === "archived"
      ? colors.textSecondary
      : colors.brandPrimary;

  const stats = [
    { icon: Layers, value: sectionCount, label: t("home.sections") },
    { icon: List, value: chapterCount, label: t("home.chapters") },
    { icon: Type, value: wordCount.toLocaleString(), label: t("home.words") },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("thesis.thesisDetails")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View>
          <View style={[styles.heroIcon, { backgroundColor: thesisStatusColor + "22" }]}>
            <FileText size={24} color={thesisStatusColor} strokeWidth={1.8} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>{thesis.title}</Text>
          <View style={styles.heroMeta}>
            <View style={[styles.statusBadge, { backgroundColor: thesisStatusColor + "18" }]}>
              <Text style={[styles.statusBadgeText, { color: thesisStatusColor }]}>
                {statusLabelMap[thesis.status]}
              </Text>
            </View>
            <Text style={[styles.progressPct, { color: thesisStatusColor }]}>{progress}%</Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: colors.bgSurface }]}>
            <View style={[styles.progressFill, { backgroundColor: thesisStatusColor, width: `${progress || 4}%` }]} />
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <View key={i} style={[styles.statTile, { backgroundColor: colors.bgCard }]}>
              <s.icon size={18} color={colors.brandPrimary} strokeWidth={1.8} />
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Open workspace (primary) */}
        <Pressable onPress={openWorkspace} style={[styles.cta, { backgroundColor: colors.brandPrimary }]}>
          <FileText size={18} color="#FFFFFF" strokeWidth={2} />
          <Text style={styles.ctaText}>{t("workspace.open", { defaultValue: "Open workspace" })}</Text>
        </Pressable>

        {/* Continue in Chat (secondary) */}
        <Pressable
          onPress={openChat}
          style={[styles.ctaSecondary, { borderColor: colors.borderDefault }]}
        >
          <MessageSquare size={18} color={colors.brandPrimary} strokeWidth={2} />
          <Text style={[styles.ctaSecondaryText, { color: colors.brandPrimary }]}>
            {t("thesis.continueInChat")}
          </Text>
        </Pressable>

        {/* Sections (Parties) */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          {t("home.sections")} ({sectionCount})
        </Text>

        {sectionCount === 0 ? (
          <View style={[styles.emptyChapters, { backgroundColor: colors.bgSurface }]}>
            <Text style={[styles.emptyChaptersText, { color: colors.textSecondary }]}>
              {t("thesis.noChapters")}
            </Text>
          </View>
        ) : (
          outlineSections.map((sec, i) => (
            <Pressable key={`${sec.index ?? i}-${i}`} onPress={() => openSectionAt(sec.index, sec.title)}>
              <Card style={styles.chapterCard}>
                <View style={[styles.chapterNum, { backgroundColor: colors.bgSurface }]}>
                  <Text style={[styles.chapterNumText, { color: colors.textSecondary }]}>{i + 1}</Text>
                </View>
                <View style={styles.chapterInfo}>
                  <Text style={[styles.chapterTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                    {sec.title}
                  </Text>
                  <View style={styles.chapterMeta}>
                    <Text style={[styles.chapterMetaText, { color: colors.textSecondary }]}>
                      {sec.chapterCount} {t("home.chapters")}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={18} color={colors.textPlaceholder} strokeWidth={2} />
              </Card>
            </Pressable>
          ))
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
  topTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { padding: 20, gap: 20, paddingBottom: 60 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  heroTitle: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 29, marginBottom: 12 },
  heroMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  statusBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  progressPct: { fontSize: 15, fontFamily: "Inter_700Bold" },
  progressBg: { height: 7, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 7, borderRadius: 4 },
  statsRow: { flexDirection: "row", gap: 10 },
  statTile: { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
  },
  ctaText: { color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  ctaSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
  },
  ctaSecondaryText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyChapters: { borderRadius: 12, padding: 24, alignItems: "center" },
  emptyChaptersText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  chapterCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  chapterNum: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  chapterNumText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  chapterInfo: { flex: 1, gap: 5 },
  chapterTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  chapterMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  chapterMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
