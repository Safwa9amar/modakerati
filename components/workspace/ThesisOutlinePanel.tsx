import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { Search, X, ChevronDown, ChevronRight, ChevronLeft, ChevronsDownUp } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";
import { useOutlineStore } from "@/stores/outline-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { type OutlineNodeDTO } from "@/lib/api";
import { normalize } from "@/lib/text-normalize";

// Whether any heading title contains Arabic/Hebrew letters → render right-to-left.
// thesis.language is unreliable for imports, so detect direction from the content.
function isRtlText(s: string): boolean {
  return /[֐-ࣿ]/.test(s);
}

const INDENT_STEP = 16;
type FlatRow = { node: OutlineNodeDTO; depth: number; hasChildren: boolean; collapsed: boolean };

// Pre-order DFS → a flat [{ node, depth }] list the FlatList can virtualize. A
// collapsed node contributes its own row but NOT its descendants, so the tree can
// be folded at any level.
function flattenOutline(
  nodes: OutlineNodeDTO[],
  collapsed: Set<number>,
  depth = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const n of nodes) {
    const hasChildren = n.children.length > 0;
    const isCollapsed = collapsed.has(n.index);
    out.push({ node: n, depth, hasChildren, collapsed: isCollapsed });
    if (hasChildren && !isCollapsed) flattenOutline(n.children, collapsed, depth + 1, out);
  }
  return out;
}

// Every node that HAS children — the set that "collapse all" folds.
function collectParents(nodes: OutlineNodeDTO[], out: number[] = []): number[] {
  for (const n of nodes) {
    if (n.children.length) {
      out.push(n.index);
      collectParents(n.children, out);
    }
  }
  return out;
}

// A single heading row: [collapse chevron?] [bullet] [title], indented by depth.
// Top-level headings are emphasised; the active one is the "you are here" highlight.
function OutlineRow({
  node,
  depth,
  rtl,
  active,
  hasChildren,
  collapsed,
  showChevron,
  colors,
  onPress,
  onToggle,
}: {
  node: OutlineNodeDTO;
  depth: number;
  rtl: boolean;
  active: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  showChevron: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onPress: (index: number, title: string) => void;
  onToggle: (index: number) => void;
}) {
  const isTop = depth === 0;
  const indent = depth * INDENT_STEP;
  const bulletColor = active || isTop ? colors.brandPrimary : colors.textSecondary;
  const textColor = active ? colors.brandPrimary : isTop ? colors.textPrimary : colors.textSecondary;
  const Collapsed = rtl ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      onPress={() => onPress(node.index, node.title)}
      style={[
        styles.row,
        active && { backgroundColor: colors.brandPrimary + "14", borderRadius: 8 },
        {
          flexDirection: rtl ? "row-reverse" : "row",
          paddingLeft: rtl ? 0 : indent,
          paddingRight: rtl ? indent : 0,
        },
      ]}
    >
      {showChevron && hasChildren ? (
        <Pressable onPress={() => onToggle(node.index)} hitSlop={8} style={styles.chevronBtn}>
          {collapsed ? (
            <Collapsed size={16} color={colors.textSecondary} />
          ) : (
            <ChevronDown size={16} color={colors.textSecondary} />
          )}
        </Pressable>
      ) : (
        showChevron && <View style={styles.chevronBtn} />
      )}
      <View
        style={[
          styles.bullet,
          {
            backgroundColor: bulletColor,
            width: active || isTop ? 7 : 5,
            height: active || isTop ? 7 : 5,
            borderRadius: active || isTop ? 3.5 : 2.5,
            opacity: active || isTop ? 1 : 0.55,
          },
        ]}
      />
      <Text
        style={[
          isTop ? styles.rowTitleTop : styles.rowTitle,
          active && styles.rowTitleActive,
          { color: textColor, textAlign: rtl ? "right" : "left" },
        ]}
        numberOfLines={2}
      >
        {node.title}
      </Text>
    </Pressable>
  );
}

/**
 * The Thesis Structure navigator's CONTENTS — the heading tree as a virtualized,
 * searchable, collapsible list. Hosted by the root `PushDrawer`. Reads the cached
 * `outline-store` (instant, no fetch on open). Highlights the heading the reader is
 * under ("you are here"); tapping a heading closes the drawer and scrolls to it.
 */
