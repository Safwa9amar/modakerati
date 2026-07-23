import React, { useEffect, useMemo } from "react";
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, useWindowDimensions, Keyboard, BackHandler } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, withSpring, runOnJS, interpolate } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus, Search as SearchIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useSettingsStore } from "@/stores/settings-store";
import { INSERT_BLOCKS, INSERT_CATEGORIES, filterBlocks, type InsertBlockDef } from "@/components/workspace/insert/insert-blocks";
import { pickAndInsertImage } from "@/lib/insert-image";

// Drawer covers 64% of the height; the background app recedes (scales down +
// rounds) in the top peek — the iOS "card" presentation, driven by one progress.
const DRAWER_FRACTION = 0.64;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const TEXT_KINDS = ["h1", "h2", "h3", "quote", "bullet", "number"];
const PAD = 18;

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level bottom "push" drawer for the Insert menu — the vertical twin of
 * PushDrawer. Opening (driven by `insert-menu-store`, from `/` or the dock `+`)
 * slides the insert panel up from the bottom while the whole app recedes behind
 * it. Wrapping the app tree keeps the header/document/dock moving as one piece.
 * The block index for structural inserts comes from the store's `anchor`; the
 * thesis id is read from the current-thesis store (no per-screen wiring).
 */
export function BottomInsertDrawer({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const DRAWER_H = Math.round(height * DRAWER_FRACTION);

  const open = useInsertMenuStore((s) => s.open);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const openSV = useSharedValue(open);

  const close = () => useInsertMenuStore.getState().close();

  useEffect(() => {
    openSV.value = open;
    if (open) Keyboard.dismiss();
  }, [open]);

  // Settle: spring `progress` to the store state whenever a gesture isn't driving it.
  useAnimatedReaction(
    () => (dragging.value ? -1 : openSV.value ? 1 : 0),
    (target) => {
      if (target >= 0) progress.value = withSpring(target, SPRING);
    },
  );

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  // Drag the grab handle down to close.
  const dragPan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          progress.value = clamp(1 - e.translationY / DRAWER_H, 0, 1);
        })
        .onEnd((e) => {
          const keep = progress.value > 0.55 && e.velocityY < 800;
          openSV.value = keep;
          dragging.value = false;
          if (!keep) runOnJS(close)();
        })
        .onFinalize(() => {
          dragging.value = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [DRAWER_H],
  );

  // App recedes: scale down + lift a touch + round corners as the drawer rises.
  const appStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -progress.value * (insets.top + 6) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.94]) },
    ],
    borderRadius: progress.value * 16,
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.35 }));
  const drawerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * (DRAWER_H + 40) }] }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.app, appStyle]}>{children}</Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} pointerEvents={open ? "auto" : "none"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <Animated.View style={[styles.drawer, { height: DRAWER_H }, drawerStyle]} pointerEvents={open ? "auto" : "none"}>
        <InsertPanel dragPan={dragPan} bottomInset={insets.bottom} />
      </Animated.View>
    </View>
  );
}

/** The drawer contents: grab handle, title, search, and the categorized palette
 *  with recently-used pinned on top. */
