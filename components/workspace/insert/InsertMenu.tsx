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
import Animated, { useAnimatedStyle, useSharedValue, withSpring, SlideInDown, runOnJS } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus, Maximize2, Search as SearchIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSettingsStore } from "@/stores/settings-store";
import { INSERT_BLOCKS, INSERT_CATEGORIES, filterBlocks, type InsertBlockDef } from "./insert-blocks";
import { pickAndInsertImage } from "@/lib/insert-image";

// Text kinds are applied in-place inside the Lexical editor (SlashPlugin owns the
// transform); structural kinds clear the /query first, flush, then fire a native
// thesis-doc-store op — see `pick()` below.
const TEXT_KINDS = ["h1", "h2", "h3", "quote", "bullet", "number"];

// Module-stable wrappers so gesture worklets can runOnJS them without a fresh
// closure per render (they always read the live store via getState()).
const expandMenu = () => useInsertMenuStore.getState().expand();
const collapseMenu = () => useInsertMenuStore.getState().collapse();
const closeMenu = () => useInsertMenuStore.getState().close();

/**
 * The Notion-style "/" insert menu. A native RN overlay (NOT inside the Lexical
 * DOM editor) driven entirely by `insert-menu-store`. Two forms from the same
 * store: a compact card that blooms at the caret (recently-used pinned on top +
 * the full categorized palette below, plus an AI-suggestions section gated by
 * the autocomplete setting), and a full-screen bottom sheet with the only search
 * field. Drag the grab handle up to expand / down to collapse. RTL/LTR mirror the
 * APP language (useRTL — same convention as GlobalDockBar/AIDock/SearchPanel).
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
  // The AI-suggestions section is hidden when the student turned AI assistance off
  // in Settings (same flag that gates inline autocomplete).
  const aiEnabled = useSettingsStore((s) => s.autocompleteEnabled);

  const label = (d: InsertBlockDef) => t(`insertMenu.block.${d.labelKey}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `label` closes over `t`, stable per session
  const filtered = useMemo(() => filterBlocks(query, label), [query]);

  // Position the compact card AT the slash line (anchor.y = the caret line's
  // absolute screen Y). If the caret sits low on screen, flip the card ABOVE the
  // line so it grows toward the visible doc instead of off the bottom; either way
  // the body scrolls, capped to the available space, so it never overflows.
  const GAP = 8;
  const minTop = insets.top + 56;
  const anchorY = anchor?.y ?? height * 0.4;
  const spaceBelow = height - insets.bottom - anchorY - GAP;
  const spaceAbove = anchorY - minTop - GAP;
  const openUp = spaceBelow < spaceAbove && spaceBelow < 340;
  // Reserve room for the grab zone (~34) + the fixed "search all" footer (~40).
  const listMaxHeight = Math.max(150, Math.min((openUp ? spaceAbove : spaceBelow) - 74, 400));

  // Bloom-in: re-fires each time the compact card opens (deps on open/mode; the
  // component never unmounts). Snappy pop — low mass + high stiffness.
  const bloomProgress = useSharedValue(0);
  useEffect(() => {
    if (open && mode === "compact") {
      bloomProgress.value = 0;
      bloomProgress.value = withSpring(1, { mass: 0.4, damping: 14, stiffness: 320 });
    }
  }, [open, mode, bloomProgress]);
  const bloom = useAnimatedStyle(() => ({
    opacity: bloomProgress.value,
    transform: [{ scale: 0.6 + 0.4 * bloomProgress.value }],
  }));

  // Grab-handle gestures. Compact: drag up → expand, drag down → close. Full:
  // drag down → collapse to compact (far → close). Attached to the handle only,
  // so the body ScrollView still scrolls independently.
  const compactPan = useMemo(
    () =>
      Gesture.Pan().onEnd((e) => {
        "worklet";
        if (e.translationY < -30) runOnJS(expandMenu)();
        else if (e.translationY > 60) runOnJS(closeMenu)();
      }),
    [],
  );
  const fullPan = useMemo(
    () =>
      Gesture.Pan().onEnd((e) => {
        "worklet";
        if (e.translationY > 140) runOnJS(closeMenu)();
        else if (e.translationY > 40) runOnJS(collapseMenu)();
      }),
    [],
  );

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

  const Row = ({ d }: { d: InsertBlockDef }) => {
    const ready = d.status === "ready";
    return (
      <Pressable
        onPress={() => void pick(d)}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={label(d)}
        accessibilityState={{ disabled: !ready }}
        style={({ pressed }) => [
          styles.row,
          { flexDirection, backgroundColor: pressed && ready ? colors.bgSurface : "transparent", opacity: ready ? 1 : 0.45 },
        ]}
      >
        <d.Icon size={18} color={ready ? colors.textSecondary : colors.textPlaceholder} />
        <Text style={[styles.rowLabel, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>{label(d)}</Text>
        {!ready ? (
          <Text style={[styles.soon, { color: colors.textPlaceholder, backgroundColor: colors.bgSurface }]}>
            {t("insertMenu.comingSoon")}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const CatHeader = ({ text, first }: { text: string; first?: boolean }) => (
    <Text
      style={[
        styles.cat,
        first && styles.catFirst,
        { color: colors.textPlaceholder, borderTopColor: colors.borderSubtle, textAlign: rtl ? "right" : "left" },
      ]}
    >
      {text}
    </Text>
  );

  const Cat = ({ c, first }: { c: (typeof INSERT_CATEGORIES)[number]; first?: boolean }) => {
    const items = filtered.filter((b) => b.category === c);
    if (!items.length) return null;
    return (
      <View>
        <CatHeader text={t(`insertMenu.cat.${c}`)} first={first} />
        {items.map((d) => (
          <Row key={d.kind} d={d} />
        ))}
      </View>
    );
  };

  // The tool list: recently-used pinned on top (for fast access), then the FULL
  // categorized palette. While filtering (/query or search), just the matches.
  const ToolList = () =>
    query.trim() ? (
      <>{INSERT_CATEGORIES.map((c) => <Cat key={c} c={c} />)}</>
    ) : (
      <>
        {recents.length > 0 ? (
          <View>
            <CatHeader text={t("insertMenu.recent")} first />
            {recents.map((k) => {
              const d = INSERT_BLOCKS.find((b) => b.kind === k);
              return d ? <Row key={`recent-${k}`} d={d} /> : null;
            })}
          </View>
        ) : null}
        {INSERT_CATEGORIES.map((c, i) => (
          <Cat key={c} c={c} first={i === 0 && recents.length === 0} />
        ))}
      </>
    );

  const AISection = () =>
    !aiEnabled ? null : (
      <View>
        <View style={[styles.cat, styles.catRow, { flexDirection, borderTopColor: colors.borderSubtle }]}>
          <Sparkles size={12} color={colors.brandPrimary} />
          <Text style={{ color: colors.textPlaceholder, fontSize: 11, fontFamily: "Inter_700Bold" }}>
            {t("insertMenu.aiSuggestions")}
          </Text>
        </View>
        <View style={[styles.aiSoon, { borderColor: colors.borderSubtle, flexDirection }]} accessible accessibilityState={{ disabled: true }}>
          <ImagePlus size={16} color={colors.textPlaceholder} />
          <Text style={{ color: colors.textPlaceholder, flex: 1, textAlign: rtl ? "right" : "left" }}>
            {t("insertMenu.block.imageGen")}
          </Text>
          <Text style={[styles.soon, { color: colors.textPlaceholder, backgroundColor: colors.bgSurface }]}>
            {t("insertMenu.comingSoon")}
          </Text>
        </View>
      </View>
    );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
      {mode === "full" ? (
        <Animated.View
          entering={SlideInDown.duration(240)}
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
          <GestureDetector gesture={fullPan}>
            <View style={styles.grabZone}>
              <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
            </View>
          </GestureDetector>
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
            <ToolList />
            <AISection />
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View
          style={[
            styles.card,
            bloom,
            openUp ? { bottom: height - anchorY + GAP } : { top: Math.max(minTop, anchorY + GAP) },
            {
              backgroundColor: colors.bgPrimary,
              borderColor: colors.borderSubtle,
              transformOrigin: `${openUp ? "bottom" : "top"} ${rtl ? "right" : "left"}`,
            },
          ]}
        >
          <Pressable
            style={[styles.expand, rtl ? { right: 12 } : { left: 12 }]}
            onPress={expandMenu}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("insertMenu.expandHint")}
          >
            <Maximize2 size={15} color={colors.textPlaceholder} />
          </Pressable>
          <GestureDetector gesture={compactPan}>
            <View style={styles.grabZone}>
              <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
            </View>
          </GestureDetector>
          <ScrollView style={{ maxHeight: listMaxHeight }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            <ToolList />
            <AISection />
          </ScrollView>
          <Pressable onPress={expandMenu} style={[styles.exHint, { borderTopColor: colors.borderSubtle, flexDirection }]}>
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
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 16,
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
    paddingHorizontal: 10,
    zIndex: 50,
  },
  grabZone: { paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  grab: { width: 40, height: 4, borderRadius: 3 },
  title: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center", paddingBottom: 8 },
  search: {
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", padding: 0 },
  cat: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  catRow: { alignItems: "center", gap: 5 },
  catFirst: { borderTopWidth: 0, marginTop: 2 },
  row: { alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10 },
  rowLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  soon: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    overflow: "hidden",
  },
  aiSoon: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    marginHorizontal: 4,
    marginTop: 2,
  },
  expand: { position: "absolute", top: 12, zIndex: 2 },
  exHint: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
});