export function ThesisOutlinePanel() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const thesis = useThesisStore((s) => s.getCurrentThesis());
  const open = useNavDrawerStore((s) => s.open);
  // Stable-ref selector (the stored object, or undefined) → no zustand loop.
  const outline = useOutlineStore((s) => (thesis ? s.byId[thesis.id] : undefined));
  // "You are here" anchor: the caret's block while inline-editing, else the block
  // at the top of the doc view (from the outline view's scroll). Primitive selectors.
  const activeBlockIndex = useWorkspaceStore((s) => s.activeBlockIndex);
  const editingBlockIndex = useWorkspaceStore((s) => s.editingBlockIndex);
  const listRef = useRef<FlatList<FlatRow>>(null);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  // Fresh state per thesis; drop the query each time the drawer closes.
  useEffect(() => {
    setQuery("");
    setCollapsed(new Set());
  }, [thesis?.id]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // On open, paint from cache ONLY (no fetch). If nothing is cached yet (e.g. the
  // user opened the drawer from chat before ever entering the workspace), fall
  // back to a one-time sync so the panel is never permanently empty — but only
  // while there are no unsynced local edits: with edits queued on-device the
  // server outline is stale by definition, so we stick to the local copy until
  // the document itself syncs (the workspace drain effect re-syncs it then).
  useEffect(() => {
    if (!open || !thesis) return;
    const store = useOutlineStore.getState();
    void store.hydrate(thesis.id).then(() => {
      const unsynced = (useThesisDocStore.getState().pending[thesis.id] ?? 0) > 0;
      if (!unsynced && useOutlineStore.getState().byId[thesis.id] === undefined) void store.sync(thesis.id);
    });
  }, [open, thesis?.id]);

  const liveOutline = outline?.available ? outline : null;
  const nodes: OutlineNodeDTO[] = liveOutline ? liveOutline.nodes : [];
  const sectionCount = liveOutline ? liveOutline.sectionCount : 0;
  const chapterCount = liveOutline ? liveOutline.chapterCount : 0;
  const rtl = nodes.length > 0 && isRtlText(nodes.map((n) => n.title).join(" "));

  // Fully-expanded flatten drives search + the active-heading calc (both ignore
  // the collapse state). Browsing uses the collapsed flatten.
  const allRows = flattenOutline(nodes, EMPTY_SET);
  const q = normalize(query);
  const searching = q.length > 0;
  const visibleRows = searching
    ? allRows.filter((r) => normalize(r.node.title).includes(q))
    : flattenOutline(nodes, collapsed);

  // The active heading = the last heading whose block index is ≤ the anchor. Rows
  // are document-ordered (pre-order DFS → increasing index), so scan-keep-last.
  const anchor = editingBlockIndex ?? activeBlockIndex;
  let activeNodeIndex: number | null = null;
  if (anchor != null) {
    for (const r of allRows) {
      if (r.node.index <= anchor) activeNodeIndex = r.node.index;
      else break;
    }
  }

  // When the drawer opens, bring the active ("you are here") heading into view.
  // Only on the open transition — never on scroll updates, or the list would jump
  // around under the reader.
  useEffect(() => {
    if (!open || activeNodeIndex == null) return;
    const pos = visibleRows.findIndex((r) => r.node.index === activeNodeIndex);
    if (pos < 0) return;
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: pos, viewPosition: 0.35, animated: false });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleCollapse = (index: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  // Collapse-all folds every parent to top level; if anything's already folded,
  // the button expands all instead.
  const collapseAllToggle = () =>
    setCollapsed((prev) => (prev.size > 0 ? new Set() : new Set(collectParents(nodes))));

  // Tap any heading → close the drawer and bring that block into view.
  function handleHeadingPress(index: number, title: string) {
    if (!thesis) return;
    useNavDrawerStore.getState().closeDrawer();
    const ws = useWorkspaceStore.getState();
    ws.selectBlock(index, title);
    ws.requestScrollToBlock(index);
    // Already in the workspace → scroll in place; else navigate there.
    if (pathname?.includes("thesis-workspace")) return;
    router.push({
      pathname: "/(app)/thesis-workspace",
      params: { thesisId: thesis.id, blockIndex: String(index) },
    });
  }

  return (
    <View style={[styles.panel, { backgroundColor: colors.bgModal }]}>
      {/* Sticky header: title + collapse-all, counts, and the search field. */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={[styles.titleRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <Text
            style={[styles.title, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}
            numberOfLines={1}
          >
            {t("thesis.thesisStructure")}
          </Text>
          <Pressable
            onPress={() => useNavDrawerStore.getState().closeDrawer()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close", { defaultValue: "Close" })}
            style={styles.iconBtn}
          >
            <X size={24} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={[styles.statusRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <View style={[styles.statusBadges, { flexDirection: rtl ? "row-reverse" : "row" }]}>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: colors.brandPrimary }]} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>{sectionCount} {t("home.sections")}</Text>
            </View>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: colors.brandAccent }]} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>{chapterCount} {t("home.chapters")}</Text>
            </View>
          </View>
          {nodes.length > 0 && (
            <Pressable
              onPress={collapseAllToggle}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("thesis.collapseAll", { defaultValue: "Collapse all" })}
              style={styles.iconBtn}
            >
              <ChevronsDownUp size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.bgInput, borderColor: colors.borderDefault, flexDirection: rtl ? "row-reverse" : "row" },
          ]}
        >
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("thesis.searchHeadings", { defaultValue: "Search headings" })}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.searchInput, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <X size={16} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={visibleRows}
        keyExtractor={(item) => String(item.node.index)}
        renderItem={({ item }) => (
          <OutlineRow
            node={item.node}
            depth={searching ? 0 : item.depth}
            rtl={rtl}
            active={item.node.index === activeNodeIndex}
            hasChildren={item.hasChildren}
            collapsed={item.collapsed}
            showChevron={!searching}
            colors={colors}
            onPress={handleHeadingPress}
            onToggle={toggleCollapse}
          />
        )}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={16}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
        }}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}>
            {searching
              ? t("thesis.noMatches", { defaultValue: "No headings match your search." })
              : t("thesis.noChapters", { defaultValue: "No headings found in this document yet." })}
          </Text>
        }
      />
    </View>
  );
}

// Shared empty set for the fully-expanded flatten (never mutated).
const EMPTY_SET: Set<number> = new Set();

const styles = StyleSheet.create({
  panel: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  titleRow: { alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  iconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  statusRow: { alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  statusBadges: { flexDirection: "row", alignItems: "center", gap: 16 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  searchBox: {
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  content: { paddingHorizontal: 20, paddingTop: 6 },
  chevronBtn: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  row: { alignItems: "center", gap: 10, paddingVertical: 9 },
  bullet: { flexShrink: 0 },
  rowTitleTop: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
  rowTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  rowTitleActive: { fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 24 },
});
