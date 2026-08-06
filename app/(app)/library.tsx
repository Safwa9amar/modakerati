import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image, TextInput } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Search, X, FileText, Image as ImageIcon, Table as TableIcon } from "lucide-react-native";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useAuthHeader } from "@/hooks/useAuthHeader";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSourceStore } from "@/stores/source-store";
import { BackButton } from "@/components/BackButton";
import { LibraryGridSkeleton } from "@/components/skeletons/LibraryGridSkeleton";
import { thesisBlockImageUrl, type DocBlockDTO } from "@/lib/api";

// -----------------------------------------------------------------------------
// Everything the thesis is made of, in one grid: the figures and tables living in
// the document, and the source files uploaded against it. Before this page those
// three lived in three different places (the outline's Tables/Figures tabs and the
// Sources bottom sheet) and none of them could be seen side by side.
//
// Figures and tables are derived from the live block model, so a tile's `index` is
// a real block index — tapping one opens the writer at that block.
// -----------------------------------------------------------------------------

type Tab = "all" | "figures" | "tables" | "sources";

type Item =
  | { kind: "figure"; key: string; index: number; caption: string; block: Extract<DocBlockDTO, { kind: "image" }> }
  | { kind: "table"; key: string; index: number; caption: string; rows: number; cols: number }
  | { kind: "source"; key: string; title: string; filename: string; ready: boolean };

// Word table captions are a short paragraph next to the table (usually above it)
// that opens with a Table/Tableau/جدول keyword — same rule the outline uses.
function isTableCaption(s: string): boolean {
  if (!s || s.length > 200) return false;
  return /^(table|tableau)\b/i.test(s) || s.startsWith("جدول") || s.startsWith("الجدول");
}

function deriveTableCaption(blocks: DocBlockDTO[], i: number): string {
  for (const j of [i - 1, i + 1]) {
    const b = blocks[j];
    if (b && b.kind === "paragraph" && isTableCaption(b.text.trim())) return b.text.trim();
  }
  return "";
}

