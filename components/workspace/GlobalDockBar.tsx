import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, Text, StyleSheet, Alert, Keyboard, ActivityIndicator } from "react-native";
// Horizontal tool rows use gesture-handler's ScrollView so they scroll even when
// nested inside the reorderable list (RN's ScrollView loses the horizontal pan to
// the list's gesture handler) — mirrors BlockContextBar.
import { ScrollView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import {
  KeyboardOff,
  Undo2,
  Redo2,
  ListTree,
  ArrowUp,
  ArrowDown,
  SquareSplitVertical,
  RectangleHorizontal,
  BadgeCheck,
  Sparkles,
  RotateCw,
  Scaling,
  FileText,
  Columns3,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useChatStore } from "@/stores/chat-store";
import {
  undoThesisHistory,
  redoThesisHistory,
  setThesisPageSetup,
  formatThesis,
  type DocBlockDTO,
  type ThesisPageSetup,
} from "@/lib/api";
import { hSelection, hSuccess } from "@/lib/haptics";
import { AnimatedChip } from "./AnimatedChip";
import { rowIn, rowOutUnlessHandoff } from "@/lib/motion";

const CHIP = 40;

const ORIENTATIONS: { value: NonNullable<ThesisPageSetup["orientation"]>; key: string; defaultValue: string }[] = [
  { value: "portrait", key: "ribbon.opt.portrait", defaultValue: "Portrait" },
  { value: "landscape", key: "ribbon.opt.landscape", defaultValue: "Landscape" },
];
const MARGIN_PRESETS: { value: NonNullable<ThesisPageSetup["marginPreset"]>; key: string; defaultValue: string }[] = [
  { value: "normal", key: "ribbon.opt.marginNormal", defaultValue: "Normal" },
  { value: "narrow", key: "ribbon.opt.marginNarrow", defaultValue: "Narrow" },
  { value: "moderate", key: "ribbon.opt.marginModerate", defaultValue: "Moderate" },
  { value: "wide", key: "ribbon.opt.marginWide", defaultValue: "Wide" },
  { value: "mirrored", key: "ribbon.opt.marginMirrored", defaultValue: "Mirrored" },
];
const PAGE_SIZES: { value: NonNullable<ThesisPageSetup["pageSize"]>; key: string; defaultValue: string }[] = [
  { value: "A4", key: "ribbon.opt.a4", defaultValue: "A4" },
  { value: "USLetter", key: "ribbon.opt.letter", defaultValue: "Letter" },
  { value: "USLegal", key: "ribbon.opt.legal", defaultValue: "Legal" },
  { value: "A3", key: "ribbon.opt.a3", defaultValue: "A3" },
  { value: "A5", key: "ribbon.opt.a5", defaultValue: "A5" },
];
const COLUMN_COUNTS: { value: NonNullable<ThesisPageSetup["columns"]>; key: string; defaultValue: string }[] = [
  { value: 1, key: "ribbon.opt.oneCol", defaultValue: "One" },
  { value: 2, key: "ribbon.opt.twoCol", defaultValue: "Two" },
  { value: 3, key: "ribbon.opt.threeCol", defaultValue: "Three" },
];

/** Saving-in-flight dot — mirrors BlockContextBar's PulsingDot (gentle repeat pulse). */
function PulsingDot({ color }: { color: string }) {
  const v = useSharedValue(0.4);
  useEffect(() => {
    v.value = withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0.4, { duration: 600 })), -1, false);
  }, [v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.7 + v.value * 0.5 }],
  }));
  return <Animated.View style={[styles.savingDot, { backgroundColor: color }, style]} />;
}

interface Props {
  thesisId: string;
  /** Live-.docx block model — used to resolve the text of the prev/next navigation
   *  target (selectBlock's snippet) and the doc's block count. */
  blocks: DocBlockDTO[];
}

/**
 * The GLOBAL keyboard-docked toolbar: block-agnostic document tools only (undo/
 * redo, outline, prev/next block navigation, page break, page setup, thesis-ready)
 * plus the pinned ✦ Ask AI. All block FORMATTING tools (bold/align/style/…) live
 * exclusively in the floating bubble now — this bar never shows them, by product
 * decision. Renders docked above the keyboard whenever a block is being edited or
 * the block-scoped Ask-AI input has focus (see BlockComposer's blockKeyboardOpen).
 */