function InsertPanel({ dragPan, bottomInset }: { dragPan: ReturnType<typeof Gesture.Pan>; bottomInset: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const rtl = useRTL().isRTL;
  const rowDir = rtl ? "row-reverse" : "row";
  const textAlign = rtl ? "right" : "left";
  const query = useInsertMenuStore((s) => s.query);
  const recents = useInsertMenuStore((s) => s.recents);
  const aiEnabled = useSettingsStore((s) => s.autocompleteEnabled);
  const thesisId = useThesisStore((s) => s.currentThesisId);

  const label = (d: InsertBlockDef) => t(`insertMenu.block.${d.labelKey}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- label closes over t (stable per session)
  const filtered = useMemo(() => filterBlocks(query, label), [query]);

  const pick = async (d: InsertBlockDef) => {
    if (d.status !== "ready") return;
    const a = useInsertMenuStore.getState().anchor;
    useInsertMenuStore.getState().pushRecent(d.kind);
    useInsertMenuStore.getState().close();
    const lex = useLexicalEditorStore.getState();
    if (TEXT_KINDS.includes(d.kind)) {
      lex.dispatch("insert", JSON.stringify({ kind: d.kind }));
      return;
    }
    lex.dispatch("insert", JSON.stringify({ kind: "clearSlash" }));
    await lex.flushEdits?.();
    if (!a || !thesisId) return;
    if (d.kind === "pageBreak") await useThesisDocStore.getState().mutate(thesisId, { type: "startOnNewPage", indices: [a.index] });
    else if (d.kind === "figure") await pickAndInsertImage(thesisId, a.index);
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
        style={({ pressed }) => [styles.row, { flexDirection: rowDir, backgroundColor: pressed && ready ? colors.bgSurface : "transparent", opacity: ready ? 1 : 0.5 }]}
      >
        <View style={styles.iconBox}>
          <d.Icon size={20} color={ready ? colors.textSecondary : colors.textPlaceholder} />
        </View>
        <Text numberOfLines={1} style={[styles.rowLabel, { color: ready ? colors.textPrimary : colors.textSecondary, textAlign }]}>
          {label(d)}
        </Text>
        {!ready ? <Text style={[styles.soon, { color: colors.textPlaceholder, backgroundColor: colors.bgSurface }]}>{t("insertMenu.comingSoon")}</Text> : null}
      </Pressable>
    );
  };

  const CatHeader = ({ text, first }: { text: string; first?: boolean }) => (
    <View style={[styles.catWrap, !first && { borderTopColor: colors.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.cat, { color: colors.textPlaceholder, textAlign }]}>{text}</Text>
    </View>
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

  return (
    <View style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
      <GestureDetector gesture={dragPan}>
        <View style={styles.grabZone}>
          <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("insertMenu.title")}</Text>
        </View>
      </GestureDetector>
      <View style={[styles.search, { backgroundColor: colors.bgSurface, flexDirection: rowDir }]}>
        <SearchIcon size={17} color={colors.textPlaceholder} />
        <TextInput
          placeholder={t("insertMenu.searchPlaceholder")}
          placeholderTextColor={colors.textPlaceholder}
          accessibilityLabel={t("insertMenu.searchPlaceholder")}
          value={query}
          onChangeText={(q) => useInsertMenuStore.getState().setQuery(q)}
          style={[styles.searchInput, { color: colors.textPrimary, textAlign }]}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottomInset + 16 }}>
        {query.trim() ? (
          INSERT_CATEGORIES.map((c, i) => <Cat key={c} c={c} first={i === 0} />)
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
        )}
        {aiEnabled ? (
          <View>
            <View style={[styles.catWrap, styles.aiHead, { flexDirection: rowDir, borderTopColor: colors.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Sparkles size={13} color={colors.brandPrimary} />
              <Text style={[styles.cat, { color: colors.textPlaceholder, paddingTop: 0, paddingHorizontal: 0 }]}>{t("insertMenu.aiSuggestions")}</Text>
            </View>
            <View style={[styles.aiSoon, { borderColor: colors.borderSubtle, flexDirection: rowDir }]} accessible accessibilityState={{ disabled: true }}>
              <ImagePlus size={18} color={colors.textPlaceholder} />
              <Text numberOfLines={1} style={{ color: colors.textPlaceholder, flex: 1, fontSize: 14, textAlign }}>{t("insertMenu.block.imageGen")}</Text>
              <Text style={[styles.soon, { color: colors.textPlaceholder, backgroundColor: colors.bgSurface }]}>{t("insertMenu.comingSoon")}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  app: { flex: 1, overflow: "hidden", backgroundColor: "transparent" },
  scrim: { backgroundColor: "#000", zIndex: 1 },
  drawer: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2 },
  panel: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 20,
  },
  grabZone: { paddingTop: 10, paddingBottom: 6, alignItems: "center" },
  grab: { width: 44, height: 5, borderRadius: 3, marginBottom: 8 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  search: {
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: PAD,
    marginTop: 8,
    marginBottom: 4,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", padding: 0 },
  catWrap: { paddingTop: 14, paddingBottom: 4, marginTop: 4 },
  cat: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.7, textTransform: "uppercase", paddingHorizontal: PAD },
  aiHead: { alignItems: "center", gap: 6, paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 4, marginTop: 4 },
  // Base flexDirection guarantees a HORIZONTAL row even if an inline value is missing.
  row: { flexDirection: "row", alignItems: "center", minHeight: 46, paddingVertical: 7, paddingHorizontal: PAD, gap: 14 },
  iconBox: { width: 24, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  soon: { fontSize: 9, fontFamily: "Inter_700Bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, overflow: "hidden" },
  aiSoon: { alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", marginHorizontal: PAD, marginTop: 4 },
});