export default function LibraryScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const rtl = useRTL();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authHeader = useAuthHeader();

  const thesis = useThesisStore((s) => s.getCurrentThesis());
  const thesisId = thesis?.id;
  const doc = useThesisDocStore((s) => (thesisId ? s.byId[thesisId] : undefined));
  const docTick = useThesisDocStore((s) => (thesisId ? (s.tick[thesisId] ?? 0) : 0));
  const sources = useSourceStore((s) => (thesisId ? (s.byThesis[thesisId] ?? EMPTY_SOURCES) : EMPTY_SOURCES));
  const sourcesLoading = useSourceStore((s) => s.loading);
  // Primitive selector — never build an object/array in one.
  const sourcesLoaded = useSourceStore((s) => !!thesisId && !!s.byThesis[thesisId]);
  // True only before the first list lands. Once `byThesis` has an entry a
  // refetch is a background refresh, and swapping real tiles for grey ones
  // mid-session would be a regression, not a loading state.
  const loadingFirst = !!thesisId && sourcesLoading && !sourcesLoaded;

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (thesisId) void useSourceStore.getState().load(thesisId);
  }, [thesisId]);

  const items = useMemo<Item[]>(() => {
    // `available:false` is the legacy section/chapter model — it carries no blocks,
    // so a thesis on it contributes sources only.
    const blocks: DocBlockDTO[] = doc?.available ? doc.blocks : [];
    const out: Item[] = [];
    let figureNo = 0;
    let tableNo = 0;

    blocks.forEach((b, i) => {
      if (b.kind === "image") {
        figureNo += 1;
        out.push({
          kind: "figure",
          key: `fig-${b.index}`,
          index: b.index,
          caption: b.caption?.trim() || `${t("thesis.figure", { defaultValue: "Figure" })} ${figureNo}`,
          block: b,
        });
      } else if (b.kind === "table") {
        tableNo += 1;
        out.push({
          kind: "table",
          key: `tbl-${b.index}`,
          index: b.index,
          caption:
            deriveTableCaption(blocks, i) || `${t("thesis.table", { defaultValue: "Table" })} ${tableNo}`,
          rows: b.rows.length,
          cols: b.rows[0]?.length ?? 0,
        });
      }
    });

    for (const s of sources) {
      out.push({
        kind: "source",
        key: `src-${s.id}`,
        title: s.title || s.filename,
        filename: s.filename,
        ready: s.status === "ready",
      });
    }
    return out;
  }, [doc, sources, t]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (tab === "figures" && item.kind !== "figure") return false;
      if (tab === "tables" && item.kind !== "table") return false;
      if (tab === "sources" && item.kind !== "source") return false;
      if (!q) return true;
      const label = item.kind === "source" ? item.title : item.caption;
      return label.toLowerCase().includes(q);
    });
  }, [items, tab, query]);

  // Tapping a figure or table opens the writer scrolled to that block.
  const openBlock = (index: number) => {
    if (!thesisId) return;
    router.replace({
      pathname: "/(app)/thesis-workspace",
      params: { thesisId, blockIndex: String(index) },
    } as any);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: t("library.all") },
    { key: "figures", label: t("library.figures") },
    { key: "tables", label: t("library.tables") },
    { key: "sources", label: t("library.sources") },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.topBar, { flexDirection: rtl.flexDirection }]}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("drawer.library")}
        </Text>
        <View style={styles.topSpacer} />
      </View>

      <View style={[styles.tabs, { flexDirection: rtl.flexDirection }]}>
        {tabs.map((it) => {
          const active = it.key === tab;
          return (
            <Pressable
              key={it.key}
              onPress={() => setTab(it.key)}
              style={[styles.tab, active && { backgroundColor: colors.bgSurface }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: active ? colors.textPrimary : colors.textSecondary,
                    fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                  },
                ]}
              >
                {it.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* The grid only goes grey when there is genuinely nothing to show yet —
            figures and tables come off the resident block model and must never be
            replaced by placeholders while the sources request is in flight. */}
        {visible.length === 0 && loadingFirst ? (
          <LibraryGridSkeleton />
        ) : visible.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary, textAlign: rtl.textAlign }]}>
            {thesisId ? t("library.empty") : t("chat.pickThesis")}
          </Text>
        ) : (
          visible.map((item) => (
            <Tile
              key={item.key}
              item={item}
              thesisId={thesisId}
              docTick={docTick}
              authHeader={authHeader}
              colors={colors}
              rtl={rtl}
              onPress={item.kind === "source" ? undefined : () => openBlock(item.index)}
            />
          ))
        )}
      </ScrollView>

      {/* Search sits at the bottom, where the thumb already is. */}
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.bgInput,
            borderColor: colors.borderDefault,
            flexDirection: rtl.flexDirection,
            marginBottom: insets.bottom + 10,
          },
        ]}
      >
        <Search size={17} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("library.search")}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.searchInput, { color: colors.textPrimary, textAlign: rtl.textAlign }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <X size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function Tile({
  item,
  thesisId,
  docTick,
  authHeader,
  colors,
  rtl,
  onPress,
}: {
  item: Item;
  thesisId?: string;
  docTick: number;
  authHeader: Record<string, string> | null;
  colors: ReturnType<typeof useThemeColors>;
  rtl: ReturnType<typeof useRTL>;
  onPress?: () => void;
}) {
  const label = item.kind === "source" ? item.title : item.caption;

  let preview: React.ReactNode;
  if (item.kind === "figure") {
    const uri =
      item.block.dataUri ??
      (item.block.hasMedia && thesisId ? thesisBlockImageUrl(thesisId, item.block.index, docTick) : undefined);
    const needsAuth = !!uri && !uri.startsWith("data:");
    preview = uri ? (
      <Image
        source={needsAuth && authHeader ? { uri, headers: authHeader } : { uri }}
        style={styles.thumb}
        resizeMode="cover"
      />
    ) : (
      <View style={[styles.thumb, styles.glyphWrap, { backgroundColor: colors.bgSurface }]}>
        <ImageIcon size={22} color={colors.textSecondary} />
      </View>
    );
  } else if (item.kind === "table") {
    preview = (
      <View style={[styles.thumb, styles.glyphWrap, { backgroundColor: colors.bgSurface }]}>
        <TableIcon size={22} color={colors.brandAccent} />
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {item.rows}×{item.cols}
        </Text>
      </View>
    );
  } else {
    preview = (
      <View style={[styles.thumb, styles.glyphWrap, { backgroundColor: colors.bgSurface }]}>
        <FileText size={22} color={item.ready ? colors.brandPrimary : colors.textSecondary} />
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.filename}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.tile, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}
      accessibilityRole={onPress ? "button" : undefined}
    >
      {preview}
      <Text
        style={[styles.tileLabel, { color: colors.textPrimary, textAlign: rtl.textAlign }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const EMPTY_SOURCES: never[] = [];

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  topSpacer: { width: 30 },
  tabs: { gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  tabLabel: { fontSize: 13 },
  grid: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    width: "47.5%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingBottom: 9,
  },
  thumb: { width: "100%", height: 104 },
  glyphWrap: { alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 },
  meta: { fontSize: 10.5, fontFamily: "Inter_400Regular" },
  tileLabel: { fontSize: 12, fontFamily: "Inter_500Medium", paddingHorizontal: 10, paddingTop: 8 },
  empty: { fontSize: 13.5, fontFamily: "Inter_400Regular", paddingVertical: 40, width: "100%" },
  searchBar: {
    alignItems: "center",
    gap: 9,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
});