export function GlobalDockBar({ thesisId, blocks }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();

  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const editingBlockIndex = useWorkspaceStore((s) => s.editingBlockIndex);
  const canUndo = useThesisDocStore((s) => s.history[thesisId]?.canUndo ?? false);
  const canRedo = useThesisDocStore((s) => s.history[thesisId]?.canRedo ?? false);
  const pendingOps = useThesisDocStore((s) => s.pending[thesisId] ?? 0);
  const isGenerating = useChatStore((s) => s.isGenerating);

  const [historyBusy, setHistoryBusy] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [pageSetupBusy, setPageSetupBusy] = useState(false);
  const [formatting, setFormatting] = useState(false);

  const blockCount = blocks.length;
  const byIndex = useMemo(() => new Map(blocks.map((b) => [b.index, b])), [blocks]);
  const textOf = useCallback((b: DocBlockDTO | undefined): string => {
    if (!b) return "";
    if (b.kind === "paragraph") return b.text;
    if (b.kind === "image") return b.caption ?? "";
    if (b.kind === "table") return b.rows[0]?.join(" ") ?? "";
    return "";
  }, []);

  // ── Dismiss keyboard ──
  const dismissKeyboard = () => Keyboard.dismiss();

  // ── Undo / redo (server-side history restores — mirrors thesis-workspace's runHistory) ──
  const runHistory = async (kind: "undo" | "redo") => {
    if (historyBusy) return;
    setHistoryBusy(true);
    try {
      const res = kind === "undo" ? await undoThesisHistory(thesisId) : await redoThesisHistory(thesisId);
      useThesisDocStore.getState().applyRestoredDoc(thesisId, res.document, { canUndo: res.canUndo, canRedo: res.canRedo });
    } catch (e: any) {
      Alert.alert(t("workspace.historyFailed", { defaultValue: "Couldn't restore the document" }), e?.message ?? "");
    } finally {
      setHistoryBusy(false);
    }
  };
  const undoDisabled = !canUndo || pendingOps > 0 || historyBusy || isGenerating;
  const redoDisabled = !canRedo || pendingOps > 0 || historyBusy || isGenerating;

  // ── Outline (the root Thesis Structure push-drawer) ──
  const openOutline = () => {
    Keyboard.dismiss();
    useNavDrawerStore.getState().toggleDrawer();
  };

  // ── Prev / next block navigation ──
  const sole = selectedBlocks.length === 1 ? selectedBlocks[0].index : null;
  const canPrev = sole != null && sole > 0;
  const canNext = sole != null && sole < blockCount - 1;
  const navigate = (dir: "prev" | "next") => {
    if (sole == null) return;
    const to = dir === "prev" ? sole - 1 : sole + 1;
    if (to < 0 || to >= blockCount) return;
    const ws = useWorkspaceStore.getState();
    const wasEditing = ws.editingBlockIndex != null;
    const target = byIndex.get(to);
    hSelection();
    ws.selectBlock(to, textOf(target));
    if (wasEditing && target?.kind === "paragraph") {
      ws.setEditingBlock(to);
    }
    ws.requestScrollToBlock(to);
  };

  // ── Page break (durable op — targets the current selection, else the sole editing block) ──
  const pageBreakIndices = selectedBlocks.length > 0 ? selectedBlocks.map((b) => b.index) : editingBlockIndex != null ? [editingBlockIndex] : [];
  const insertPageBreak = () => {
    if (!pageBreakIndices.length) return;
    void useThesisDocStore.getState().mutate(thesisId, { type: "startOnNewPage", indices: pageBreakIndices });
  };

  // ── Page setup (document-wide; each pill applies a single field) ──
  const applyPageSetup = async (setup: ThesisPageSetup) => {
    if (pageSetupBusy) return;
    setPageSetupBusy(true);
    try {
      await setThesisPageSetup(thesisId, setup);
      await useThesisDocStore.getState().revalidate(thesisId);
    } catch {
      Alert.alert(t("common.error", { defaultValue: "Error" }), t("workspace.bulkEditError", { defaultValue: "Could not apply the change." }));
    } finally {
      setPageSetupBusy(false);
    }
  };

  // ── Thesis-ready (deterministic formatting pass) ──
  const runFormatThesis = async () => {
    if (formatting) return;
    setFormatting(true);
    try {
      await formatThesis(thesisId);
      await useThesisDocStore.getState().revalidate(thesisId);
      hSuccess();
    } catch {
      Alert.alert(t("common.error", { defaultValue: "Error" }), t("workspace.formatError", { defaultValue: "Could not format thesis" }));
    } finally {
      setFormatting(false);
    }
  };

  // ── ✦ Ask AI (pinned) — same routing as the block pill's ✦ ──
  const askAi = () => {
    if (useFloatingPillStore.getState().visible) {
      useFloatingPillStore.getState().setExpanded(true);
      useFloatingPillStore.getState().setInputOpen(true);
    } else {
      useWorkspaceStore.getState().setAskAiOpen(true);
    }
  };

  // ── Small building blocks (mirrors BlockContextBar's chip()/sep()) ──
  const chip = (opts: {
    keyProp: string;
    Icon: LucideIcon;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
    accessibilityLabel: string;
    enterIndex?: number;
  }) => (
    <AnimatedChip
      key={opts.keyProp}
      onPress={opts.onPress}
      disabled={opts.disabled || opts.busy}
      accessibilityLabel={opts.accessibilityLabel}
      enterIndex={opts.enterIndex}
      style={[
        styles.chip,
        { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
        (opts.disabled || opts.busy) && styles.chipDim,
      ]}
    >
      {opts.busy ? (
        <ActivityIndicator size="small" color={colors.textPrimary} />
      ) : (
        <opts.Icon size={17} color={opts.disabled ? colors.textPlaceholder : colors.textPrimary} strokeWidth={2} />
      )}
    </AnimatedChip>
  );

  const sep = (k: string) => <View key={k} style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />;

  const optPill = (disabled?: boolean) => [
    styles.optPill,
    { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
    disabled && styles.chipDim,
  ];

  const groupIcon = (Icon: LucideIcon) => (
    <View style={styles.groupIcon}>
      <Icon size={14} color={colors.textPlaceholder} strokeWidth={2} />
    </View>
  );

  const saving = pendingOps > 0;

  const renderPageSetupExpansion = () => {
    if (!pageSetupOpen) return null;
    return (
      <Animated.View
        key="page-setup-expansion"
        entering={rowIn}
        exiting={rowOutUnlessHandoff}
        style={[styles.expansion, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.expansionRow, { flexDirection }]}
        >
          {groupIcon(RotateCw)}
          {ORIENTATIONS.map((o, i) => (
            <AnimatedChip
              key={o.value}
              enterIndex={i}
              onPress={() => void applyPageSetup({ orientation: o.value })}
              disabled={pageSetupBusy}
              accessibilityLabel={t(o.key, { defaultValue: o.defaultValue })}
              style={optPill(pageSetupBusy)}
            >
              <Text style={[styles.optText, { color: colors.textPrimary }]}>{t(o.key, { defaultValue: o.defaultValue })}</Text>
            </AnimatedChip>
          ))}
          {sep("s-orient-margin")}
          {groupIcon(Scaling)}
          {MARGIN_PRESETS.map((m, i) => (
            <AnimatedChip
              key={m.value}
              enterIndex={ORIENTATIONS.length + i}
              onPress={() => void applyPageSetup({ marginPreset: m.value })}
              disabled={pageSetupBusy}
              accessibilityLabel={t(m.key, { defaultValue: m.defaultValue })}
              style={optPill(pageSetupBusy)}
            >
              <Text style={[styles.optText, { color: colors.textPrimary }]}>{t(m.key, { defaultValue: m.defaultValue })}</Text>
            </AnimatedChip>
          ))}
          {sep("s-margin-size")}
          {groupIcon(FileText)}
          {PAGE_SIZES.map((sz, i) => (
            <AnimatedChip
              key={sz.value}
              enterIndex={ORIENTATIONS.length + MARGIN_PRESETS.length + i}
              onPress={() => void applyPageSetup({ pageSize: sz.value })}
              disabled={pageSetupBusy}
              accessibilityLabel={t(sz.key, { defaultValue: sz.defaultValue })}
              style={optPill(pageSetupBusy)}
            >
              <Text style={[styles.optText, { color: colors.textPrimary }]}>{t(sz.key, { defaultValue: sz.defaultValue })}</Text>
            </AnimatedChip>
          ))}
          {sep("s-size-columns")}
          {groupIcon(Columns3)}
          {COLUMN_COUNTS.map((c, i) => (
            <AnimatedChip
              key={c.value}
              enterIndex={ORIENTATIONS.length + MARGIN_PRESETS.length + PAGE_SIZES.length + i}
              onPress={() => void applyPageSetup({ columns: c.value })}
              disabled={pageSetupBusy}
              accessibilityLabel={t(c.key, { defaultValue: c.defaultValue })}
              style={optPill(pageSetupBusy)}
            >
              <Text style={[styles.optText, { color: colors.textPrimary }]}>{t(c.key, { defaultValue: c.defaultValue })}</Text>
            </AnimatedChip>
          ))}
        </ScrollView>
      </Animated.View>
    );
  };

  const AskAI = (
    <Pressable
      onPress={askAi}
      accessibilityRole="button"
      accessibilityLabel={t("blockBar.askAi", { defaultValue: "Ask AI" })}
      style={[styles.askBtn, { backgroundColor: colors.brandPrimary }]}
    >
      <Sparkles size={18} color={colors.bgPrimary} strokeWidth={2.2} />
    </Pressable>
  );

  return (
    <View style={[styles.fullWrap, { backgroundColor: colors.bgPrimary, borderTopColor: colors.borderSubtle, paddingBottom: 6 }]}>
      {/* Must stay the FIRST child (mirrors BlockContextBar) — same tree position
          keeps the expansion row mounted across renders (no spurious re-entering). */}
      {renderPageSetupExpansion()}
      <View style={[styles.fullRow, { flexDirection }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.fullScroll}
          contentContainerStyle={[styles.fullTools, { flexDirection }]}
        >
          <View style={[styles.toolsRowInner, { flexDirection }]}>
            {chip({
              keyProp: "dismiss",
              Icon: KeyboardOff,
              accessibilityLabel: t("dockBar.dismissKeyboard", { defaultValue: "Dismiss keyboard" }),
              enterIndex: 0,
              onPress: dismissKeyboard,
            })}
            {sep("s1")}
            {chip({
              keyProp: "undo",
              Icon: Undo2,
              accessibilityLabel: t("workspace.undo", { defaultValue: "Undo" }),
              disabled: undoDisabled,
              enterIndex: 1,
              onPress: () => void runHistory("undo"),
            })}
            {chip({
              keyProp: "redo",
              Icon: Redo2,
              accessibilityLabel: t("workspace.redo", { defaultValue: "Redo" }),
              disabled: redoDisabled,
              enterIndex: 2,
              onPress: () => void runHistory("redo"),
            })}
            {sep("s2")}
            {chip({
              keyProp: "outline",
              Icon: ListTree,
              accessibilityLabel: t("workspace.outline", { defaultValue: "Outline" }),
              enterIndex: 3,
              onPress: openOutline,
            })}
            {chip({
              keyProp: "prev",
              Icon: ArrowUp,
              accessibilityLabel: t("dockBar.prevBlock", { defaultValue: "Previous block" }),
              disabled: !canPrev,
              enterIndex: 4,
              onPress: () => navigate("prev"),
            })}
            {chip({
              keyProp: "next",
              Icon: ArrowDown,
              accessibilityLabel: t("dockBar.nextBlock", { defaultValue: "Next block" }),
              disabled: !canNext,
              enterIndex: 5,
              onPress: () => navigate("next"),
            })}
            {sep("s3")}
            {chip({
              keyProp: "pageBreak",
              Icon: SquareSplitVertical,
              accessibilityLabel: t("ribbon.tools.pageBreak", { defaultValue: "Page break" }),
              disabled: !pageBreakIndices.length,
              enterIndex: 6,
              onPress: insertPageBreak,
            })}
            {chip({
              keyProp: "pageSetup",
              Icon: RectangleHorizontal,
              accessibilityLabel: t("ribbon.grp.pageSetup", { defaultValue: "Page setup" }),
              enterIndex: 7,
              onPress: () => setPageSetupOpen((v) => !v),
            })}
            {chip({
              keyProp: "thesisReady",
              Icon: BadgeCheck,
              accessibilityLabel: t("ribbon.tools.thesisReady", { defaultValue: "Thesis-ready" }),
              busy: formatting,
              enterIndex: 8,
              onPress: () => void runFormatThesis(),
            })}
          </View>
        </ScrollView>
        {AskAI}
      </View>
      {saving ? <PulsingDot color={colors.brandPrimary} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-width docked bar (keyboard open) — sits flush on the keyboard. Mirrors
  // BlockContextBar's fullWrap chrome exactly.
  fullWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 10,
  },
  fullRow: { alignItems: "center", gap: 8 },
  fullScroll: { flex: 1 },
  fullTools: { alignItems: "center", gap: 6, paddingHorizontal: 2 },
  toolsRowInner: { alignItems: "center", gap: 6 },

  chip: {
    width: CHIP,
    height: CHIP,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipDim: { opacity: 0.4 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },

  askBtn: {
    width: CHIP,
    height: CHIP,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: CHIP / 2,
  },

  // Category expansion options row (page setup) — mirrors BlockContextBar's expansion styles.
  expansion: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 6,
    marginBottom: 8,
    alignSelf: "stretch",
  },
  expansionRow: { alignItems: "center", gap: 6 },
  groupIcon: { width: 20, alignItems: "center", justifyContent: "center", marginHorizontal: 2 },
  optPill: {
    minWidth: 42,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  savingDot: { position: "absolute", top: 4, right: 8, width: 6, height: 6, borderRadius: 3 },
});
