import { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Minus, Plus, FileText } from "lucide-react-native";
import { getThesis } from "@/lib/api";
import { getTextDirection } from "@/lib/text-direction";
import { useThesisStore } from "@/stores/thesis-store";

interface Section { id: string; title: string; content: string }
interface Chapter { id: string; title: string; sections: Section[] }
interface ThesisDoc { id: string; title: string; language?: string; chapters: Chapter[] }

// A rendered page is either the cover or one chapter.
type Page = { kind: "cover" } | { kind: "chapter"; chapter: Chapter; index: number };

// Paper look stays white regardless of app theme — it's a document, not a UI surface.
const PAPER_BG = "#FFFFFF";
const INK = "#1A1A1A";
const INK_SOFT = "#333333";
const INK_MUTED = "#888888";
const RULE = "#E0E0E0";

export default function DocumentPreviewScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  // Instant header title from the store while the full doc loads.
  const fallbackTitle = useThesisStore((s) => s.theses.find((th) => th.id === thesisId)?.title ?? "");

  const [doc, setDoc] = useState<ThesisDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(0);

  // Y offset of each paper within the scroll content, for the page indicator.
  const pageOffsets = useRef<number[]>([]);

  useEffect(() => {
    let active = true;
    if (!thesisId) { setLoading(false); setFailed(true); return; }
    (async () => {
      try {
        const data = await getThesis(thesisId);
        if (active) { setDoc(data); setLoading(false); }
      } catch {
        if (active) { setFailed(true); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [thesisId]);

  const pages = useMemo<Page[]>(() => {
    if (!doc) return [];
    return [{ kind: "cover" }, ...doc.chapters.map((c, i) => ({ kind: "chapter" as const, chapter: c, index: i }))];
  }, [doc]);

  const totalPages = pages.length || 1;
  const scale = zoom / 100;
  const fs = (base: number) => Math.round(base * scale * 10) / 10; // scaled font size
  const paperWidth = Math.min(width - 32, 560);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y;
    const offs = pageOffsets.current;
    let cur = 0;
    for (let i = 0; i < offs.length; i++) {
      if (offs[i] !== undefined && y >= offs[i] - 140) cur = i;
    }
    if (cur !== page) setPage(cur);
  }

  const setPageOffset = (i: number) => (e: LayoutChangeEvent) => {
    pageOffsets.current[i] = e.nativeEvent.layout.y;
  };

  // Direction (LTR/RTL) per text block so Arabic theses render right-aligned.
  const dirStyle = (text: string) => {
    const dir = getTextDirection(text);
    return { textAlign: dir === "rtl" ? "right" : "left", writingDirection: dir } as const;
  };

  const headerTitle = doc?.title || fallbackTitle || t("preview.preview", { defaultValue: "Preview" });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {headerTitle}
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: "/(app)/export", params: { thesisId } })}
          style={[styles.exportButton, { backgroundColor: colors.brandPrimary }]}
        >
          <Text style={styles.exportButtonText}>{t("export.exportAs", { defaultValue: "Export" }).split(" ")[0]}</Text>
        </Pressable>
      </View>

      {/* Page + zoom bar */}
      <View style={[styles.pageInfoBar, { backgroundColor: colors.bgSurface }]}>
        <Text style={[styles.pageInfoText, { color: colors.textSecondary }]}>
          {t("preview.pageOf", { current: page + 1, total: totalPages, defaultValue: `Page ${page + 1} of ${totalPages}` })}
        </Text>
        <View style={styles.zoomControls}>
          <Pressable onPress={() => setZoom((z) => Math.max(60, z - 15))} style={styles.zoomButton} hitSlop={8}>
            <Minus size={16} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
          <Text style={[styles.zoomText, { color: colors.textPrimary }]}>{zoom}%</Text>
          <Pressable onPress={() => setZoom((z) => Math.min(200, z + 15))} style={styles.zoomButton} hitSlop={8}>
            <Plus size={16} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : failed ? (
        <View style={styles.centered}>
          <FileText size={40} color={colors.textPlaceholder} strokeWidth={1.6} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {t("preview.loadFailed", { defaultValue: "Couldn't load the document." })}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={[styles.previewArea, { backgroundColor: colors.bgPrimary }]}
          contentContainerStyle={styles.previewContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {pages.map((p, i) => (
            <View key={i} onLayout={setPageOffset(i)} style={[styles.paperShadow, { width: paperWidth }]}>
              <View style={[styles.paper, { width: paperWidth }]}>
                {p.kind === "cover" ? (
                  <View style={styles.cover}>
                    <Text style={[styles.coverKicker, { fontSize: fs(11) }]}>
                      {t("preview.thesis", { defaultValue: "THESIS" })}
                    </Text>
                    <Text style={[styles.coverTitle, { fontSize: fs(26) }, dirStyle(doc?.title ?? "")]}>
                      {doc?.title}
                    </Text>
                    <View style={styles.coverRule} />
                    <Text style={[styles.coverMeta, { fontSize: fs(12) }]}>
                      {t("preview.chaptersCount", { count: doc?.chapters.length ?? 0, defaultValue: `${doc?.chapters.length ?? 0} chapters` })}
                    </Text>
                  </View>
                ) : (
                  <ChapterPage chapter={p.chapter} index={p.index} fs={fs} dirStyle={dirStyle} t={t} />
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Page dots (only when there aren't too many to fit) */}
      {!loading && !failed && totalPages > 1 && totalPages <= 10 && (
        <View style={styles.dotsRow}>
          {pages.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === page ? colors.brandPrimary : colors.textPlaceholder + "44",
                  width: i === page ? 10 : 8,
                  height: i === page ? 10 : 8,
                },
              ]}
            />
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

function ChapterPage({
  chapter,
  index,
  fs,
  dirStyle,
  t,
}: {
  chapter: Chapter;
  index: number;
  fs: (n: number) => number;
  dirStyle: (text: string) => { textAlign: "left" | "right"; writingDirection: "ltr" | "rtl" };
  t: (k: string, o?: any) => string;
}) {
  const sections = chapter.sections ?? [];
  const hasAny = sections.some((s) => (s.content ?? "").trim() || (s.title ?? "").trim());
  return (
    <View>
      <Text style={[styles.paperChapterLabel, { fontSize: fs(11) }]}>
        {t("preview.chapter", { defaultValue: "Chapter" })} {index + 1}
      </Text>
      <Text style={[styles.paperTitle, { fontSize: fs(22) }, dirStyle(chapter.title)]}>{chapter.title}</Text>
      <View style={styles.paperDivider} />

      {!hasAny ? (
        <Text style={[styles.paperEmpty, { fontSize: fs(12) }]}>
          {t("preview.emptyChapter", { defaultValue: "No content yet." })}
        </Text>
      ) : (
        sections.map((sec) => {
          const paras = (sec.content ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
          return (
            <View key={sec.id} style={styles.section}>
              {!!sec.title?.trim() && (
                <Text style={[styles.paperSubheading, { fontSize: fs(15) }, dirStyle(sec.title)]}>{sec.title}</Text>
              )}
              {paras.length > 0 ? (
                paras.map((para, k) => (
                  <Text key={k} style={[styles.paperBody, { fontSize: fs(12), lineHeight: fs(20) }, dirStyle(para)]}>
                    {para}
                  </Text>
                ))
              ) : (
                <Text style={[styles.paperEmptyInline, { fontSize: fs(11.5) }]}>
                  {t("preview.emptySection", { defaultValue: "(empty)" })}
                </Text>
              )}
            </View>
          );
        })
      )}

      <Text style={[styles.pageNumber, { fontSize: fs(11) }]}>— {index + 1} —</Text>
    </View>
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
  exportButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  exportButtonText: { color: "#FFFFFF", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pageInfoBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  pageInfoText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  zoomControls: { flexDirection: "row", alignItems: "center", gap: 12 },
  zoomButton: { padding: 4 },
  zoomText: { fontSize: 14, fontFamily: "Inter_600SemiBold", minWidth: 44, textAlign: "center" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  previewArea: { flex: 1 },
  previewContent: { padding: 16, alignItems: "center", gap: 20, paddingBottom: 28 },
  paperShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  paper: { backgroundColor: PAPER_BG, borderRadius: 8, paddingHorizontal: 28, paddingVertical: 36, minHeight: 440 },
  cover: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 14 },
  coverKicker: { fontFamily: "Inter_600SemiBold", color: INK_MUTED, letterSpacing: 3 },
  coverTitle: { fontFamily: "Inter_700Bold", color: INK, textAlign: "center" },
  coverRule: { width: 60, height: 2, backgroundColor: RULE, marginVertical: 4 },
  coverMeta: { fontFamily: "Inter_400Regular", color: INK_MUTED },
  paperChapterLabel: {
    fontFamily: "Inter_500Medium",
    color: INK_MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  paperTitle: { fontFamily: "Inter_700Bold", color: INK, marginBottom: 12 },
  paperDivider: { height: 1, backgroundColor: RULE, marginBottom: 16 },
  section: { marginBottom: 8 },
  paperSubheading: { fontFamily: "Inter_600SemiBold", color: INK, marginBottom: 10, marginTop: 6 },
  paperBody: { fontFamily: "Inter_400Regular", color: INK_SOFT, marginBottom: 10 },
  paperEmpty: { fontFamily: "Inter_400Regular", color: INK_MUTED, fontStyle: "italic" },
  paperEmptyInline: { fontFamily: "Inter_400Regular", color: INK_MUTED, fontStyle: "italic", marginBottom: 8 },
  pageNumber: { fontFamily: "Inter_400Regular", color: "#999999", textAlign: "center", marginTop: 24 },
  dotsRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  dot: { borderRadius: 10 },
});
