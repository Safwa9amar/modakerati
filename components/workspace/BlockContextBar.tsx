import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Keyboard, ActivityIndicator } from "react-native";
import type { ScrollView as RNScrollView } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
// Horizontal tool rows use gesture-handler's ScrollView so they scroll even when
// nested inside the reorderable list (RN's ScrollView loses the horizontal pan to
// the list's gesture handler).
import { ScrollView } from "react-native-gesture-handler";
import {
  Bold,
  Italic,
  Underline,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  PilcrowLeft,
  PilcrowRight,
  List,
  Palette,
  ChevronUp,
  ChevronDown,
  ImagePlus,
  RefreshCw,
  RotateCw,
  FlipHorizontal2,
  Crop,
  WandSparkles,
  Eraser,
  Trash2,
  Plus,
  Sparkles,
  ListTree,
  Search,
  X,
  ChevronsDownUp,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Rows3,
  Columns3,
  PanelTop,
  LayoutGrid,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Grid2x2,
  Square,
  StretchHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Check,
  Link2,
  SeparatorHorizontal,
  LayoutTemplate,
  Send,
  type LucideIcon,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { pickAndInsertImage } from "@/lib/insert-image";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";
import { useSearchStore } from "@/stores/search-store";
import { removeThesisBlockBg, chromeOp, listHfTemplates, type ChromeOp, type DocBlockDTO, type HfTemplateSummary, type HfPreviewLine, type HfPreviewSeg } from "@/lib/api";
import { rotateFlipBlockImage, type RotateFlipOp } from "@/lib/thesis-image-edit";
import { hWarn } from "@/lib/haptics";
import { estimateTokenCount } from "@/lib/thinking";
import { resolveBubbleKind, chromeBubbleKind, type BubbleKind } from "@/lib/bubble-configs";
import { PictureCropModal } from "./PictureCropModal";
import { AnimatedChip } from "./AnimatedChip";
import { chipOut, layoutSpring, pillIn, pillOutUnlessHandoff, rowIn, rowOutUnlessHandoff, SPRING_SOFT } from "@/lib/motion";
import { isPillHandoff, shouldGlow } from "@/lib/pill-handoff";
import type { FormatChange, ParaRun, ThesisOp } from "@/lib/thesis-ops";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;
type Align = "left" | "center" | "right" | "justify";
type Category = "style" | "align" | "direction" | "list" | "color" | "tblRows" | "tblCols" | "tblLayout" | "tblShade" | "tblBorders" | "hfAI" | "hfLink" | "hfAdd";

// Border pickers for the table Borders sub-pill: OOXML line styles (glyph
// labels), widths in points, and line colors (6-hex, no '#').
const BORDER_STYLES: { key: "single" | "double" | "dashed" | "dotted" | "thick"; glyph: string }[] = [
  { key: "single", glyph: "─" },
  { key: "double", glyph: "═" },
  { key: "dashed", glyph: "┄" },
  { key: "dotted", glyph: "┈" },
  { key: "thick", glyph: "━" },
];
const BORDER_WIDTHS: { pt: number; label: string }[] = [
  { pt: 0.5, label: "½" },
  { pt: 1, label: "1" },
  { pt: 2, label: "2" },
];
const BORDER_COLORS = ["000000", "808080", "4472C4", "ED7D31", "C00000"];

// Header-fill swatches for the table Shading sub-pill (6-hex, no '#') — the
// classic Word accent set + neutral gray.
const TABLE_FILLS = ["ED7D31", "4472C4", "70AD47", "FFC000", "D9D9D9"];
const ZEBRA_FILL = "F2F2F2";

// engine "both" == UI "justify"
const alignFromDoc = (a: string | null): Align | null => (a === "both" ? "justify" : (a as Align | null));

const STYLE_LEVELS = [0, 1, 2, 3];
const ALIGN_OPTIONS: { value: Align; Icon: LucideIcon }[] = [
  { value: "left", Icon: AlignLeft },
  { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight },
  { value: "justify", Icon: AlignJustify },
];
const DIRECTION_OPTIONS: { value: "rtl" | "ltr"; Icon: LucideIcon }[] = [
  { value: "rtl", Icon: PilcrowLeft },
  { value: "ltr", Icon: PilcrowRight },
];

const CHIP = 40;

// Text-colour palette for the Color category (6-hex RRGGBB, no '#'). A curated set
// that reads on both light/dark paper; the trailing "clear" swatch sends color:null.
const TEXT_COLORS = ["111827", "C0392B", "E67E22", "F1C40F", "27AE60", "2980B9", "8E44AD"] as const;

/** One-shot ring pulse behind ✦ Ask AI — once per NEW selection target, deduped
 *  across pill remounts (handoffs, keyboard open/close) via shouldGlow.
 *  Deliberately not an infinite loop (battery). `trigger` = the selection
 *  identity string. */
function AskAIGlow({ trigger, color }: { trigger: string; color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!shouldGlow(trigger)) return;
    scale.value = 1;
    opacity.value = 0.5;
    scale.value = withSpring(1.3, SPRING_SOFT);
    opacity.value = withTiming(0, { duration: 500 });
  }, [trigger, scale, opacity]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: CHIP / 2, backgroundColor: color }, style]}
    />
  );
}

/** Saving-in-flight dot: gentle repeat pulse; the loop dies with the unmount. */
function PulsingDot({ color }: { color: string }) {
  const v = useSharedValue(0.4);
  useEffect(() => {
    v.value = withRepeat(
      withSequence(withTiming(1, { duration: 600 }), withTiming(0.4, { duration: 600 })),
      -1,
      false,
    );
  }, [v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.7 + v.value * 0.5 }],
  }));
  return <Animated.View style={[styles.savingDot, { backgroundColor: color }, style]} />;
}

interface Props {
  thesisId: string;
  rtl: boolean;
  /** Selected PARAGRAPH blocks (in doc order) — the target of style/align/direction/
   *  clear/move/image. Empty when the selection is a table/image → those tools disable. */
  paragraphSelection: ParagraphBlock[];
  /** The SOLE selected block of ANY kind (null unless exactly one is selected).
   *  Drives the "smart pill": an image block swaps in image tools (replace/move/
   *  delete) as the primary actions, a table gets a minimal set, a paragraph keeps
   *  the text tools. */
  selectedBlock?: DocBlockDTO | null;
  /** Every selected block index (paragraph or not) — the target of Delete. */
  selectedIndices: number[];
  count: number;
  blockCount: number;
  /** Keyboard up → the full-width bar docked above the keyboard; down → floating pill. */
  keyboardOpen: boolean;
  /** Scope pill text (shown in the full-width form for AI targeting). */
  scopeLabel: string;
  onAskAI: () => void;
  bottomInset: number;
  /** When set (floating overlay only), the compact pill shows a leading collapse
   *  chevron that calls this — collapses the pill back to its bubble. The keyboard-
   *  docked bar never passes it. */
  onCollapse?: () => void;
  blocks?: DocBlockDTO[];
  /** When set, the selection is a Word chrome band (running header / footer / section
   *  break) rather than a block. The bar morphs to the chrome toolset using the SAME
   *  pill shell + entrance/expansion/morph animations as every other kind. */
  chrome?: {
    kind: "top" | "bottom" | "section";
    index: number;
    text: string;
    pageNumbers?: boolean;
    // Section-break band only: Word "Link to Previous" state (null = first section)
    // and whether the section already starts on a fresh page.
    linkedToPrevious?: boolean | null;
    startsOnNewPage?: boolean;
    // Top band only: the header's positioned segments — Edit-text pre-fills with these
    // (tab-joined) so the parts show separated instead of concatenated.
    segments?: string[];
    // Section band only: whether the section already renders a header / footer band —
    // gates the "Add header/footer" sub-pill options.
    hasHeader?: boolean;
    hasFooter?: boolean;
  } | null;
}

/**
 * The block-anchored formatting + AI bar. Two forms driven by keyboard state:
 *   • Keyboard closed → a compact floating PILL (Bold/Italic/Align/Direction + (+) + ✦ Ask AI).
 *     (+) expands the full tool set inline.
 *   • Keyboard open → a full-width BAR docked on the keyboard: the complete tool set in a
 *     horizontal scroll with ✦ Ask AI pinned outside it, plus a scope pill.
 * Category tools (Style/Align/Direction/List/Color) expand a contextual options row above
 * the bar; simple tools act immediately. Run-level marks (Bold/Italic/Underline) and the
 * Color palette apply WHOLE-PARAGRAPH inline formatting via the same `format` op (the DTO
 * carries `runs?` now). List stays Phase-2 (structural — the DTO can't carry it yet).
 */
