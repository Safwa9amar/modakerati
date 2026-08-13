import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Alert, Keyboard, BackHandler, Pressable, useWindowDimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, withSpring, runOnJS, interpolate } from "react-native-reanimated";
import { ScrollView, Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import {
  KeyboardOff,
  // RN's Keyboard API owns the bare name in this file.
  Keyboard as KeyboardIcon,
  Undo2,
  Redo2,
  ListTree,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ListChecks,
  SquareSplitVertical,
  RectangleHorizontal,
  Search,
  RotateCw,
  Scaling,
  FileText,
  Columns3,
  Plus,
  PanelTopClose,
  PanelTopOpen,
  BookOpenText,
  type LucideIcon,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useDockToolsStore } from "@/stores/dock-tools-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useChatStore } from "@/stores/chat-store";
import { useSearchStore } from "@/stores/search-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import {
  undoThesisHistory,
  redoThesisHistory,
  setThesisPageSetup,
  type DocBlockDTO,
  type ThesisPageSetup,
} from "@/lib/api";
import { hSelection, hSuccess } from "@/lib/haptics";
import { AnimatedChip } from "@/components/workspace/AnimatedChip";
import { rowIn, rowOutUnlessHandoff } from "@/lib/motion";

/** The two heights the drawer snaps between, as fractions of the window. */
const DETENTS = [0.52, 0.86];
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const PAD = 16;
const GRID_COLS = 4;
const GRID_GAP = 8;
/** Tools whose result lands INSIDE the sheet — picking them must not dismiss it. */
const STAYS_OPEN = new Set(["selectMode", "reorderMode", "pageSetup", "showPages"]);

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

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level bottom push drawer for the GLOBAL document tools — the same surface
 * as the Insert menu (BottomInsertDrawer) and the header/footer editor: opening
 * slides the panel up while the whole app recedes behind it.
 *
 * It replaces the docked tool BAR. The writer keeps its full height and shows only
 * a slim bottom-edge grip; swiping up from that grip — or dropping the floating ✦
 * bubble on its ⋮⋮ target — pushes this in. Unlike the other two drawers it has
 * TWO heights: the drag snaps to whichever is nearer, and a drag below the short
 * one dismisses.
 *
 * Wrap the app with it once, at the root, like BottomInsertDrawer.
 */
export function DockToolsSheet({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const heights = useMemo(() => DETENTS.map((f) => Math.round(height * f)), [height]);

  const open = useDockToolsStore((s) => s.open);
  const detent = useDockToolsStore((s) => s.detent);
  // Drawer height is the TALL detent always; the short one is expressed as a
  // partial `progress`, so the drag is one continuous track instead of two
  // competing layouts (the panel never re-lays out mid-gesture).
  const drawerH = heights[1];
  const shortStop = heights[0] / drawerH;

  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const targetSV = useSharedValue(0);

  const close = () => useDockToolsStore.getState().close();
  const snapTo = (d: 0 | 1) => useDockToolsStore.getState().setDetent(d);

  useEffect(() => {
    targetSV.value = open ? (detent === 1 ? 1 : shortStop) : 0;
    if (open) Keyboard.dismiss();
  }, [open, detent, shortStop, targetSV]);

  useAnimatedReaction(
    () => (dragging.value ? -1 : targetSV.value),
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

  // Drag: follows the finger over the whole track, then snaps to the nearest of
  // {dismissed, short, tall}. A fast downward fling always dismisses.
  const dragPan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          progress.value = clamp(targetSV.value - e.translationY / drawerH, 0, 1);
        })
        .onEnd((e) => {
          dragging.value = false;
          const p = progress.value;
          if (e.velocityY > 900 || p < shortStop * 0.55) {
            runOnJS(close)();
            return;
          }
          const tall = e.velocityY < -900 || p > (shortStop + 1) / 2;
          targetSV.value = tall ? 1 : shortStop;
          runOnJS(snapTo)(tall ? 1 : 0);
        })
        .onFinalize(() => {
          dragging.value = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawerH, shortStop],
  );

  const appStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -progress.value * (insets.top + 6) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.94]) },
    ],
    borderRadius: progress.value * 16,
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.35 }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (drawerH + 40) }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.app, appStyle]}>{children}</Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} pointerEvents={open ? "auto" : "none"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <Animated.View style={[styles.drawer, { height: drawerH }, drawerStyle]} pointerEvents={open ? "auto" : "none"}>
        <ToolsPanel dragPan={dragPan} bottomInset={insets.bottom} />
      </Animated.View>
    </View>
  );
}

