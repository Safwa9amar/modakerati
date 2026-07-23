import React, { useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus, Maximize2, Search as SearchIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { INSERT_BLOCKS, INSERT_CATEGORIES, filterBlocks, type InsertBlockDef } from "./insert-blocks";
import { pickAndInsertImage } from "@/lib/insert-image";

// Text kinds are applied in-place inside the Lexical editor (SlashPlugin owns the
// transform); structural kinds clear the /query first, flush, then fire a native
// thesis-doc-store op — see `pick()` below.
const TEXT_KINDS = ["h1", "h2", "h3", "quote", "bullet", "number"];

/**
 * The Notion-style "/" insert menu. A native RN overlay (NOT inside the Lexical
 * DOM editor) driven entirely by `insert-menu-store`. Two forms reachable from
 * the same store: a compact card that blooms at the caret's screen Y (recents,
 * or the categorized palette when recents are empty, plus a disabled "coming
 * soon" AI image-gen row), and a full-screen bottom sheet with the only search
 * field, filtering every category via `filterBlocks`. RTL/LTR mirrors the APP
 * language (useRTL — same convention as GlobalDockBar/AIDock/SearchPanel), not
 * the thesis content's direction.
 */
export function InsertMenu({ thesisId }: { thesisId: string }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { isRTL: rtl, flexDirection } = useRTL();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const open = useInsertMenuStore((s) => s.open);
  const mode = useInsertMenuStore((s) => s.mode);
  const query = useInsertMenuStore((s) => s.query);
  const anchor = useInsertMenuStore((s) => s.anchor);
  const recents = useInsertMenuStore((s) => s.recents);

  const label = (d: InsertBlockDef) => t(`insertMenu.block.${d.labelKey}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `label` closes over `t`, stable per session
  const filtered = useMemo(() => filterBlocks(query, label), [query]);

  // Bloom origin = the caret line (anchor.y, already an absolute screen Y — same
  // convention as FloatingPill's anchorY). Clamped so the card never spawns off
  // the top (status bar/header) or low enough to be swallowed by the keyboard.
  const minTop = insets.top + 56;
  const maxTop = Math.max(minTop, height - insets.bottom - 260);
  const top = Math.max(minTop, Math.min(anchor?.y ?? minTop, maxTop));

  // Bloom-in: the compact card unmounts on close (early return below), so this
  // mount-time effect re-fires every time the menu opens — a fresh 0→1 spring
  // each time, growing from the anchor via the transformOrigin set below.
  const bloomProgress = useSharedValue(0);
  useEffect(() => {
    bloomProgress.value = 0;
    bloomProgress.value = withSpring(1, { damping: 16, stiffness: 220 });
  }, [bloomProgress]);
  const bloom = useAnimatedStyle(() => ({
    opacity: bloomProgress.value,
    transform: [{ scale: 0.6 + 0.4 * bloomProgress.value }],
  }));

  if (!open) return null;

  const pick = async (d: InsertBlockDef) => {
    if (d.status !== "ready") return;
    const a = useInsertMenuStore.getState().anchor;
    useInsertMenuStore.getState().pushRecent(d.kind);
    useInsertMenuStore.getState().close();
    const lex = useLexicalEditorStore.getState();
    if (TEXT_KINDS.includes(d.kind)) {
      // Text block: SlashPlugin's INSERT_BLOCK_COMMAND handler deletes the
      // /query and transforms the current block in one editor.update().
      lex.dispatch("insert", JSON.stringify({ kind: d.kind }));
      return;
    }
    // Structural: clear the /query first (leaves an empty line), flush so the
    // deletion is durable, then fire the native op at the anchored index.
    lex.dispatch("insert", JSON.stringify({ kind: "clearSlash" }));
    await lex.flushEdits?.();
    if (!a) return;
    if (d.kind === "pageBreak") {
      await useThesisDocStore.getState().mutate(thesisId, { type: "startOnNewPage", indices: [a.index] });
    } else if (d.kind === "figure") {
      await pickAndInsertImage(thesisId, a.index);
    }
  };

  const Row = ({ d }: { d: InsertBlockDef }) => (
    <Pressable
      onPress={() => void pick(d)}
      disabled={d.status !== "ready"}
      accessibilityRole="button"
      accessibilityLabel={label(d)}
      accessibilityState={{ disabled: d.status !== "ready" }}
      style={({ pressed }) => [
        styles.row,
        { flexDirection, opacity: d.status !== "ready" ? 0.45 : pressed ? 0.6 : 1 },
      ]}
    >
      <d.Icon size={18} color={colors.textSecondary} />
      <Text style={[styles.rowLabel, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>
        {label(d)}
      </Text>
      {d.status === "soon" ? (
        <Text style={[styles.soon, { color: colors.textPlaceholder, backgroundColor: colors.bgSurface }]}>
          {t("insertMenu.comingSoon")}
        </Text>
      ) : null}
    </Pressable>
  );

  const Cat = ({ c }: { c: (typeof INSERT_CATEGORIES)[number] }) => {
    const items = filtered.filter((b) => b.category === c);
    if (!items.length) return null;
    return (
      <View>
        <Text
          style={[
            styles.cat,
            { color: colors.textPlaceholder, borderTopColor: colors.borderSubtle, textAlign: rtl ? "right" : "left" },
          ]}
        >
          {t(`insertMenu.cat.${c}`)}
        </Text>
        {items.map((d) => (
          <Row key={d.kind} d={d} />
        ))}
      </View>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={() => useInsertMenuStore.getState().close()} />
      {mode === "full" ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          style={[
            styles.sheet,
            {
              top: Math.max(40, insets.top + 8),
              paddingBottom: insets.bottom + 8,
              backgroundColor: colors.bgPrimary,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("insertMenu.title")}</Text>
          <View style={[styles.search, { backgroundColor: colors.bgSurface, flexDirection }]}>
            <SearchIcon size={16} color={colors.textPlaceholder} />
            <TextInput
              autoFocus
              placeholder={t("insertMenu.searchPlaceholder")}
              placeholderTextColor={colors.textPlaceholder}
              accessibilityLabel={t("insertMenu.searchPlaceholder")}
              value={query}
              onChangeText={(q) => useInsertMenuStore.getState().setQuery(q)}
              style={[styles.searchInput, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
            {INSERT_CATEGORIES.map((c) => (
              <Cat key={c} c={c} />
            ))}
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View
          style={[
            styles.card,
            bloom,
            {
              top,
              backgroundColor: colors.bgPrimary,
              borderColor: colors.borderSubtle,
              transformOrigin: rtl ? "top right" : "top left",
            },
          ]}
        >
          <Pressable
            style={[styles.expand, rtl ? { right: 12 } : { left: 12 }]}
            onPress={() => useInsertMenuStore.getState().expand()}
            accessibilityRole="button"
            accessibilityLabel={t("insertMenu.expandHint")}
          >
            <Maximize2 size={14} color={colors.textPlaceholder} />
          </Pressable>
          <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
          {/* Precedence: live /query filter wins over Recents (typing "/quote" after
              recents exist must show the Quote match, not stale recents); Recents
              only show for an EMPTY query; otherwise the full categorized palette. */}
          {query.trim() ? (
            INSERT_CATEGORIES.map((c) => <Cat key={c} c={c} />)
          ) : recents.length ? (
            <>
              <Text
                style={[
                  styles.cat,
                  styles.catFirst,
                  { color: colors.textPlaceholder, textAlign: rtl ? "right" : "left" },
                ]}
              >
                {t("insertMenu.recent")}
              </Text>
              {recents.map((k) => {
                const d = INSERT_BLOCKS.find((b) => b.kind === k);
                return d ? <Row key={k} d={d} /> : null;
              })}
            </>
          ) : (
            INSERT_CATEGORIES.map((c) => <Cat key={c} c={c} />)
          )}
          <View style={[styles.cat, { flexDirection, borderTopColor: colors.borderSubtle }]}>
            <Sparkles size={12} color={colors.brandPrimary} />
            <Text style={{ color: colors.textPlaceholder, fontSize: 11 }}>{t("insertMenu.aiSuggestions")}</Text>
          </View>
          <View
            style={[styles.aiSoon, { borderColor: colors.borderSubtle, flexDirection }]}
            accessible
            accessibilityState={{ disabled: true }}
          >
            <ImagePlus size={16} color={colors.textPlaceholder} />
            <Text style={{ color: colors.textPlaceholder, flex: 1, textAlign: rtl ? "right" : "left" }}>
              {t("insertMenu.block.imageGen")}
            </Text>
            <Text style={[styles.soon, { color: colors.textPlaceholder, backgroundColor: colors.bgSurface }]}>
              {t("insertMenu.comingSoon")}
            </Text>
          </View>
          <Pressable
            onPress={() => useInsertMenuStore.getState().expand()}
            style={[styles.exHint, { borderTopColor: colors.borderSubtle, flexDirection }]}
          >
            <SearchIcon size={12} color={colors.textPlaceholder} />
            <Text style={{ color: colors.textPlaceholder, fontSize: 11 }}>{t("insertMenu.expandHint")}</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 14,
    zIndex: 50,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    zIndex: 50,
  },
  grab: { width: 38, height: 4, borderRadius: 3, alignSelf: "center", marginVertical: 6 },
  title: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center", paddingBottom: 8 },
  search: {
    alignItems: "center",
    gap: 8,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", padding: 0 },
  cat: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingTop: 9,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 3,
    alignItems: "center",
    gap: 4,
  },
  catFirst: { borderTopWidth: 0, marginTop: 0 },
  row: { alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  rowLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  soon: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    overflow: "hidden",
  },
  aiSoon: {
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    margin: 2,
  },
  expand: { position: "absolute", top: 9, zIndex: 1 },
  exHint: { alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 5 },
});