export function BlockContextBar({
  thesisId,
  rtl,
  paragraphSelection,
  selectedBlock,
  selectedIndices,
  count,
  blockCount,
  keyboardOpen,
  scopeLabel,
  onAskAI,
  bottomInset,
  onCollapse,
  blocks,
  chrome,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  // The ✦ AI panel is app CHROME, not document content — it reads in the app's UI
  // language (e.g. a French-UI student writing an Arabic thesis still gets an LTR
  // prompt box), unlike `rtl` (the prop below) which is the DOCUMENT's direction.
  const { isRTL: appRtl } = useRTL();
  const saving = useThesisDocStore((s) => (s.pending[thesisId] ?? 0) > 0);
  // The live doc — used to walk between section boundaries (Prev/Next section) from
  // the chrome bubble. Selecting the stored object (stable ref) avoids a render loop.
  const chromeDoc = useThesisDocStore((s) => s.byId[thesisId]);
  // The active chrome AI proposal (header/footer), if any — drives the hfAI panel.
  const chromeSug = useSuggestionStore((s) => s.chrome);

  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  // Delete-pick mode inside the table Rows/Columns sub-pills: tapping the delete
  // chip shows numbered chips so the user deletes a SPECIFIC row/column (not
  // just the last one).
  const [delPick, setDelPick] = useState<"row" | "col" | null>(null);
  // Borders sub-pill selection: style × width × color combine, and every tap
  // applies the combined config immediately (silent layout op).
  const [bStyle, setBStyle] = useState<"single" | "double" | "dashed" | "dotted" | "thick">("single");
  const [bSizePt, setBSizePt] = useState(0.5);
  const [bColor, setBColor] = useState("000000");
  const [pillExpanded, setPillExpanded] = useState(false);
  const pickingRef = useRef(false);
  // Advanced picture ops: `busy` guards the async rotate/flip/remove-bg (disables
  // those chips while one runs); `cropIndex` drives the interactive crop modal.
  const [busy, setBusy] = useState(false);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  // Draft AI instruction for the chrome band's ✦ proposal (hfAI category).
  const [aiText, setAiText] = useState("");
  // Header/footer template picker — a collapsible "or choose a template" section
  // NESTED inside the single hfAI panel (not its own top-level chip): staff-authored
  // Studio templates fetched lazily on first reveal; `applyingTplId` shows a per-card
  // spinner. Tapping one applies it directly, same as approving an AI proposal.
  const [showTemplates, setShowTemplates] = useState(false);
  const [tplStatus, setTplStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tplList, setTplList] = useState<HfTemplateSummary[]>([]);
  const [applyingTplId, setApplyingTplId] = useState<string | null>(null);
  // Which template row is expanded to its stacked header/footer preview (accordion).
  const [expandedTplId, setExpandedTplId] = useState<string | null>(null);
  // Draft {token} values the student types for the currently-expanded template (a
  // template with tokens must be filled before it applies). Reset when the expanded
  // row changes so one template's values never leak into another's.
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  // Measured inner width of the expansion panel, so the template picker (a vertical
  // list inside a horizontal ScrollView) can fill the container instead of hugging
  // its content. 0 until first layout.
  const [expWidth, setExpWidth] = useState(0);

  const canFormat = paragraphSelection.length > 0;
  const paraIndices = paragraphSelection.map((b) => b.index);
  const single = paragraphSelection.length === 1 ? paragraphSelection[0] : null;

  // Dynamically compute heading levels up to deepestHeadingLevel + 1.
  const deepestHeadingLevel = useMemo(() => {
    if (!blocks) return 2; // Default fallback to H2
    let max = 0;
    for (const b of blocks) {
      if (b.kind === "paragraph" && b.level > max) {
        max = b.level;
      }
    }
    return max;
  }, [blocks]);

  const maxHeadingLevel = Math.min(6, deepestHeadingLevel + 1);
  const headingLevels = useMemo(() => {
    return Array.from({ length: maxHeadingLevel }, (_, i) => i + 1);
  }, [maxHeadingLevel]);

  const styleLevels = useMemo(() => {
    return [0, ...headingLevels];
  }, [headingLevels]);

  // Smart-pill mode: which toolset the sole selection gets, driven by the SAME
  // registry that picks the collapsed bubble's icon (FloatingPill) — so the
  // glyph and the toolset can never disagree. `isImage` is true ONLY for a real
  // picture (media bytes present) — a chart is an "image" kind block too but
  // WITHOUT bytes, so it must not get the picture ops (rotate/crop/removeBg).
  const bubbleKind: BubbleKind = chrome ? chromeBubbleKind(chrome.kind) : resolveBubbleKind(selectedBlock);
  // A Word chrome band (top-of-page / bottom-of-page / section break) — no block
  // formatting applies; the shell + ✦ Ask carry it, morphing in like any other kind.
  const isChrome = bubbleKind === "hfTop" || bubbleKind === "hfBottom" || bubbleKind === "hfSection";
  const isImage = bubbleKind === "image";
  const isTable = bubbleKind === "table";
  // Chart placeholders and raw "other" OOXML blocks share a minimal toolset
  // (move up/down/delete) — no text/format/picture tools apply to either.
  const isMinimal = bubbleKind === "chart" || bubbleKind === "other";
  // Keyed remount of the tool row per block kind → old chips fade out (chipOut on
  // the row), new chips stagger in (per-chip chipIn) = the smart-pill morph.
  // "text" and "heading" share one key ("para") so switching body↔heading text
  // doesn't remount the (identical) paragraph tools; chart/other keep their own
  // key so the minimal toolset remount is still visible on kind changes.
  const toolsetKind = bubbleKind === "text" || bubbleKind === "heading" ? "para" : bubbleKind;

  // HEADING nicety: the moment the sole selection BECOMES a heading, auto-reveal
  // the Style category so H1/H2/H3 options are immediately visible — but never
  // force-close it when the selection moves away from a heading (the user's own
  // category choice sticks). Guarded by a transition check (prev !== "heading")
  // so it fires once per entry, not on every render while heading stays selected.
  const prevBubbleKindRef = useRef<BubbleKind | null>(null);
  useEffect(() => {
    if (bubbleKind === "heading" && prevBubbleKindRef.current !== "heading") {
      if (keyboardOpen || pillExpanded) {
        setActiveCategory("style");
      } else {
        setActiveCategory(null);
      }
    } else if (bubbleKind === "heading" && !keyboardOpen && !pillExpanded) {
      setActiveCategory(null);
    }
    prevBubbleKindRef.current = bubbleKind;
  }, [bubbleKind, keyboardOpen, pillExpanded]);

  // HEADER/FOOTER nicety: the moment a header or footer band is selected, open the
  // ✦ AI panel DIRECTLY — no intermediate "tap the chip" step. There's nothing else
  // to do with these bands (the smart generate + template picker is the whole
  // toolset), so showing it immediately is strictly faster, not a surprise. Keyed
  // on kind+index so re-selecting a DIFFERENT band re-opens fresh; the student can
  // still collapse it manually and it stays closed until they select again.
  const prevChromeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = chrome && (chrome.kind === "top" || chrome.kind === "bottom") ? `${chrome.kind}:${chrome.index}` : null;
    if (key && key !== prevChromeKeyRef.current) {
      setAiText("");
      setShowTemplates(false);
      setActiveCategory("hfAI");
    }
    prevChromeKeyRef.current = key;
  }, [chrome?.kind, chrome?.index]);

  // Morphing toolsets keeps the ScrollView instance alive — snap back to the start
  // so a long paragraph toolset scrolled right can't leave a short image/table row
  // stranded past its own content (blank pill). Only one of the three tool
  // ScrollViews is mounted at a time, so they share one ref.
  const toolsScrollRef = useRef<RNScrollView>(null);
  useEffect(() => {
    toolsScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [toolsetKind]);

  // A generic sole-block anchor (any kind) for move/replace/delete — the old
  // `single` only covered paragraphs, so image/table move needs this.
  const soleIndex = selectedBlock ? selectedBlock.index : null;
  const soleText =
    selectedBlock?.kind === "paragraph"
      ? selectedBlock.text
      : selectedBlock?.kind === "image"
        ? (selectedBlock.caption ?? "")
        : "";

  // Is the Lexical Writer the active surface? Then formatting goes STRAIGHT to the
  // editor (instant, on the selected block) and persists via its batched auto-sync
  // on exit — NOT one durable /paragraphs/bulk op per tap (that flooded the API).
  const lexActive = useLexicalEditorStore((s) => s.active);
  const lexFmt = useLexicalEditorStore((s) => s.format);

  // ── Wiring ──
  // Lexical active → dispatch a whole-block `blockFormat` command into the editor
  // (mirrors the server's whole-paragraph format op). Otherwise (legacy composer)
  // → the durable op queue, exactly as before.
  const apply = (changes: FormatChange) => {
    if (!paraIndices.length) return;
    if (lexActive) {
      useLexicalEditorStore.getState().dispatch("blockFormat", JSON.stringify({ indices: paraIndices, changes }));
      return;
    }
    void useThesisDocStore.getState().mutate(thesisId, { type: "format", indices: paraIndices, changes });
  };

  // ── Table editing (the selected block is a table) ──
  const tableRows = selectedBlock?.kind === "table" ? selectedBlock.rows.length : 0;
  const tableCols = selectedBlock?.kind === "table" ? (selectedBlock.rows[0]?.length ?? 0) : 0;
  // Word table styling the server rides on the table DTO (see server
  // parseTableStyle) — not on the base api type, so read it through a cast to
  // drive the active states in the Layout sub-pill.
  const tableStyle =
    selectedBlock?.kind === "table"
      ? (selectedBlock as {
          align?: "left" | "center" | "right" | null;
          direction?: "rtl" | "ltr";
          header?: boolean;
        })
      : null;
  const tableAlign = tableStyle?.align ?? null;
  const tableDirection = tableStyle?.direction ?? null;
  const tableHeader = !!tableStyle?.header;
  const tableEdit = (op: Omit<Extract<ThesisOp, { type: "tableOp" }>, "type" | "index">) => {
    if (soleIndex == null) return;
    // Silent sync (shared with in-cell editing): optimistic patch + direct server
    // apply, no durable-queue drainTick refetch cascade. See the store method.
    void useThesisDocStore.getState().applyTableOpSilent(thesisId, { type: "tableOp", index: soleIndex, ...op });
  };

  const move = (dir: "up" | "down") => {
    if (soleIndex == null) return;
    const from = soleIndex;
    const to = dir === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= blockCount) return;
    useWorkspaceStore.getState().selectBlock(to, soleText);
    void useThesisDocStore.getState().mutate(thesisId, { type: "move", from, to });
  };
  const canUp = soleIndex != null && soleIndex > 0;
  const canDown = soleIndex != null && soleIndex < blockCount - 1;

  // Pick a new image and swap the selected figure's bytes IN PLACE (durable
  // replaceImage op → optimistic instant repaint + reconcile). Mirrors pickImage.
  const replaceImage = async () => {
    if (soleIndex == null || pickingRef.current) return;
    pickingRef.current = true;
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.85 });
    } catch {
      Alert.alert(t("workspace.imageError", { defaultValue: "Couldn't update the image." }));
      return;
    } finally {
      pickingRef.current = false;
    }
    const asset = res.canceled ? null : res.assets[0];
    if (!asset?.base64) return;
    const mime = asset.mimeType ?? "";
    const format = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg";
    void useThesisDocStore.getState().mutate(thesisId, {
      type: "replaceImage",
      index: soleIndex,
      data: asset.base64,
      format,
      width: asset.width,
      height: asset.height,
    });
  };

  // ── Advanced picture ops (mirror lib/ribbon-actions.ts Picture tab) ──
  // Rotate / flip the selected figure ON-DEVICE: download its current bytes via the
  // authed media endpoint (rotateFlipBlockImage → downloadBlockImage), transform with
  // expo-image-manipulator, then swap them in through the durable `replaceImage` op —
  // the same optimistic + durable-queue path as "Replace image" above.
  const rotateFlip = async (op: RotateFlipOp) => {
    if (soleIndex == null || busy) return;
    setBusy(true);
    try {
      const edited = await rotateFlipBlockImage(thesisId, soleIndex, op);
      if (!edited.data) throw new Error("empty image");
      void useThesisDocStore.getState().mutate(thesisId, {
        type: "replaceImage",
        index: soleIndex,
        data: edited.data,
        format: edited.format,
        width: edited.width,
        height: edited.height,
      });
    } catch {
      Alert.alert(t("workspace.imageError", { defaultValue: "Couldn't update the image." }));
    } finally {
      setBusy(false);
    }
  };

  // Remove the figure's background SERVER-SIDE (rembg sidecar — no pixels travel
  // through the app). Direct endpoint (bypasses the op queue), so revalidate the doc
  // store afterward to repaint, exactly like the ribbon Picture tab. Fails cleanly
  // (Alert) when the sidecar isn't running.
  const removeBg = async () => {
    if (soleIndex == null || busy) return;
    setBusy(true);
    try {
      await removeThesisBlockBg(thesisId, soleIndex);
      await useThesisDocStore.getState().revalidate(thesisId);
    } catch {
      Alert.alert(
        t("common.error", { defaultValue: "Error" }),
        t("workspace.bgError", { defaultValue: "Couldn't remove the background. Please try again." }),
      );
    } finally {
      setBusy(false);
    }
  };

  // Body extracted to lib/insert-image.ts (shared with the Insert menu's Figure
  // block); this just keeps the component-local "is a single block selected?"
  // eligibility check.
  const pickImage = () => {
    if (!single) return;
    void pickAndInsertImage(thesisId, single.index);
  };

  const del = () => {
    if (!selectedIndices.length) return;
    Alert.alert(
      t("workspace.deleteSelectedTitle", { defaultValue: "Delete selected blocks?" }),
      t("workspace.deleteSelectedBody", { count, defaultValue: `Remove ${count} block(s) from the document? You can undo this from History.` }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("common.delete", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: () => {
            hWarn();
            void useThesisDocStore.getState().mutate(thesisId, { type: "deleteBlocks", indices: selectedIndices });
            useWorkspaceStore.getState().clearSelection();
          },
        },
      ],
    );
  };

  const soon = () =>
    Alert.alert(t("blockBar.soonTitle", { defaultValue: "Coming soon" }), t("blockBar.soonBody", { defaultValue: "Inline text styling arrives in a later update." }));

  // Active-state helpers for the expansion options. When Lexical is active they
  // reflect the REAL editor selection (reported into the store), so the pill's
  // highlights match what the caret actually sits in.
  const allLevel = (l: number) =>
    lexActive
      ? l === 0
        ? lexFmt.blockType === "paragraph" || lexFmt.blockType === "quote"
        : lexFmt.blockType === "h" + l
      : canFormat && paragraphSelection.every((b) => b.level === l);
  const allAlign = (v: Align) => (lexActive ? lexFmt.alignment === v : canFormat && paragraphSelection.every((b) => alignFromDoc(b.alignment) === v));
  const allDirection = (v: "rtl" | "ltr") => (lexActive ? (lexFmt.isRTL ? "rtl" : "ltr") === v : canFormat && paragraphSelection.every((b) => b.direction === v));

  // Inline-mark active state (Bold/Italic/Underline/Color). The paragraph DTO carries
  // `runs?` (server-emitted) but the app's DocBlockDTO type doesn't declare it — read
  // it defensively via cast. A mark is "on" only when EVERY run of EVERY selected
  // paragraph carries it (so a partially-marked selection reads off → the toggle sets
  // it on all runs). A plain paragraph has no `runs`, so it reads off.
  const runsOf = (b: ParagraphBlock): ParaRun[] | undefined => (b as { runs?: ParaRun[] }).runs;
  const allMark = (on: (r: ParaRun) => boolean) =>
    canFormat &&
    paragraphSelection.every((b) => {
      const runs = runsOf(b);
      return !!runs && runs.length > 0 && runs.every(on);
    });
  const allBold = lexActive ? lexFmt.bold : allMark((r) => !!r.bold);
  const allItalic = lexActive ? lexFmt.italic : allMark((r) => !!r.italic);
  const allUnderline = lexActive ? lexFmt.underline : allMark((r) => !!r.underline);
  // Lexical doesn't report per-selection color, so the swatch active-ring is only
  // shown in the legacy (block-model) path.
  const colorActive = (hex: string) => (lexActive ? false : allMark((r) => (r.color ?? "").toUpperCase() === hex.toUpperCase()));

  const toggleCategory = (c: Category) => {
    setDelPick(null); // leaving/entering a category always exits delete-pick mode
    setActiveCategory((cur) => (cur === c ? null : c));
  };

  // ── Small building blocks ──
  // Plain element-returning helpers (NOT inner components) so they aren't a fresh
  // component type each render (which would remount every chip). AnimatedChip itself
  // is declared once at module scope so its TYPE stays stable across renders.
  const chip = (opts: {
    keyProp: string;
    Icon: LucideIcon;
    onPress: () => void;
    active?: boolean;
    disabled?: boolean;
    dim?: boolean;
    accessibilityLabel: string;
    enterIndex?: number | null;
  }) => {
    const { Icon } = opts;
    return (
      <AnimatedChip
        key={opts.keyProp}
        onPress={opts.onPress}
        disabled={opts.disabled}
        active={opts.active}
        accessibilityLabel={opts.accessibilityLabel}
        enterIndex={opts.enterIndex}
        style={[
          styles.chip,
          { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
          opts.active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
          (opts.disabled || opts.dim) && styles.chipDim,
        ]}
      >
        <Icon size={17} color={opts.active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
      </AnimatedChip>
    );
  };

  const categoryChip = (c: Category, Icon: LucideIcon, label: string, enterIndex?: number) =>
    chip({
      keyProp: "cat-" + c,
      Icon,
      accessibilityLabel: label,
      enterIndex,
      active: activeCategory === c,
      disabled: (c === "style" || c === "align" || c === "direction") && !canFormat,
      onPress: () => toggleCategory(c),
    });

  const sep = (k: string) => <View key={k} style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />;

  // The complete tool set for the full-width bar / expanded pill.
  const fullTools = (
    <>
      {chip({ keyProp: "bold", Icon: Bold, accessibilityLabel: t("blockBar.bold", { defaultValue: "Bold" }), active: allBold, disabled: !canFormat, enterIndex: 0, onPress: () => apply({ bold: !allBold }) })}
      {chip({ keyProp: "italic", Icon: Italic, accessibilityLabel: t("blockBar.italic", { defaultValue: "Italic" }), active: allItalic, disabled: !canFormat, enterIndex: 1, onPress: () => apply({ italic: !allItalic }) })}
      {chip({ keyProp: "underline", Icon: Underline, accessibilityLabel: t("blockBar.underline", { defaultValue: "Underline" }), active: allUnderline, disabled: !canFormat, enterIndex: 2, onPress: () => apply({ underline: !allUnderline }) })}
      {sep("s1")}
      {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }), 3)}
      {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 4)}
      {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }), 5)}
      {categoryChip("list", List, t("blockBar.list", { defaultValue: "List" }), 6)}
      {categoryChip("color", Palette, t("blockBar.color", { defaultValue: "Color" }), 7)}
      {sep("s2")}
      {single
        ? [
            chip({ keyProp: "up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, enterIndex: 8, onPress: () => move("up") }),
            chip({ keyProp: "down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, enterIndex: 9, onPress: () => move("down") }),
            chip({ keyProp: "img", Icon: ImagePlus, accessibilityLabel: t("blockBar.image", { defaultValue: "Insert image" }), enterIndex: 10, onPress: () => void pickImage() }),
          ]
        : null}
      {chip({ keyProp: "clear", Icon: Eraser, accessibilityLabel: t("blockBar.clear", { defaultValue: "Clear formatting" }), disabled: !canFormat, enterIndex: 11, onPress: () => apply({ clearFormatting: true }) })}
      {chip({ keyProp: "del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: 12, onPress: del })}
    </>
  );

  // The curated pill tool set (keyboard closed, not expanded).
  const pillTools = (
    <>
      {chip({ keyProp: "bold", Icon: Bold, accessibilityLabel: t("blockBar.bold", { defaultValue: "Bold" }), active: allBold, disabled: !canFormat, enterIndex: 0, onPress: () => apply({ bold: !allBold }) })}
      {chip({ keyProp: "italic", Icon: Italic, accessibilityLabel: t("blockBar.italic", { defaultValue: "Italic" }), active: allItalic, disabled: !canFormat, enterIndex: 1, onPress: () => apply({ italic: !allItalic }) })}
      {chip({ keyProp: "underline", Icon: Underline, accessibilityLabel: t("blockBar.underline", { defaultValue: "Underline" }), active: allUnderline, disabled: !canFormat, enterIndex: 2, onPress: () => apply({ underline: !allUnderline }) })}
      {sep("s1-compact")}
      {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }), 4)}
      {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 5)}
      {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }), 6)}
      {chip({ keyProp: "p-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), enterIndex: 7, onPress: () => setPillExpanded(true) })}
    </>
  );

  // The primary action buttons for heading blocks (keyboard closed, not expanded).
  // Shows levels from H1 to the computed deepest used level + 1.
  const headingPillTools = (
    <>
      {(rtl ? [...headingLevels].reverse() : headingLevels).map((l, i) => {
        const active = allLevel(l);
        const enterIndex = rtl ? headingLevels.length - 1 - i : i;
        return (
          <AnimatedChip
            key={"h-" + l}
            enterIndex={enterIndex}
            onPress={() => apply({ level: active ? 0 : l })}
            disabled={!canFormat}
            active={active}
            accessibilityLabel={`H${l}`}
            style={[
              styles.chip,
              { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
              active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
              !canFormat && styles.chipDim,
            ]}
          >
            <Text style={[styles.optText, { color: active ? colors.bgPrimary : colors.textPrimary, fontWeight: "bold" }]}>
              {`H${l}`}
            </Text>
          </AnimatedChip>
        );
      })}
      {chip({ keyProp: "h-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), enterIndex: headingLevels.length, onPress: () => setPillExpanded(true) })}
    </>
  );

  // ── IMAGE block: image tools are PRIMARY (no Style/Align/Direction) ──
  const imageMoveDeleteChips = (base: number) => [
    chip({ keyProp: "img-up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, enterIndex: base, onPress: () => move("up") }),
    chip({ keyProp: "img-down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, enterIndex: base + 1, onPress: () => move("down") }),
    chip({ keyProp: "img-del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: base + 2, onPress: del }),
  ];
  // Compact pill: Replace / Move up / Move down / Delete / (+).
  const imagePillTools = (
    <>
      {chip({ keyProp: "img-replace", Icon: RefreshCw, accessibilityLabel: t("blockBar.replaceImage", { defaultValue: "Replace image" }), enterIndex: 0, onPress: () => void replaceImage() })}
      {imageMoveDeleteChips(1)}
      {chip({ keyProp: "img-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), enterIndex: 4, onPress: () => setPillExpanded(true) })}
    </>
  );
  // Expanded / keyboard-docked: the same primaries + the advanced picture ops, now
  // fully wired (rotate/flip on-device → durable replaceImage op, crop modal, server
  // remove-bg). Disabled while an async op is running.
  const imageFullTools = (
    <>
      {chip({ keyProp: "img-replace", Icon: RefreshCw, accessibilityLabel: t("blockBar.replaceImage", { defaultValue: "Replace image" }), enterIndex: 0, onPress: () => void replaceImage() })}
      {imageMoveDeleteChips(1)}
      {sep("is1")}
      {chip({ keyProp: "img-rotate", Icon: RotateCw, accessibilityLabel: t("blockBar.rotate", { defaultValue: "Rotate" }), disabled: busy, enterIndex: 4, onPress: () => void rotateFlip("rotateRight") })}
      {chip({ keyProp: "img-flip", Icon: FlipHorizontal2, accessibilityLabel: t("blockBar.flip", { defaultValue: "Flip" }), disabled: busy, enterIndex: 5, onPress: () => void rotateFlip("flipH") })}
      {chip({ keyProp: "img-crop", Icon: Crop, accessibilityLabel: t("blockBar.crop", { defaultValue: "Crop" }), disabled: busy, enterIndex: 6, onPress: () => { if (soleIndex != null) setCropIndex(soleIndex); } })}
      {chip({ keyProp: "img-bg", Icon: WandSparkles, accessibilityLabel: t("blockBar.removeBg", { defaultValue: "Remove background" }), disabled: busy, enterIndex: 7, onPress: () => void removeBg() })}
    </>
  );

  // Open the top-pinned document search (Writer-only → close any preview first).
  const openSearch = () => {
    Keyboard.dismiss();
    const ws = useWorkspaceStore.getState();
    if (ws.previewMode != null) ws.closePreview();
    useSearchStore.getState().openSearch();
  };

  // ── TABLE block: structure + layout editing organized into CATEGORIES that each
  // open a sub-pill of tools (Rows / Columns / Layout), mirroring the paragraph
  // Style/Align/Direction pattern — see renderExpansion() for the tool rows. Edits
  // go through the server tableOp (engine Doc facade, formatting-preserving) via
  // the silent sync path. The row (⋯) also carries move/delete of the whole table
  // + document search. ──
  const tableTools = (
    <>
      {categoryChip("tblRows", Rows3, t("blockBar.rows", { defaultValue: "Rows" }), 0)}
      {categoryChip("tblCols", Columns3, t("blockBar.columns", { defaultValue: "Columns" }), 1)}
      {categoryChip("tblLayout", LayoutGrid, t("blockBar.tableLayout", { defaultValue: "Table layout" }), 2)}
      {categoryChip("tblShade", Palette, t("blockBar.tableShading", { defaultValue: "Table colors" }), 3)}
      {categoryChip("tblBorders", Grid2x2, t("blockBar.tableBorders", { defaultValue: "Borders" }), 4)}
      {sep("ts1")}
      {imageMoveDeleteChips(5)}
      {chip({ keyProp: "tbl-search", Icon: Search, accessibilityLabel: t("dockBar.search", { defaultValue: "Search" }), enterIndex: 8, onPress: openSearch })}
    </>
  );

  // ── CHART / OTHER block: same minimal Move/Delete set — no text/format tools
  // apply, and (unlike a real picture) there are no media bytes for the picture
  // ops either. ──
  const minimalTools = <>{imageMoveDeleteChips(0)}</>;

  // Chrome bands are AI-first in v1: the only action is ✦ Ask (pinned in the shell),
  // so the tool row is empty. The pill still uses the identical shell + entrance/
  // expansion/morph animations — chrome is just another toolsetKind.
  // Direct (non-AI) chrome-band edits via /chrome-op. `chrome.index` is a block
  // inside the target Word section; the server resolves the section + persists,
  // echoing the mutated document which we apply to the optimistic doc store.
  const applyChrome = (op: ChromeOp) => {
    void (async () => {
      try {
        const res = await chromeOp(thesisId, op);
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
      } catch {
        Alert.alert(t("common.error", { defaultValue: "Something went wrong" }));
      }
    })();
  };
  // Section-break band: Word's "Link to Previous" for the whole section (header +
  // footer). A bare link icon reads as nothing to a student, so the chip opens a
  // sub-pill (hfLink) with two plain-language choices instead of toggling in place.
  // Linked → the section shares the previous section's running chrome; unlink → it
  // gets its own independent copy. Optimistically set the state; the echoed document
  // reconciles doc.sections for the next tap.
  const setLinkedToPrev = (linked: boolean) => {
    if (!chrome || chrome.kind !== "section") return;
    applyChrome({ op: linked ? "linkToPrevious" : "unlinkFromPrevious", index: chrome.index });
    useWorkspaceStore.getState().setChromeSelection({ ...chrome, linkedToPrevious: linked });
    setActiveCategory(null);
  };
  // Convert a continuous section break into a new-page break (one-way — the chip is
  // only shown while the section still flows continuously).
  const startOnNewPage = () => {
    if (!chrome || chrome.kind !== "section") return;
    applyChrome({ op: "startOnNewPage", index: chrome.index });
    useWorkspaceStore.getState().setChromeSelection({ ...chrome, startsOnNewPage: true });
  };

  // Give a section that has NO header/footer band a fresh one, straight from the
  // section bubble. `setHeaderText`/`setFooter` create the part server-side even from
  // empty; the echoed doc re-renders the band via buildChrome. We optimistically
  // select the new band so its tools appear at once — and because its kind becomes
  // top/bottom, the existing "auto-open ✦ on a header/footer band" effect opens the
  // ✦ panel, landing the student directly in "then edit".
  const addHeader = () => {
    if (!chrome || chrome.kind !== "section") return;
    applyChrome({ op: "setHeaderText", index: chrome.index, text: "" });
    useWorkspaceStore.getState().setChromeSelection({ kind: "top", index: chrome.index, text: "" });
    setActiveCategory(null);
  };
  const addFooter = () => {
    if (!chrome || chrome.kind !== "section") return;
    // A new footer defaults to centered page numbers — the most common real footer.
    applyChrome({ op: "setFooter", index: chrome.index, text: "", pageNumbers: true, alignment: "center" });
    useWorkspaceStore.getState().setChromeSelection({ kind: "bottom", index: chrome.index, text: "", pageNumbers: true });
    setActiveCategory(null);
  };

  // ── Prev/Next section navigation (chrome section band) ──
  // Walk the doc's section boundaries. A section band's `index` IS that section's
  // startBlockIndex, so we find our position in doc.sections and scroll the writer
  // to the adjacent boundary (which flashes it into view).
  const chromeSecs = chromeDoc?.available ? chromeDoc.sections ?? [] : [];
  const curSecPos =
    chrome?.kind === "section" ? chromeSecs.findIndex((sc) => sc.startBlockIndex === chrome.index) : -1;
  const hasPrevSection = curSecPos > 0;
  const hasNextSection = curSecPos >= 0 && curSecPos < chromeSecs.length - 1;
  const goToSection = (delta: -1 | 1) => {
    const target = chromeSecs[curSecPos + delta];
    if (!target) return;
    setActiveCategory(null);
    useWorkspaceStore.getState().requestScrollToBlock(target.startBlockIndex);
  };

  // ── Chrome ✦ AI proposal: the AI drafts a full model (grounded on the section +
  // current header/footer + Studio templates), shown as a faithful compiled preview
  // with approve/reject; a nested "or choose a template" list stays one tap away. ──
  const openHfAi = () => {
    setAiText("");
    setShowTemplates(false);
    setActiveCategory((cur) => (cur === "hfAI" ? null : "hfAI"));
  };
  const submitChromeAi = () => {
    const instruction = aiText.trim();
    if (!chrome || (chrome.kind !== "top" && chrome.kind !== "bottom") || !instruction) return;
    void useSuggestionStore.getState().requestChrome(thesisId, chrome.index, chrome.kind, chrome.text, instruction);
    Keyboard.dismiss();
  };
  const approveChromeSug = () => {
    // The applied model may be a table/multi-segment/logo result — not representable
    // as a flat `text` patch, so no optimistic chromeSelection edit here. The doc
    // echo (approveChrome → setDoc) updates sections[]; the band picks up the fresh
    // header/footer + segments the next time it reports selection.
    useSuggestionStore.getState().approveChrome(thesisId);
    setActiveCategory(null);
  };
  const rejectChromeSug = () => {
    useSuggestionStore.getState().rejectChrome();
    setAiText("");
  };

  // ── Header/footer template picker (hfTemplate category, top + bottom bands) ──
  // Each chrome bubble owns its own region: the top band previews + applies only the
  // HEADER, the bottom band only the FOOTER. Fetch the staff-authored Studio
  // templates lazily on first open (the first row auto-expands to its stacked
  // preview), then apply the chosen region at full fidelity via chromeOp.
  const tplRegion: "header" | "footer" = chrome?.kind === "bottom" ? "footer" : "header";
  // Always re-fetch on open so newly created/edited Studio templates show up. When
  // a list is already in hand, refresh silently (no loading flash) and update in
  // place, keeping the current row expanded if it still exists.
  const loadTemplates = async (silent = false) => {
    if (!silent) setTplStatus("loading");
    try {
      const { templates } = await listHfTemplates();
      setTplList(templates);
      setExpandedTplId((cur) => {
        const next = cur && templates.some((x) => x.id === cur) ? cur : templates[0]?.id ?? null;
        if (next !== cur) setTokenValues({}); // a new row opened → fresh fill draft
        return next;
      });
      setTplStatus("ready");
    } catch {
      if (!silent) setTplStatus("error");
    }
  };
  const toggleTemplates = () => {
    setShowTemplates((cur) => {
      const next = !cur;
      if (next) void loadTemplates(tplList.length > 0);
      return next;
    });
  };
  const applyHfTemplate = (templateId: string, values?: Record<string, string>) => {
    if (!chrome || applyingTplId) return;
    setApplyingTplId(templateId);
    void (async () => {
      try {
        const res = await chromeOp(thesisId, { op: "applyTemplate", index: chrome.index, templateId, region: tplRegion, values });
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
        setActiveCategory(null);
        setShowTemplates(false);
      } catch {
        Alert.alert(t("common.error", { defaultValue: "Something went wrong" }));
      } finally {
        setApplyingTplId(null);
      }
    })();
  };
  // Localize a preview field token; page numbers stay as universal symbols.
  const fieldToken = (field: string): string => {
    switch (field) {
      case "pageNumber": return "#";
      case "totalPages": return "# / #";
      case "styleRef": return t("workspace.hf.field.chapter", { defaultValue: "⟨chapter⟩" });
      case "docTitle": return t("workspace.hf.field.title", { defaultValue: "⟨title⟩" });
      case "author": return t("workspace.hf.field.author", { defaultValue: "⟨author⟩" });
      case "university": return t("workspace.hf.field.university", { defaultValue: "⟨university⟩" });
      case "date": return t("workspace.hf.field.date", { defaultValue: "⟨date⟩" });
      default: return "⟨…⟩";
    }
  };
  // A student-fillable {token}: show the live draft value once typed, else the
  // {placeholder} so the preview reads as "this slot gets filled." `values` is the
  // draft the fill form collects; omitted for the AI proposal preview (no tokens).
  const segText = (seg: HfPreviewSeg, values?: Record<string, string>): string =>
    "text" in seg ? seg.text
      : "logo" in seg ? "🖼"
      : "token" in seg ? (values && values[seg.token] ? values[seg.token] : `{${seg.token}}`)
      : fieldToken(seg.field);
  // "left_cell_text" → "Left cell text" for the fill-form input label.
  const humanizeToken = (name: string): string => {
    const s = name.replace(/[_-]+/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
  };

  // Chrome-band tools — same chip look/animation as every kind. Top/bottom: ONE ✦ AI
  // entry point (it reads the section's content, the current header/footer, and the
  // university's own Studio templates, then proposes a full faithful result — manual
  // edit/page-number/template chips folded into that single flow). Section-break
  // bands: Link (labeled sub-pill) + Prev/Next section + start-on-new-page.
  const chromeTools =
    chrome?.kind === "top" || chrome?.kind === "bottom" ? (
      <>{chip({ keyProp: "hf-ai", Icon: Sparkles, accessibilityLabel: t("workspace.hf.aiEdit", { defaultValue: "Ask AI to change" }), active: activeCategory === "hfAI", enterIndex: 0, onPress: openHfAi })}</>
    ) : chrome?.kind === "section" ? (
      // Section-break band: the link chip opens a labeled sub-pill (hfLink) so the
      // choice reads in words, not a bare icon. Then Prev/Next jump between section
      // boundaries, and a one-tap "Start on a new page" appears while the break is
      // still continuous.
      <>
        {!chrome.hasHeader || !chrome.hasFooter
          ? chip({
              keyProp: "hf-add",
              Icon: Plus,
              accessibilityLabel: t("workspace.hf.addHeaderFooter", { defaultValue: "Add header / footer" }),
              active: activeCategory === "hfAdd",
              enterIndex: 0,
              onPress: () => setActiveCategory((cur) => (cur === "hfAdd" ? null : "hfAdd")),
            })
          : null}
        {chrome.linkedToPrevious != null
          ? chip({
              keyProp: "hf-link",
              Icon: Link2,
              accessibilityLabel: t("workspace.hf.linkToggle", { defaultValue: "Link to previous section" }),
              active: activeCategory === "hfLink",
              enterIndex: 1,
              onPress: () => setActiveCategory((cur) => (cur === "hfLink" ? null : "hfLink")),
            })
          : null}
        {chip({
          keyProp: "hf-prev-sec",
          Icon: ChevronUp,
          accessibilityLabel: t("workspace.hf.prevSection", { defaultValue: "Previous section" }),
          active: false,
          disabled: !hasPrevSection,
          enterIndex: 2,
          onPress: () => goToSection(-1),
        })}
        {chip({
          keyProp: "hf-next-sec",
          Icon: ChevronDown,
          accessibilityLabel: t("workspace.hf.nextSection", { defaultValue: "Next section" }),
          active: false,
          disabled: !hasNextSection,
          enterIndex: 3,
          onPress: () => goToSection(1),
        })}
        {!chrome.startsOnNewPage
          ? chip({
              keyProp: "hf-newpage",
              Icon: SeparatorHorizontal,
              accessibilityLabel: t("workspace.hf.startOnNewPage", { defaultValue: "Start on a new page" }),
              active: false,
              enterIndex: 4,
              onPress: startOnNewPage,
            })
          : null}
      </>
    ) : (
      <></>
    );

  // Resolve the toolset for the current block kind + form.
  const compactTools = isChrome
    ? chromeTools
    : isImage
      ? imagePillTools
      : isTable
        ? tableTools
        : isMinimal
          ? minimalTools
          : bubbleKind === "heading"
            ? headingPillTools
            : pillTools;
  const expandedTools = isChrome
    ? chromeTools
    : isImage
      ? imageFullTools
      : isTable
        ? tableTools
        : isMinimal
          ? minimalTools
          : fullTools;

  // A header/footer band already has its OWN dedicated ✦ (opens the smart, section-
  // grounded generate panel) — the generic pinned Ask-AI would be a second, redundant
  // sparkle button right next to it. Hide it for exactly those two bands; every other
  // kind (text/heading/table/image/section-break/…) keeps it.
  const isHfBand = chrome?.kind === "top" || chrome?.kind === "bottom";
  const AskAI = isHfBand ? null : (
    <Pressable
      onPress={onAskAI}
      accessibilityRole="button"
      accessibilityLabel={t("blockBar.askAi", { defaultValue: "Ask AI" })}
      style={[styles.askBtn, { backgroundColor: colors.brandPrimary }]}
    >
      <AskAIGlow trigger={selectedIndices.join(",")} color={colors.brandPrimary} />
      <Sparkles size={18} color={colors.bgPrimary} strokeWidth={2.2} />
    </Pressable>
  );

  // Open the Thesis Structure navigator — the root push-drawer (same target as the
  // header ⋯ → Outline). The drawer dismisses the keyboard itself on open.
  const openOutline = () => {
    Keyboard.dismiss();
    useNavDrawerStore.getState().openDrawer();
  };

  // Pinned beside ✦ Ask AI so the outline is always one tap away (never scrolled
  // off with the formatting tools).
  const OutlineBtn = (
    <Pressable
      onPress={openOutline}
      accessibilityRole="button"
      accessibilityLabel={t("workspace.outline", { defaultValue: "Outline" })}
      style={[styles.pinnedChip, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
    >
      <ListTree size={18} color={colors.textPrimary} strokeWidth={2} />
    </Pressable>
  );

  // Interactive crop for the selected figure. Self-contained <Modal> (portals to
  // root) so it renders correctly from either pill/bar form. On commit it uploads
  // via replaceThesisBlockImage and we revalidate the doc store to repaint.
  const cropModal = (
    <PictureCropModal
      thesisId={thesisId}
      blockIndex={cropIndex}
      onClose={() => setCropIndex(null)}
      onDone={() => void useThesisDocStore.getState().revalidate(thesisId)}
    />
  );

  // ── Category expansion options row ──
  const optPill = (active: boolean, disabled?: boolean) => [
    styles.optPill,
    { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
    active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
    disabled && styles.chipDim,
  ];

  const alignLabel: Record<Align, string> = {
    left: t("blockBar.alignLeft", { defaultValue: "Left" }),
    center: t("blockBar.alignCenter", { defaultValue: "Center" }),
    right: t("blockBar.alignRight", { defaultValue: "Right" }),
    justify: t("blockBar.alignJustify", { defaultValue: "Justify" }),
  };

  const directionLabel: Record<"rtl" | "ltr", string> = {
    rtl: t("blockBar.dirRtl", { defaultValue: "Right to left" }),
    ltr: t("blockBar.dirLtr", { defaultValue: "Left to right" }),
  };

  const renderExpansion = () => {
    if (!activeCategory) return null;
    // Category chips are kind-specific: table categories (Rows/Columns/Layout)
    // only apply to a table, the paragraph categories only to text/headings. Skip
    // rendering a stale category that lingered across a block-kind change.
    const isTableCat =
      activeCategory === "tblRows" || activeCategory === "tblCols" || activeCategory === "tblLayout" ||
      activeCategory === "tblShade" || activeCategory === "tblBorders";
    if (isTableCat !== isTable) return null;
    if ((activeCategory === "hfAI" || activeCategory === "hfLink" || activeCategory === "hfAdd") && !isChrome) return null;
    let body: React.ReactNode = null;
    // A table sub-pill option chip (icon-only, same look as the align/style opts).
    const tblOpt = (
      key: string,
      Icon: LucideIcon,
      label: string,
      enterIndex: number,
      onPress: () => void,
      opts?: { active?: boolean; disabled?: boolean },
    ) => (
      <AnimatedChip
        key={key}
        enterIndex={enterIndex}
        onPress={onPress}
        disabled={opts?.disabled}
        active={opts?.active}
        accessibilityLabel={label}
        style={optPill(!!opts?.active, !!opts?.disabled)}
      >
        <Icon
          size={16}
          color={opts?.active ? colors.bgPrimary : opts?.disabled ? colors.textPlaceholder : colors.textPrimary}
          strokeWidth={2}
        />
      </AnimatedChip>
    );
    if (activeCategory === "hfAdd") {
      // Add-a-part sub-pill: plain-language actions, only for the parts the section
      // lacks. Each creates the band (setHeaderText / setFooter) and selects it.
      const addOpt = (key: string, label: string, enterIndex: number, onPress: () => void) => (
        <AnimatedChip
          key={key}
          enterIndex={enterIndex}
          onPress={onPress}
          accessibilityLabel={label}
          style={optPill(false)}
        >
          <Text numberOfLines={1} style={[styles.optText, { color: colors.textPrimary }]}>
            {label}
          </Text>
        </AnimatedChip>
      );
      body = (
        <>
          {!chrome?.hasHeader ? addOpt("add-hdr", t("workspace.hf.addHeader", { defaultValue: "Add header" }), 0, addHeader) : null}
          {!chrome?.hasFooter ? addOpt("add-ftr", t("workspace.hf.addFooter", { defaultValue: "Add footer" }), 1, addFooter) : null}
        </>
      );
    } else if (activeCategory === "hfLink") {
      // Section-break link sub-pill: two plain-language choices instead of a cryptic
      // link icon. The active one reflects the section's current state; tapping the
      // other links/unlinks its running header + footer with the previous section.
      const linked = !!chrome?.linkedToPrevious;
      const linkOpt = (key: string, label: string, active: boolean, enterIndex: number, onPress: () => void) => (
        <AnimatedChip
          key={key}
          enterIndex={enterIndex}
          onPress={onPress}
          active={active}
          accessibilityLabel={label}
          style={optPill(active)}
        >
          <Text numberOfLines={1} style={[styles.optText, { color: active ? colors.bgPrimary : colors.textPrimary }]}>
            {label}
          </Text>
        </AnimatedChip>
      );
      body = (
        <>
          {linkOpt("lk-on", t("workspace.hf.linkToPrevious", { defaultValue: "Same as previous section" }), linked, 0, () => setLinkedToPrev(true))}
          {linkOpt("lk-off", t("workspace.hf.unlinkFromPrevious", { defaultValue: "Give this section its own" }), !linked, 1, () => setLinkedToPrev(false))}
        </>
      );
    } else if (activeCategory === "hfAI") {
      // The single ✦ panel: instruction input → thinking → a FAITHFUL compiled
      // preview (segments/fields/tables, not flat text) with approve/reject — applied
      // via chromeOp({op:"applyModel"}). A nested, collapsed-by-default "or choose a
      // template" list stays one tap away for a direct pick (applyTemplate), so
      // browsing the university's Studio templates never needs its own top-level chip.
      const sug = chrome && chromeSug && chromeSug.index === chrome.index ? chromeSug : null;
      const busy = sug?.status === "loading";
      const ready = sug?.status === "ready";
      const errored = sug?.status === "error";
      // Live token estimate for the busy label below (see lib/thinking.ts's
      // estimateTokenCount) — an approximation, not the provider's actual
      // billed usage.
      const busyTokenCount = sug?.reasoning ? estimateTokenCount(sug.reasoning) : 0;
      const busyTokenSuffix =
        busyTokenCount > 0
          ? ` · ${t("chat.tokenCount", { count: busyTokenCount, defaultValue: `${busyTokenCount} tokens` })}`
          : "";
      const zoneLabel = tplRegion === "footer"
        ? t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" })
        : t("workspace.hf.topOfPage", { defaultValue: "Top of every page" });
      // The preview lines render in DOCUMENT direction (they show real doc content —
      // a right/left header genuinely reads right-to-left in an Arabic thesis); every
      // other element in this panel (input, buttons, template list) is app chrome and
      // uses `appRtl` instead.
      const renderLine = (line: HfPreviewLine, li: number, values?: Record<string, string>) => (
        <View key={li} style={{ flexDirection: rtl ? "row-reverse" : "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          {line.map((slot, si) => (
            <Text
              key={si}
              numberOfLines={1}
              style={{
                flex: line.length > 1 ? 1 : undefined,
                fontSize: 11.5,
                color: colors.textPrimary,
                textAlign: si === 0 ? (rtl ? "right" : "left") : si === line.length - 1 ? (rtl ? "left" : "right") : "center",
              }}
            >
              {slot.map((s) => segText(s, values)).join(" ") || " "}
            </Text>
          ))}
        </View>
      );
      const proposedLines: HfPreviewLine[] = (tplRegion === "footer" ? sug?.preview?.footer : sug?.preview?.header) ?? [];
      const templatePicker = (
        <View style={{ gap: 6 }}>
          <Pressable onPress={toggleTemplates} accessibilityRole="button" style={{ flexDirection: appRtl ? "row-reverse" : "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
            <LayoutTemplate size={13} color={colors.textSecondary} strokeWidth={2} />
            <Text style={{ fontSize: 11.5, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>
              {t("workspace.hf.orChooseTemplate", { defaultValue: "Or choose a template" })}
            </Text>
            {showTemplates
              ? <ChevronUp size={13} color={colors.textPlaceholder} strokeWidth={2} />
              : <ChevronDown size={13} color={colors.textPlaceholder} strokeWidth={2} />}
          </Pressable>
          {showTemplates ? (
            <View style={{ width: expWidth > 24 ? expWidth - 12 : undefined, minWidth: 260 }}>
              {tplStatus === "loading" ? (
                <View style={{ flexDirection: appRtl ? "row-reverse" : "row", alignItems: "center", gap: 8, minHeight: 42 }}>
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                  <Text style={{ fontSize: 12.5, color: colors.textSecondary }}>{t("common.loading", { defaultValue: "Loading…" })}</Text>
                </View>
              ) : tplStatus === "error" ? (
                <Pressable onPress={() => void loadTemplates()} accessibilityRole="button" style={{ minHeight: 42, justifyContent: "center" }}>
                  <Text style={{ fontSize: 12.5, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>
                    {t("workspace.hf.templatesError", { defaultValue: "Couldn't load templates — tap to retry" })}
                  </Text>
                </Pressable>
              ) : tplList.length === 0 ? (
                <View style={{ minHeight: 42, justifyContent: "center" }}>
                  <Text style={{ fontSize: 12.5, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>
                    {t("workspace.hf.templatesEmpty", { defaultValue: "No templates yet" })}
                  </Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 264 }} nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                  {tplList.map((tpl) => {
                    const open = expandedTplId === tpl.id;
                    const applying = applyingTplId === tpl.id;
                    const caption = [tpl.university, tpl.language ? tpl.language.toUpperCase() : ""].filter(Boolean).join(" · ");
                    const lines: HfPreviewLine[] = (tplRegion === "footer" ? tpl.preview?.footer : tpl.preview?.header) ?? [];
                    const tokens = tpl.tokens ?? [];
                    // Live values feed the preview only for the OPEN row; a collapsed row
                    // previews its raw {tokens}.
                    const previewValues = open ? tokenValues : undefined;
                    return (
                      <View key={tpl.id} style={{ borderWidth: 1, borderColor: open ? colors.brandPrimary : colors.borderDefault, borderRadius: 14, backgroundColor: colors.bgCard, overflow: "hidden" }}>
                        <Pressable
                          onPress={() => { setExpandedTplId(open ? null : tpl.id); setTokenValues({}); }}
                          accessibilityRole="button"
                          style={{ flexDirection: appRtl ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 11 }}
                        >
                          <LayoutTemplate size={16} color={colors.brandPrimary} strokeWidth={2.2} />
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "700", color: colors.textPrimary, textAlign: appRtl ? "right" : "left" }}>{tpl.name}</Text>
                            {caption ? <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>{caption}</Text> : null}
                          </View>
                          {open
                            ? <ChevronUp size={16} color={colors.textPlaceholder} strokeWidth={2.2} />
                            : <ChevronDown size={16} color={colors.textPlaceholder} strokeWidth={2.2} />}
                        </Pressable>
                        {open ? (
                          <View style={{ paddingHorizontal: 11, paddingBottom: 11, gap: 9 }}>
                            <View style={{ borderWidth: 1, borderColor: colors.borderDefault, borderRadius: 10, backgroundColor: colors.bgPrimary, padding: 10, gap: 6 }}>
                              <Text style={{ fontSize: 9.5, letterSpacing: 0.5, fontWeight: "700", textTransform: "uppercase", color: colors.textPlaceholder, textAlign: appRtl ? "right" : "left" }}>{zoneLabel}</Text>
                              {lines.length ? (
                                <>
                                  {lines.map((l, i) => renderLine(l, i, previewValues))}
                                  {tplRegion === "header" ? <View style={{ height: 1.5, backgroundColor: "#9A5A31", opacity: 0.5, borderRadius: 2, marginTop: 2 }} /> : null}
                                </>
                              ) : (
                                <Text style={{ fontSize: 11, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>{t("workspace.hf.previewNone", { defaultValue: "No preview" })}</Text>
                              )}
                            </View>
                            {/* Fill form — one input per {token}. The student's values feed the
                                live preview above and are sent on Apply. */}
                            {tokens.length ? (
                              <View style={{ gap: 7 }}>
                                <Text style={{ fontSize: 11, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>
                                  {t("workspace.hf.fillTokens", { defaultValue: "Fill in the details" })}
                                </Text>
                                {tokens.map((tok) => (
                                  <View key={tok} style={{ gap: 3 }}>
                                    <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.textPlaceholder, textAlign: appRtl ? "right" : "left" }}>{humanizeToken(tok)}</Text>
                                    <TextInput
                                      value={tokenValues[tok] ?? ""}
                                      onChangeText={(v) => setTokenValues((cur) => ({ ...cur, [tok]: v }))}
                                      placeholder={`{${tok}}`}
                                      placeholderTextColor={colors.textPlaceholder}
                                      style={{ height: 36, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, fontSize: 13, color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgPrimary, textAlign: appRtl ? "right" : "left" }}
                                    />
                                  </View>
                                ))}
                              </View>
                            ) : null}
                            <Pressable
                              onPress={() => applyHfTemplate(tpl.id, tokens.length ? tokenValues : undefined)}
                              disabled={!!applyingTplId}
                              accessibilityRole="button"
                              accessibilityLabel={t("workspace.hf.applyTemplate", { defaultValue: "Apply {{name}}", name: tpl.name })}
                              style={{ flexDirection: appRtl ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.brandPrimary, opacity: applyingTplId && !applying ? 0.6 : 1 }}
                            >
                              {applying ? <ActivityIndicator size="small" color={colors.bgPrimary} /> : <Check size={16} color={colors.bgPrimary} strokeWidth={2.4} />}
                              <Text style={{ color: colors.bgPrimary, fontSize: 12.5, fontWeight: "700" }}>{t("workspace.hf.apply", { defaultValue: "Apply" })}</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          ) : null}
        </View>
      );
      body = (
        <View style={{ flexDirection: "column", gap: 10, flex: 1, minWidth: 240, alignItems: "stretch" }}>
          {ready ? (
            <>
              <View style={{ borderWidth: 1, borderColor: colors.borderDefault, borderRadius: 10, backgroundColor: colors.bgCard, padding: 10, gap: 6 }}>
                <Text style={{ fontSize: 9.5, letterSpacing: 0.5, fontWeight: "700", textTransform: "uppercase", color: colors.textPlaceholder, textAlign: appRtl ? "right" : "left" }}>{zoneLabel}</Text>
                {proposedLines.length ? (
                  <>
                    {proposedLines.map((l, i) => renderLine(l, i))}
                    {tplRegion === "header" ? <View style={{ height: 1.5, backgroundColor: "#9A5A31", opacity: 0.5, borderRadius: 2, marginTop: 2 }} /> : null}
                  </>
                ) : (
                  <Text style={{ fontSize: 11, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>{t("workspace.hf.previewNone", { defaultValue: "No preview" })}</Text>
                )}
              </View>
              <View style={{ flexDirection: appRtl ? "row-reverse" : "row", gap: 8 }}>
                <Pressable onPress={approveChromeSug} accessibilityRole="button" accessibilityLabel={t("common.approve", { defaultValue: "Approve" })} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.brandPrimary }}>
                  <Check size={16} color={colors.bgPrimary} strokeWidth={2.4} />
                  <Text style={{ color: colors.bgPrimary, fontSize: 12, fontWeight: "700" }}>{t("common.approve", { defaultValue: "Approve" })}</Text>
                </Pressable>
                <Pressable onPress={rejectChromeSug} accessibilityRole="button" accessibilityLabel={t("common.reject", { defaultValue: "Dismiss" })} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.borderDefault }}>
                  <X size={16} color={colors.textPrimary} strokeWidth={2.2} />
                  <Text style={{ color: colors.textPrimary, fontSize: 12, fontWeight: "700" }}>{t("common.reject", { defaultValue: "Dismiss" })}</Text>
                </Pressable>
              </View>
            </>
          ) : busy ? (
            <View style={{ flexDirection: appRtl ? "row-reverse" : "row", alignItems: "center", gap: 8, minHeight: 38 }}>
              <Sparkles size={15} color={colors.brandPrimary} strokeWidth={2.2} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: colors.textSecondary, textAlign: appRtl ? "right" : "left" }}>
                {t("suggestion.thinking", { defaultValue: "Thinking…" })}
                {busyTokenSuffix}
              </Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: appRtl ? "row-reverse" : "row", alignItems: "center", gap: 8 }}>
                <TextInput
                  value={aiText}
                  onChangeText={setAiText}
                  placeholder={errored ? t("suggestion.noneRetry", { defaultValue: "No suggestion — try again" }) : t("workspace.hf.aiPlaceholder", { defaultValue: "Ask AI to change this…" })}
                  placeholderTextColor={colors.textPlaceholder}
                  autoFocus
                  returnKeyType="send"
                  onSubmitEditing={submitChromeAi}
                  style={{ flex: 1, minWidth: 150, height: 38, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14, color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgCard, textAlign: appRtl ? "right" : "left" }}
                />
                <Pressable onPress={submitChromeAi} accessibilityRole="button" accessibilityLabel={t("workspace.hf.aiEdit", { defaultValue: "Ask AI to change" })} style={{ width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary }}>
                  <Send size={17} color={colors.bgPrimary} strokeWidth={2.2} style={appRtl ? { transform: [{ scaleX: -1 }] } : undefined} />
                </Pressable>
              </View>
              {templatePicker}
            </>
          )}
        </View>
      );
    } else if (activeCategory === "style") {
      const levels = rtl ? [...styleLevels].reverse() : styleLevels;
      body = levels.map((l, i) => {
        const active = allLevel(l);
        const enterIndex = rtl ? styleLevels.length - 1 - i : i;
        return (
          <AnimatedChip
            key={l}
            enterIndex={enterIndex}
            onPress={() => apply({ level: l })}
            disabled={!canFormat}
            active={active}
            accessibilityLabel={l === 0 ? t("composer.edit.normal", { defaultValue: "Normal" }) : `H${l}`}
            style={optPill(active, !canFormat)}
          >
            <Text style={[styles.optText, { color: active ? colors.bgPrimary : colors.textPrimary }]}>
              {l === 0 ? t("composer.edit.normal", { defaultValue: "Normal" }) : `H${l}`}
            </Text>
          </AnimatedChip>
        );
      });
    } else if (activeCategory === "align") {
      body = ALIGN_OPTIONS.map(({ value, Icon }, i) => {
        const active = allAlign(value);
        return (
          <AnimatedChip
            key={value}
            enterIndex={i}
            onPress={() => apply({ alignment: value })}
            disabled={!canFormat}
            active={active}
            accessibilityLabel={alignLabel[value]}
            style={optPill(active, !canFormat)}
          >
            <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
          </AnimatedChip>
        );
      });
    } else if (activeCategory === "direction") {
      body = DIRECTION_OPTIONS.map(({ value, Icon }, i) => {
        const active = allDirection(value);
        return (
          <AnimatedChip
            key={value}
            enterIndex={i}
            onPress={() => apply({ direction: value })}
            disabled={!canFormat}
            active={active}
            accessibilityLabel={directionLabel[value]}
            style={optPill(active, !canFormat)}
          >
            <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
          </AnimatedChip>
        );
      });
    } else if (activeCategory === "color") {
      // Text colour swatches → each dispatches format({ color }); a trailing eraser
      // sends color:null (clear). Active = every selected run already that colour.
      body = (
        <>
          {TEXT_COLORS.map((hex, i) => {
            const active = colorActive(hex);
            return (
              <AnimatedChip
                key={hex}
                enterIndex={i}
                onPress={() => apply({ color: hex })}
                disabled={!canFormat}
                active={active}
                accessibilityLabel={t("blockBar.colorSwatch", { defaultValue: `Color #${hex}`, hex })}
                style={optPill(false, !canFormat)}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: `#${hex}`, borderColor: colors.borderDefault },
                    active && { borderColor: colors.brandPrimary, borderWidth: 2 },
                  ]}
                />
              </AnimatedChip>
            );
          })}
          <AnimatedChip
            key="color-clear"
            enterIndex={TEXT_COLORS.length}
            onPress={() => apply({ color: null })}
            disabled={!canFormat}
            accessibilityLabel={t("blockBar.colorClear", { defaultValue: "Clear color" })}
            style={optPill(false, !canFormat)}
          >
            <Eraser size={16} color={colors.textPrimary} strokeWidth={2} />
          </AnimatedChip>
        </>
      );
    } else if (activeCategory === "tblRows") {
      // Rows sub-pill: exact inserts (above row 0 / bottom) + delete a SPECIFIC
      // row: the delete chip opens numbered chips (1..N) — tap one to delete it.
      const numChip = (i: number, onPress: () => void) => (
        <AnimatedChip
          key={`n${i}`}
          enterIndex={i + 1}
          onPress={onPress}
          accessibilityLabel={String(i + 1)}
          style={optPill(false)}
        >
          <Text style={[styles.optText, { color: colors.textPrimary }]}>{i + 1}</Text>
        </AnimatedChip>
      );
      body =
        delPick === "row" ? (
          <>
            {tblOpt("tr-back", X, t("common.cancel", { defaultValue: "Cancel" }), 0, () => setDelPick(null))}
            {Array.from({ length: Math.min(tableRows, 20) }, (_, i) =>
              numChip(i, () => { setDelPick(null); void tableEdit({ action: "deleteRow", row: i }); }),
            )}
          </>
        ) : (
          <>
            {tblOpt("tr-top", ArrowUpToLine, t("blockBar.rowAbove", { defaultValue: "Insert row at top" }), 0, () => void tableEdit({ action: "addRow", at: 0, before: true }))}
            {tblOpt("tr-bot", ArrowDownToLine, t("blockBar.rowBelow", { defaultValue: "Add row at bottom" }), 1, () => void tableEdit({ action: "addRow" }))}
            {tblOpt("tr-dist", AlignVerticalSpaceAround, t("blockBar.distributeRows", { defaultValue: "Equalize row heights" }), 2, () => void tableEdit({ action: "layout", opts: { distributeRows: true } }))}
            {tblOpt("tr-del", Trash2, t("blockBar.deleteRowPick", { defaultValue: "Delete a row…" }), 3, () => setDelPick("row"), { disabled: tableRows <= 1 })}
          </>
        );
    } else if (activeCategory === "tblCols") {
      // Columns sub-pill: exact inserts (left of col 0 / right end) + delete a
      // SPECIFIC column via the numbered picker.
      const numChip = (i: number, onPress: () => void) => (
        <AnimatedChip
          key={`n${i}`}
          enterIndex={i + 1}
          onPress={onPress}
          accessibilityLabel={String(i + 1)}
          style={optPill(false)}
        >
          <Text style={[styles.optText, { color: colors.textPrimary }]}>{i + 1}</Text>
        </AnimatedChip>
      );
      body =
        delPick === "col" ? (
          <>
            {tblOpt("tc-back", X, t("common.cancel", { defaultValue: "Cancel" }), 0, () => setDelPick(null))}
            {Array.from({ length: Math.min(tableCols, 20) }, (_, i) =>
              numChip(i, () => { setDelPick(null); void tableEdit({ action: "deleteColumn", col: i }); }),
            )}
          </>
        ) : (
          <>
            {tblOpt("tc-left", ArrowLeftToLine, t("blockBar.colLeft", { defaultValue: "Insert column at left" }), 0, () => void tableEdit({ action: "addColumn", at: 0, before: true }))}
            {tblOpt("tc-right", ArrowRightToLine, t("blockBar.colRight", { defaultValue: "Add column at right" }), 1, () => void tableEdit({ action: "addColumn" }))}
            {tblOpt("tc-dist", AlignHorizontalSpaceAround, t("blockBar.distributeCols", { defaultValue: "Equalize column widths" }), 2, () => void tableEdit({ action: "layout", opts: { distributeColumns: true } }))}
            {tblOpt("tc-del", Trash2, t("blockBar.deleteColumnPick", { defaultValue: "Delete a column…" }), 3, () => setDelPick("col"), { disabled: tableCols <= 1 })}
          </>
        );
    } else if (activeCategory === "tblShade") {
      // Shading sub-pill — manual parity with the AI's coloring: header fill
      // swatches, zebra striping (alternating data rows), header text
      // white/black. All through the silent tableOp path.
      const zebra = () => {
        const fills = Array.from({ length: tableRows }, (_, r) =>
          Array.from({ length: tableCols }, () => (r > 0 && r % 2 === 1 ? ZEBRA_FILL : null)),
        );
        void tableEdit({ action: "shade", fills });
      };
      const headerText = (hex: string) => {
        const textColors = [Array.from({ length: tableCols }, () => hex)];
        void tableEdit({ action: "shade", textColors });
      };
      body = (
        <>
          {TABLE_FILLS.map((hex, i) => (
            <AnimatedChip
              key={`tf${hex}`}
              enterIndex={i}
              onPress={() => void tableEdit({ action: "layout", opts: { headerFill: hex } })}
              accessibilityLabel={t("blockBar.headerFill", { defaultValue: `Header color #${hex}`, hex })}
              style={optPill(false)}
            >
              <View style={[styles.swatch, { backgroundColor: `#${hex}`, borderColor: colors.borderDefault }]} />
            </AnimatedChip>
          ))}
          {tblOpt("ts-zebra", Rows3, t("blockBar.zebra", { defaultValue: "Zebra rows" }), TABLE_FILLS.length, zebra)}
          <AnimatedChip
            key="ts-txt-w"
            enterIndex={TABLE_FILLS.length + 1}
            onPress={() => headerText("FFFFFF")}
            accessibilityLabel={t("blockBar.headerTextWhite", { defaultValue: "White header text" })}
            style={optPill(false)}
          >
            <Text style={[styles.optText, { color: colors.textPrimary }]}>A</Text>
          </AnimatedChip>
          <AnimatedChip
            key="ts-txt-b"
            enterIndex={TABLE_FILLS.length + 2}
            onPress={() => headerText("000000")}
            accessibilityLabel={t("blockBar.headerTextBlack", { defaultValue: "Black header text" })}
            style={optPill(false)}
          >
            <Text style={[styles.optText, { color: colors.textPlaceholder }]}>A</Text>
          </AnimatedChip>
        </>
      );
    } else if (activeCategory === "tblBorders") {
      // Borders sub-pill: style × width × color combine; every tap applies the
      // combined config to ALL sides immediately. Trailing "none" removes borders.
      const applyBorders = (style = bStyle, sizePt = bSizePt, color = bColor) =>
        void tableEdit({ action: "layout", opts: { borders: { style, sizePt, color } } });
      body = (
        <>
          {BORDER_STYLES.map(({ key, glyph }, i) => (
            <AnimatedChip
              key={`bs-${key}`}
              enterIndex={i}
              onPress={() => { setBStyle(key); applyBorders(key); }}
              active={bStyle === key}
              accessibilityLabel={t(`blockBar.borderStyle.${key}`, { defaultValue: `${key} border` })}
              style={optPill(bStyle === key)}
            >
              <Text style={[styles.optText, { color: bStyle === key ? colors.bgPrimary : colors.textPrimary }]}>{glyph}</Text>
            </AnimatedChip>
          ))}
          {BORDER_WIDTHS.map(({ pt, label }, i) => (
            <AnimatedChip
              key={`bw-${pt}`}
              enterIndex={BORDER_STYLES.length + i}
              onPress={() => { setBSizePt(pt); applyBorders(undefined, pt); }}
              active={bSizePt === pt}
              accessibilityLabel={t("blockBar.borderWidth", { defaultValue: `${label}pt border`, label })}
              style={optPill(bSizePt === pt)}
            >
              <Text style={[styles.optText, { color: bSizePt === pt ? colors.bgPrimary : colors.textPrimary }]}>{label}</Text>
            </AnimatedChip>
          ))}
          {BORDER_COLORS.map((hex, i) => (
            <AnimatedChip
              key={`bc-${hex}`}
              enterIndex={BORDER_STYLES.length + BORDER_WIDTHS.length + i}
              onPress={() => { setBColor(hex); applyBorders(undefined, undefined, hex); }}
              active={bColor === hex}
              accessibilityLabel={t("blockBar.borderColor", { defaultValue: `Border color #${hex}`, hex })}
              style={optPill(false)}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: `#${hex}`, borderColor: colors.borderDefault },
                  bColor === hex && { borderColor: colors.brandPrimary, borderWidth: 2 },
                ]}
              />
            </AnimatedChip>
          ))}
          {tblOpt(
            "bd-none",
            Square,
            t("blockBar.bordersOff", { defaultValue: "No borders" }),
            BORDER_STYLES.length + BORDER_WIDTHS.length + BORDER_COLORS.length,
            () => void tableEdit({ action: "layout", opts: { borders: false } }),
          )}
        </>
      );
    } else if (activeCategory === "tblLayout") {
      // Layout sub-pill: header row, table alignment, text direction, borders.
      body = (
        <>
          {tblOpt("tl-header", PanelTop, t("blockBar.headerRow", { defaultValue: "Header row" }), 0, () => void tableEdit({ action: "layout", opts: { headerRow: true } }), { active: tableHeader })}
          {tblOpt("tl-al", AlignLeft, t("blockBar.alignLeft", { defaultValue: "Left" }), 1, () => void tableEdit({ action: "layout", opts: { alignment: "left" } }), { active: tableAlign === "left" })}
          {tblOpt("tl-ac", AlignCenter, t("blockBar.alignCenter", { defaultValue: "Center" }), 2, () => void tableEdit({ action: "layout", opts: { alignment: "center" } }), { active: tableAlign === "center" })}
          {tblOpt("tl-ar", AlignRight, t("blockBar.alignRight", { defaultValue: "Right" }), 3, () => void tableEdit({ action: "layout", opts: { alignment: "right" } }), { active: tableAlign === "right" })}
          {tblOpt("tl-rtl", PilcrowLeft, t("blockBar.dirRtl", { defaultValue: "Right to left" }), 4, () => void tableEdit({ action: "layout", opts: { direction: "rtl" } }), { active: tableDirection === "rtl" })}
          {tblOpt("tl-ltr", PilcrowRight, t("blockBar.dirLtr", { defaultValue: "Left to right" }), 5, () => void tableEdit({ action: "layout", opts: { direction: "ltr" } }), { active: tableDirection === "ltr" })}
          {tblOpt("tl-fit", StretchHorizontal, t("blockBar.fitPageWidth", { defaultValue: "Fit page width" }), 6, () => void tableEdit({ action: "layout", opts: { widthPct: 100 } }))}
        </>
      );
    } else if (lexActive) {
      // list — LIVE in the Lexical Writer: Bulleted / Numbered toggle the current
      // block into/out of a list. (Bullets render + edit; full persistence across
      // reload still needs server list-style support.) Checklist stays coming-soon.
      const isBullet = lexFmt.blockType === "bullet";
      const isNumber = lexFmt.blockType === "number";
      const applyList = (v: "ul" | "ol" | "none") => useLexicalEditorStore.getState().dispatch("list", v);
      body = (
        <>
          <AnimatedChip
            key="ul"
            enterIndex={0}
            onPress={() => applyList(isBullet ? "none" : "ul")}
            active={isBullet}
            accessibilityLabel={t("blockBar.listBulleted", { defaultValue: "Bulleted list" })}
            style={optPill(isBullet)}
          >
            <Text style={[styles.optText, { color: isBullet ? colors.bgPrimary : colors.textPrimary }]}>•</Text>
          </AnimatedChip>
          <AnimatedChip
            key="ol"
            enterIndex={1}
            onPress={() => applyList(isNumber ? "none" : "ol")}
            active={isNumber}
            accessibilityLabel={t("blockBar.listNumbered", { defaultValue: "Numbered list" })}
            style={optPill(isNumber)}
          >
            <Text style={[styles.optText, { color: isNumber ? colors.bgPrimary : colors.textPrimary }]}>1.</Text>
          </AnimatedChip>
          <AnimatedChip key="check" enterIndex={2} onPress={soon} accessibilityLabel={t("blockBar.listCheck", { defaultValue: "Checklist" })} style={optPill(false, true)}>
            <Text style={[styles.optText, { color: colors.textPlaceholder }]}>☑</Text>
          </AnimatedChip>
        </>
      );
    } else {
      // list — Phase 2 in the legacy block-model path (DTO can't carry it): dimmed.
      const items = ["•", "1.", "☑"];
      const phLabels = [
        t("blockBar.listBulleted", { defaultValue: "Bulleted list" }),
        t("blockBar.listNumbered", { defaultValue: "Numbered list" }),
        t("blockBar.listCheck", { defaultValue: "Checklist" }),
      ];
      body = (
        <>
          {items.map((label, i) => (
            <AnimatedChip key={i} enterIndex={i} onPress={soon} accessibilityLabel={phLabels[i]} style={optPill(false, true)}>
              <Text style={[styles.optText, { color: colors.textPlaceholder }]}>{label}</Text>
            </AnimatedChip>
          ))}
          <Text style={[styles.soonCaption, { color: colors.textPlaceholder }]}>
            {t("blockBar.soonTitle", { defaultValue: "Coming soon" })}
          </Text>
        </>
      );
    }
    return (
      <Animated.View
        key={"exp-" + activeCategory}
        entering={rowIn}
        exiting={rowOutUnlessHandoff}
        onLayout={(e) => setExpWidth(e.nativeEvent.layout.width)}
        style={[styles.expansion, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.expansionRow, { flexDirection: rtl ? "row-reverse" : "row" }]}
        >
          {body}
        </ScrollView>
      </Animated.View>
    );
  };

  // ── Layout: floating pill (morphs to full card) vs full-width docked bar ──
  if (keyboardOpen) {
    // Docked on the keyboard: instant swap BY DESIGN — animating it fights the OS
    // keyboard animation and timing differs iOS vs Android (see animations spec).
    return (
      <View
        style={[
          styles.fullWrap,
          { backgroundColor: colors.bgPrimary, borderTopColor: colors.borderSubtle, paddingBottom: 6 },
        ]}
      >
        {/* Must stay the FIRST child in both layout branches — the same tree position
            keeps the expansion row mounted across pill/bar form switches (no spurious
            re-entering). */}
        {renderExpansion()}
        <View style={[styles.fullRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            style={styles.fullScroll}
            ref={toolsScrollRef}
            contentContainerStyle={[styles.fullTools, { flexDirection: rtl ? "row-reverse" : "row" }]}
          >
            <Animated.View
              key={"dock-" + toolsetKind}
              exiting={chipOut}
              style={[styles.toolsRowInner, { flexDirection: rtl ? "row-reverse" : "row" }]}
            >
              {expandedTools}
            </Animated.View>
          </ScrollView>
          {AskAI}
          {OutlineBtn}
        </View>
        {saving ? <PulsingDot color={colors.brandPrimary} /> : null}
        {cropModal}
      </View>
    );
  }

  // Keyboard closed: ONE container that morphs pill ⇄ full card (layoutSpring),
  // springs in on block-select (pillIn), drops away on deselect, and repositions
  // instantly on block→block moves (pillOutUnlessHandoff + the handoff gate).
  return (
    <View style={styles.pillWrap} pointerEvents="box-none">
      {/* Must stay the FIRST child in both layout branches — the same tree position
          keeps the expansion row mounted across pill/bar form switches (no spurious
          re-entering). */}
      {renderExpansion()}
      <Animated.View
        // Block→block selection handoff: skip entrance/exit so the pill MOVES to
        // the new block instead of hiding and reappearing (user request).
        entering={isPillHandoff() ? undefined : pillIn}
        exiting={pillOutUnlessHandoff}
        layout={layoutSpring}
        style={
          pillExpanded
            ? [styles.fullCard, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]
            : [
                styles.pill,
                {
                  backgroundColor: colors.bgPrimary,
                  borderColor: colors.borderSubtle,
                  flexDirection: rtl ? "row-reverse" : "row",
                },
              ]
        }
      >
        {pillExpanded ? (
          <View style={[styles.fullRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              style={styles.fullScroll}
              ref={toolsScrollRef}
              contentContainerStyle={[styles.fullTools, { flexDirection: rtl ? "row-reverse" : "row" }]}
            >
              <Animated.View
                key={"full-" + toolsetKind}
                exiting={chipOut}
                style={[styles.toolsRowInner, { flexDirection: rtl ? "row-reverse" : "row" }]}
              >
                {expandedTools}
              </Animated.View>
              {/* Static collapse control — outside the keyed row so toolset morphs don't tear it down. */}
              {chip({ keyProp: "collapse", Icon: X, accessibilityLabel: t("common.close", { defaultValue: "Close" }), enterIndex: 13, onPress: () => setPillExpanded(false) })}
            </ScrollView>
            {AskAI}
            {OutlineBtn}
          </View>
        ) : (
          <>
            {onCollapse
              ? chip({ keyProp: "collapse-bubble", Icon: ChevronsDownUp, accessibilityLabel: t("blockBar.collapse", { defaultValue: "Collapse" }), onPress: onCollapse })
              : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              style={styles.pillScroll}
              ref={toolsScrollRef}
              contentContainerStyle={[styles.pillToolsRow, { flexDirection: rtl ? "row-reverse" : "row" }]}
            >
              <Animated.View
                key={"tools-" + toolsetKind}
                exiting={chipOut}
                style={[styles.toolsRowInner, { flexDirection: rtl ? "row-reverse" : "row" }]}
              >
                {compactTools}
              </Animated.View>
            </ScrollView>
            <View style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />
            {AskAI}
            {OutlineBtn}
          </>
        )}
        {pillExpanded && saving ? <PulsingDot color={colors.brandPrimary} /> : null}
      </Animated.View>
      {cropModal}
    </View>
  );
}

const styles = StyleSheet.create({
  // Floating pill (anchored under the block; tools scroll, ✦ Ask AI pinned so it never clips).
  pillWrap: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2, alignItems: "center" },
  pill: {
    alignSelf: "center",
    maxWidth: "100%",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  pillScroll: { flexShrink: 1 },
  pillToolsRow: { alignItems: "center", gap: 6 },

  // Full-width docked bar (keyboard open) — sits flush on the keyboard.
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
  // Expanded pill inline (keyboard closed) — the morph target of the compact pill.
  fullCard: {
    alignSelf: "stretch",
    marginTop: 2,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  fullRow: { alignItems: "center", gap: 8 },
  fullScroll: { flex: 1 },
  fullTools: { alignItems: "center", gap: 6, paddingHorizontal: 2 },
  // Keyed morphing tool row inside the ScrollViews (row styles live on the
  // contentContainerStyle; this only lays out the chips within the keyed view).
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
  // Pinned Outline button beside Ask AI — round to pair with it, but bordered/
  // secondary (not brand-filled) so ✦ Ask AI stays the primary action.
  pinnedChip: {
    width: CHIP,
    height: CHIP,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: CHIP / 2,
    borderWidth: 1,
  },

  scopePill: {
    maxWidth: 120,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: "center",
  },
  scopeText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Category expansion options row
  expansion: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 6,
    marginBottom: 8,
    alignSelf: "stretch",
  },
  expansionRow: { alignItems: "center", gap: 6 },
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
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
  soonCaption: { fontSize: 11, fontFamily: "Inter_500Medium", alignSelf: "center", marginLeft: 6 },

  savingDot: { position: "absolute", top: 4, right: 8, width: 6, height: 6, borderRadius: 3 },
});