/** One entry in the document tool set, rendered as a labeled tile. */
interface DockTool {
  key: string;
  Icon: LucideIcon;
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  enterIndex: number;
}

/**
 * Drawer contents: grab handle, title, and a wrapping grid of labeled tiles for
 * every GLOBAL document tool (undo/redo, outline, prev/next block, search, select,
 * reorder, page break, insert, page setup). Block FORMATTING tools are NOT here —
 * they live exclusively in the floating ✦ bubble, by product decision.
 *
 * Like the Insert drawer, it reads the target thesis from the stores rather than
 * taking props: it is mounted once at the app root, far from the workspace screen.
 */
function ToolsPanel({ dragPan, bottomInset }: { dragPan: ReturnType<typeof Gesture.Pan>; bottomInset: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { flexDirection } = useRTL();
  const { width } = useWindowDimensions();
  // Subtract the panel's hairline border (both sides) as well as the padding and
  // gaps: the grid lives INSIDE that border, so sizing tiles off the bare window
  // width overshot by a fraction of a dp and Yoga wrapped the 4th tile of every
  // row — a dead column, and the last row pushed below the short detent.
  const tileW = Math.floor((width - StyleSheet.hairlineWidth * 2 - PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);

  // This panel is always MOUNTED (it lives in the root drawer), so everything that
  // costs anything is gated on `open` — otherwise every document tick in the app
  // would rebuild the block index for a sheet nobody is looking at.
  const open = useDockToolsStore((s) => s.open);
  const thesisId = useThesisStore((s) => s.currentThesisId) ?? "";
  const doc = useThesisDocStore((s) => s.byId[thesisId]);
  const blocks: DocBlockDTO[] = useMemo(
    () => (open && doc?.available ? doc.blocks : []),
    [open, doc],
  );

  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const editingBlockIndex = useWorkspaceStore((s) => s.editingBlockIndex);
  const headerVisible = useWorkspaceStore((s) => s.headerVisible);
  const selectMode = useWorkspaceStore((s) => s.selectMode);
  const reorderMode = useWorkspaceStore((s) => s.reorderMode);
  const showPages = useWorkspaceStore((s) => s.showPages);
  const keyboardActive = useWorkspaceStore((s) => s.keyboardActive);
  const canUndo = useThesisDocStore((s) => s.history[thesisId]?.canUndo ?? false);
  const canRedo = useThesisDocStore((s) => s.history[thesisId]?.canRedo ?? false);
  const pendingOps = useThesisDocStore((s) => s.pending[thesisId] ?? 0);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const localUndo = useThesisDocStore((s) => s.localUndo[thesisId] ?? 0);
  const localRedo = useThesisDocStore((s) => s.localRedo[thesisId] ?? 0);
  const lexActive = useLexicalEditorStore((s) => s.active);
  const lexCanUndo = useLexicalEditorStore((s) => s.canUndo);
  const lexCanRedo = useLexicalEditorStore((s) => s.canRedo);

  const [historyBusy, setHistoryBusy] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [pageSetupBusy, setPageSetupBusy] = useState(false);

  const dismiss = () => useDockToolsStore.getState().close();

  const blockCount = blocks.length;
  const byIndex = useMemo(() => new Map(blocks.map((b) => [b.index, b])), [blocks]);
  const textOf = (b: DocBlockDTO | undefined): string => {
    if (!b) return "";
    if (b.kind === "paragraph") return b.text;
    if (b.kind === "image") return b.caption ?? "";
    if (b.kind === "table") return b.rows[0]?.join(" ") ?? "";
    return "";
  };

  // ── Keyboard mode ──
  // TOGGLES the block-editing keyboard mode, the same switch the bubble's drag-to-⌨
  // target flips (issue #6). ON focuses the editor so the keyboard rises on the
  // current caret; OFF dismisses it, and the editor's inputmode="none"
  // (KeyboardModePlugin) then keeps it closed on block taps until it's turned back
  // on. Native inputs (bubble Ask, search) are unaffected either way.
  const toggleKeyboard = () => {
    useWorkspaceStore.getState().toggleKeyboardActive();
    if (useWorkspaceStore.getState().keyboardActive) useLexicalEditorStore.getState().dispatch("focus");
    else Keyboard.dismiss();
  };

  // ── Undo / redo (local-first — mirrors thesis-workspace's runHistory) ──
  // Three tiers, cheapest first: (1) the Lexical Writer's own in-editor history
  // (instant, offline — covers typing + in-editor formatting while the Writer is
  // active); (2) the on-device op queue (native pill/dock ops still unflushed);
  // (3) the server snapshot restore — the only tier that needs the network, now
  // reached only for steps from BEFORE this editing session.
  const runHistory = async (kind: "undo" | "redo") => {
    if (historyBusy || !thesisId) return;
    const lex = useLexicalEditorStore.getState();
    if (lex.active && (kind === "undo" ? lex.canUndo : lex.canRedo)) {
      // Never step Lexical history while an inline AI proposal is in the editor —
      // undo would unravel the proposal nodes. The tap is simply ignored.
      const sug = useSuggestionStore.getState();
      if (sug.range || Object.keys(sug.byIndex).length > 0) return;
      lex.dispatch(kind);
      return;
    }
    const store = useThesisDocStore.getState();
    if (kind === "undo" ? store.undoLocal(thesisId) : store.redoLocal(thesisId)) return;
    // Server restore requires a clean queue (applyRestoredDoc contract): with ops
    // still flushing, restoring would race the in-flight echo. The local path
    // above already handled everything undoable mid-flight — just bail.
    if ((store.pending[thesisId] ?? 0) > 0) return;
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
  const undoDisabled = historyBusy || isGenerating || (!(lexActive && lexCanUndo) && localUndo === 0 && (!canUndo || pendingOps > 0));
  const redoDisabled = historyBusy || isGenerating || (!(lexActive && lexCanRedo) && localRedo === 0 && (!canRedo || pendingOps > 0));

  // ── Outline (the root Thesis Structure push-drawer) ──
  const openOutline = () => {
    Keyboard.dismiss();
    useNavDrawerStore.getState().toggleDrawer();
  };

  // ── Document search (top-pinned panel; Writer-only v1 → closes any preview) ──
  const openSearch = () => {
    Keyboard.dismiss();
    const ws = useWorkspaceStore.getState();
    if (ws.previewMode != null) ws.closePreview();
    useSearchStore.getState().openSearch();
  };

  // ── Prev / next HEADING navigation ──
  // Stepping one block at a time was useless on a thesis: a chapter is hundreds of
  // paragraphs, so "next" never got anywhere. These jump between headings (level
  // 1-6 paragraphs) instead — the same landmarks the outline lists.
  const headingIndices = useMemo(
    () => blocks.filter((b) => b.kind === "paragraph" && b.level > 0).map((b) => b.index).sort((a, b) => a - b),
    [blocks],
  );
  // Where "from here" is. A selection wins; otherwise the block being edited;
  // otherwise the top of the document, so the tools work with nothing selected
  // (the usual state when the sheet is opened from the bubble).
  const cursor = selectedBlocks.length ? selectedBlocks[0].index : editingBlockIndex ?? -1;
  const prevHeading = useMemo(() => {
    for (let i = headingIndices.length - 1; i >= 0; i--) if (headingIndices[i] < cursor) return headingIndices[i];
    return null;
  }, [headingIndices, cursor]);
  const nextHeading = useMemo(() => headingIndices.find((i) => i > cursor) ?? null, [headingIndices, cursor]);
  const navigate = (dir: "prev" | "next") => {
    const to = dir === "prev" ? prevHeading : nextHeading;
    if (to == null || to < 0 || to >= blockCount) return;
    const ws = useWorkspaceStore.getState();
    const wasEditing = ws.editingBlockIndex != null;
    const target = byIndex.get(to);
    hSelection();
    ws.selectBlock(to, textOf(target));
    if (wasEditing && target?.kind === "paragraph") ws.setEditingBlock(to);
    ws.requestScrollToBlock(to);
  };

  // ── Page break (durable op — targets the current selection, else the sole editing block) ──
  const pageBreakIndices = selectedBlocks.length > 0 ? selectedBlocks.map((b) => b.index) : editingBlockIndex != null ? [editingBlockIndex] : [];
  const insertPageBreak = async () => {
    if (!thesisId) return;
    // Parity with the insert-menu path: flush pending Lexical edits FIRST so the
    // break's block→paragraph index is computed against the up-to-date server
    // snapshot — the "typed text jumps to the next section" window is widest when
    // just-typed paragraphs aren't on the snapshot yet. THEN re-read the selection
    // fresh: a first tap can land before the onState selection sync.
    await useLexicalEditorStore.getState().flushEdits?.();
    const ws = useWorkspaceStore.getState();
    const indices =
      ws.selectedBlocks.length > 0
        ? ws.selectedBlocks.map((b) => b.index)
        : ws.editingBlockIndex != null
          ? [ws.editingBlockIndex]
          : [];
    if (!indices.length) return;
    // Immediate feedback so the first tap never reads as a no-op. The break itself
    // only becomes visible once the durable op drains — its optimistic patch is a
    // DELIBERATE no-op (the new section's chrome is unknown locally; the server
    // echo brings it), so we don't fake a boundary, we confirm the tap registered.
    hSuccess();
    void useThesisDocStore.getState().mutate(thesisId, { type: "startOnNewPage", indices });
  };

  // ── Insert menu (anchors at the current selection/editing block) ──
  const openInsert = () => {
    const idx = selectedBlocks.length ? selectedBlocks[0].index : editingBlockIndex ?? 0;
    const y = useFloatingPillStore.getState().anchorY ?? 200;
    useInsertMenuStore.getState().openAt({ index: idx, y });
  };

  // ── Page setup (document-wide; each pill applies a single field) ──
  const applyPageSetup = async (setup: ThesisPageSetup) => {
    if (pageSetupBusy || !thesisId) return;
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

  const tools: DockTool[] = [
    {
      key: "keyboard",
      Icon: keyboardActive ? KeyboardOff : KeyboardIcon,
      active: keyboardActive,
      label: t("dockBar.keyboard", { defaultValue: "Keyboard" }),
      a11y: keyboardActive
        ? t("bubble.keyboardOff", { defaultValue: "Keyboard off" })
        : t("bubble.keyboardOn", { defaultValue: "Keyboard on" }),
      enterIndex: 0,
      onPress: toggleKeyboard,
    },
    {
      key: "undo",
      Icon: Undo2,
      label: t("workspace.undo", { defaultValue: "Undo" }),
      a11y: t("workspace.undo", { defaultValue: "Undo" }),
      disabled: undoDisabled,
      enterIndex: 1,
      onPress: () => void runHistory("undo"),
    },
    {
      key: "redo",
      Icon: Redo2,
      label: t("workspace.redo", { defaultValue: "Redo" }),
      a11y: t("workspace.redo", { defaultValue: "Redo" }),
      disabled: redoDisabled,
      enterIndex: 2,
      onPress: () => void runHistory("redo"),
    },
    {
      key: "outline",
      Icon: ListTree,
      label: t("workspace.outline", { defaultValue: "Outline" }),
      a11y: t("workspace.outline", { defaultValue: "Outline" }),
      enterIndex: 3,
      onPress: openOutline,
    },
    {
      // #6: toggle the screen top-bar (back / title / undo-redo) to reclaim writing
      // space. Icon reflects the current state.
      key: "headerToggle",
      Icon: headerVisible ? PanelTopClose : PanelTopOpen,
      label: t("dockBar.topBar", { defaultValue: "Top bar" }),
      a11y: headerVisible
        ? t("dockBar.hideTopBar", { defaultValue: "Hide the top bar" })
        : t("dockBar.showTopBar", { defaultValue: "Show the top bar" }),
      enterIndex: 4,
      onPress: () => useWorkspaceStore.getState().toggleHeaderVisible(),
    },
    {
      key: "prev",
      Icon: ArrowUp,
      label: t("dockBar.prev", { defaultValue: "Previous" }),
      a11y: t("dockBar.prevHeading", { defaultValue: "Previous heading" }),
      disabled: prevHeading == null,
      enterIndex: 5,
      onPress: () => navigate("prev"),
    },
    {
      key: "next",
      Icon: ArrowDown,
      label: t("dockBar.next", { defaultValue: "Next" }),
      a11y: t("dockBar.nextHeading", { defaultValue: "Next heading" }),
      disabled: nextHeading == null,
      enterIndex: 6,
      onPress: () => navigate("next"),
    },
    {
      key: "search",
      Icon: Search,
      label: t("dockBar.search", { defaultValue: "Search" }),
      a11y: t("dockBar.search", { defaultValue: "Search" }),
      enterIndex: 7,
      onPress: openSearch,
    },
    {
      key: "selectMode",
      Icon: ListChecks,
      active: selectMode,
      label: t("dockBar.select", { defaultValue: "Select blocks" }),
      a11y: selectMode
        ? t("dockBar.selectDone", { defaultValue: "Done selecting" })
        : t("dockBar.select", { defaultValue: "Select blocks" }),
      enterIndex: 8,
      onPress: () => {
        const wasOn = useWorkspaceStore.getState().selectMode;
        useWorkspaceStore.getState().toggleSelectMode();
        // Turning it ON: the next thing to do is tap blocks in the document, so get
        // the sheet (and the bubble's tools) out of the way.
        if (!wasOn) {
          useFloatingPillStore.getState().setInputOpen(false);
          useFloatingPillStore.getState().setExpanded(false);
          Keyboard.dismiss();
          dismiss();
        }
      },
    },
    {
      key: "reorderMode",
      Icon: ArrowUpDown,
      active: reorderMode,
      label: t("dockBar.reorder", { defaultValue: "Reorder" }),
      a11y: t("dockBar.reorder", { defaultValue: "Reorder" }),
      enterIndex: 9,
      onPress: () => useWorkspaceStore.getState().toggleReorderMode(),
    },
    {
      key: "showPages",
      Icon: BookOpenText,
      active: showPages,
      label: t("workspace.pages.toggle", { defaultValue: "Show pages" }),
      a11y: t("workspace.pages.toggle", { defaultValue: "Show pages" }),
      enterIndex: 10,
      onPress: () => useWorkspaceStore.getState().toggleShowPages(),
    },
    {
      key: "pageBreak",
      Icon: SquareSplitVertical,
      label: t("ribbon.tools.pageBreak", { defaultValue: "Page break" }),
      a11y: t("ribbon.tools.pageBreak", { defaultValue: "Page break" }),
      disabled: !pageBreakIndices.length,
      enterIndex: 11,
      onPress: insertPageBreak,
    },
    {
      key: "insert",
      Icon: Plus,
      // Short label: the Insert menu's own title ("Insert into document") wraps to
      // two lines in an 80px tile and pushes the row out of alignment.
      label: t("dockBar.insert", { defaultValue: "Insert" }),
      a11y: t("insertMenu.title", { defaultValue: "Insert into document" }),
      enterIndex: 12,
      onPress: openInsert,
    },
    {
      key: "pageSetup",
      Icon: RectangleHorizontal,
      active: pageSetupOpen,
      label: t("ribbon.grp.pageSetup", { defaultValue: "Page setup" }),
      a11y: t("ribbon.grp.pageSetup", { defaultValue: "Page setup" }),
      enterIndex: 13,
      onPress: () => setPageSetupOpen((v) => !v),
    },
  ];

  const sep = (k: string) => <View key={k} style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />;
  const optPill = (disabled?: boolean) => [
    styles.optPill,
    { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
    disabled && styles.dim,
  ];
  const groupIcon = (Icon: LucideIcon) => (
    <View style={styles.groupIcon}>
      <Icon size={14} color={colors.textPlaceholder} strokeWidth={2} />
    </View>
  );

  const renderPageSetup = () => {
    if (!pageSetupOpen) return null;
    return (
      <Animated.View
        key="page-setup-expansion"
        entering={rowIn}
        exiting={rowOutUnlessHandoff}
        style={[styles.expansion, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.expansionRow, { flexDirection }]}>
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

  return (
    <View style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
      <GestureDetector gesture={dragPan}>
        <View style={styles.grabZone}>
          <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t("dockBar.tools", { defaultValue: "Document tools" })}
          </Text>
        </View>
      </GestureDetector>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottomInset + 16 }}>
        <View style={[styles.grid, { flexDirection }]}>
          {tools.map((tool) => {
            const tint = tool.disabled ? colors.textPlaceholder : tool.active ? colors.bgPrimary : colors.textPrimary;
            return (
              <AnimatedChip
                key={tool.key}
                onPress={() => {
                  tool.onPress();
                  if (!STAYS_OPEN.has(tool.key)) dismiss();
                }}
                disabled={tool.disabled}
                active={tool.active}
                accessibilityLabel={tool.a11y}
                enterIndex={tool.enterIndex}
                style={[styles.tile, { width: tileW }]}
              >
                <View
                  style={[
                    styles.tileIcon,
                    tool.active
                      ? { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary }
                      : { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
                    tool.disabled && styles.dim,
                  ]}
                >
                  <tool.Icon size={20} color={tint} strokeWidth={2} />
                </View>
                <Text numberOfLines={2} style={[styles.tileLabel, { color: tool.disabled ? colors.textPlaceholder : colors.textSecondary }]}>
                  {tool.label}
                </Text>
              </AnimatedChip>
            );
          })}
        </View>
        {renderPageSetup()}
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
  list: { flex: 1 },

  grid: { flexWrap: "wrap", gap: GRID_GAP, paddingHorizontal: PAD, paddingTop: 10 },
  tile: { alignItems: "center", gap: 6, paddingVertical: 8 },
  tileIcon: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  tileLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  dim: { opacity: 0.4 },

  // Page-setup options row — same chrome as the old dock expansion.
  expansion: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 6,
    marginHorizontal: PAD,
    marginTop: 10,
  },
  expansionRow: { alignItems: "center", gap: 6 },
  groupIcon: { width: 20, alignItems: "center", justifyContent: "center", marginHorizontal: 2 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  optPill: { minWidth: 42, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  optText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
