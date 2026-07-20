import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
// Horizontal tool rows use gesture-handler's ScrollView so they scroll even when
// nested inside the reorderable list (RN's ScrollView loses the horizontal pan to
// the list's gesture handler).
import { ScrollView } from "react-native-gesture-handler";
import {
  Bold,
  Italic,
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
  X,
  type LucideIcon,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { removeThesisBlockBg, type DocBlockDTO } from "@/lib/api";
import { rotateFlipBlockImage, type RotateFlipOp } from "@/lib/thesis-image-edit";
import { hWarn } from "@/lib/haptics";
import { PictureCropModal } from "./PictureCropModal";
import type { FormatChange } from "@/lib/thesis-ops";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;
type Align = "left" | "center" | "right" | "justify";
type Category = "style" | "align" | "direction" | "list" | "color";

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
}

/**
 * The block-anchored formatting + AI bar. Two forms driven by keyboard state:
 *   • Keyboard closed → a compact floating PILL (Bold/Italic/Align/Direction + (+) + ✦ Ask AI).
 *     (+) expands the full tool set inline.
 *   • Keyboard open → a full-width BAR docked on the keyboard: the complete tool set in a
 *     horizontal scroll with ✦ Ask AI pinned outside it, plus a scope pill.
 * Category tools (Style/Align/Direction/List/Color) expand a contextual options row above
 * the bar; simple tools act immediately. Run-level tools (Bold/Italic) and List/Color are
 * Phase-2 (the DTO can't carry them yet) — shown but marked "coming soon".
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
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const saving = useThesisDocStore((s) => (s.pending[thesisId] ?? 0) > 0);

  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [pillExpanded, setPillExpanded] = useState(false);
  const pickingRef = useRef(false);
  // Advanced picture ops: `busy` guards the async rotate/flip/remove-bg (disables
  // those chips while one runs); `cropIndex` drives the interactive crop modal.
  const [busy, setBusy] = useState(false);
  const [cropIndex, setCropIndex] = useState<number | null>(null);

  const showFull = keyboardOpen || pillExpanded;
  const canFormat = paragraphSelection.length > 0;
  const paraIndices = paragraphSelection.map((b) => b.index);
  const single = paragraphSelection.length === 1 ? paragraphSelection[0] : null;

  // Smart-pill mode: which toolset the sole selection gets. Falls back to the
  // paragraph (text) tools for anything that isn't a single image / table.
  const isImage = selectedBlock?.kind === "image";
  const isTable = selectedBlock?.kind === "table";

  // A generic sole-block anchor (any kind) for move/replace/delete — the old
  // `single` only covered paragraphs, so image/table move needs this.
  const soleIndex = selectedBlock ? selectedBlock.index : null;
  const soleText =
    selectedBlock?.kind === "paragraph"
      ? selectedBlock.text
      : selectedBlock?.kind === "image"
        ? (selectedBlock.caption ?? "")
        : "";

  // ── Wiring (mirrors ComposerEditTools: optimistic + durable format op) ──
  const apply = (changes: FormatChange) => {
    if (!paraIndices.length) return;
    void useThesisDocStore.getState().mutate(thesisId, { type: "format", indices: paraIndices, changes });
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

  const pickImage = async () => {
    if (!single || pickingRef.current) return;
    pickingRef.current = true;
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
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
      type: "insertImage",
      afterIndex: single.index,
      data: asset.base64,
      format,
      width: asset.width,
      height: asset.height,
    });
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

  // Active-state helpers for the expansion options.
  const allLevel = (l: number) => canFormat && paragraphSelection.every((b) => b.level === l);
  const allAlign = (v: Align) => canFormat && paragraphSelection.every((b) => alignFromDoc(b.alignment) === v);
  const allDirection = (v: "rtl" | "ltr") => canFormat && paragraphSelection.every((b) => b.direction === v);

  const toggleCategory = (c: Category) => setActiveCategory((cur) => (cur === c ? null : c));

  // ── Small building blocks ──
  // Plain element-returning helpers (NOT inner components) so they aren't a fresh
  // component type each render (which would remount every chip).
  const chip = (opts: {
    keyProp: string;
    Icon: LucideIcon;
    onPress: () => void;
    active?: boolean;
    disabled?: boolean;
    dim?: boolean;
    accessibilityLabel: string;
  }) => {
    const { Icon } = opts;
    return (
      <Pressable
        key={opts.keyProp}
        onPress={opts.onPress}
        disabled={opts.disabled}
        accessibilityRole="button"
        accessibilityLabel={opts.accessibilityLabel}
        accessibilityState={{ selected: opts.active, disabled: opts.disabled }}
        style={[
          styles.chip,
          { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
          opts.active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
          (opts.disabled || opts.dim) && styles.chipDim,
        ]}
      >
        <Icon size={17} color={opts.active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
      </Pressable>
    );
  };

  const categoryChip = (c: Category, Icon: LucideIcon, label: string) =>
    chip({
      keyProp: "cat-" + c,
      Icon,
      accessibilityLabel: label,
      active: activeCategory === c,
      disabled: (c === "style" || c === "align" || c === "direction") && !canFormat,
      onPress: () => toggleCategory(c),
    });

  const sep = (k: string) => <View key={k} style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />;

  // The complete tool set for the full-width bar / expanded pill.
  const fullTools = (
    <>
      {chip({ keyProp: "bold", Icon: Bold, accessibilityLabel: "Bold", dim: true, onPress: soon })}
      {chip({ keyProp: "italic", Icon: Italic, accessibilityLabel: "Italic", dim: true, onPress: soon })}
      {sep("s1")}
      {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }))}
      {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }))}
      {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }))}
      {categoryChip("list", List, t("blockBar.list", { defaultValue: "List" }))}
      {categoryChip("color", Palette, t("blockBar.color", { defaultValue: "Color" }))}
      {sep("s2")}
      {single
        ? [
            chip({ keyProp: "up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, onPress: () => move("up") }),
            chip({ keyProp: "down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, onPress: () => move("down") }),
            chip({ keyProp: "img", Icon: ImagePlus, accessibilityLabel: t("blockBar.image", { defaultValue: "Insert image" }), onPress: () => void pickImage() }),
          ]
        : null}
      {chip({ keyProp: "clear", Icon: Eraser, accessibilityLabel: t("blockBar.clear", { defaultValue: "Clear formatting" }), disabled: !canFormat, onPress: () => apply({ clearFormatting: true }) })}
      {chip({ keyProp: "del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), onPress: del })}
    </>
  );

  // The curated pill tool set (keyboard closed, not expanded).
  const pillTools = (
    <>
      {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }))}
      {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }))}
      {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }))}
      {chip({ keyProp: "p-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), onPress: () => setPillExpanded(true) })}
    </>
  );

  // ── IMAGE block: image tools are PRIMARY (no Style/Align/Direction) ──
  const imageMoveDeleteChips = [
    chip({ keyProp: "img-up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, onPress: () => move("up") }),
    chip({ keyProp: "img-down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, onPress: () => move("down") }),
    chip({ keyProp: "img-del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), onPress: del }),
  ];
  // Compact pill: Replace / Move up / Move down / Delete / (+).
  const imagePillTools = (
    <>
      {chip({ keyProp: "img-replace", Icon: RefreshCw, accessibilityLabel: t("blockBar.replaceImage", { defaultValue: "Replace image" }), onPress: () => void replaceImage() })}
      {imageMoveDeleteChips}
      {chip({ keyProp: "img-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), onPress: () => setPillExpanded(true) })}
    </>
  );
  // Expanded / keyboard-docked: the same primaries + the advanced picture ops, now
  // fully wired (rotate/flip on-device → durable replaceImage op, crop modal, server
  // remove-bg). Disabled while an async op is running.
  const imageFullTools = (
    <>
      {chip({ keyProp: "img-replace", Icon: RefreshCw, accessibilityLabel: t("blockBar.replaceImage", { defaultValue: "Replace image" }), onPress: () => void replaceImage() })}
      {imageMoveDeleteChips}
      {sep("is1")}
      {chip({ keyProp: "img-rotate", Icon: RotateCw, accessibilityLabel: t("blockBar.rotate", { defaultValue: "Rotate" }), disabled: busy, onPress: () => void rotateFlip("rotateRight") })}
      {chip({ keyProp: "img-flip", Icon: FlipHorizontal2, accessibilityLabel: t("blockBar.flip", { defaultValue: "Flip" }), disabled: busy, onPress: () => void rotateFlip("flipH") })}
      {chip({ keyProp: "img-crop", Icon: Crop, accessibilityLabel: t("blockBar.crop", { defaultValue: "Crop" }), disabled: busy, onPress: () => { if (soleIndex != null) setCropIndex(soleIndex); } })}
      {chip({ keyProp: "img-bg", Icon: WandSparkles, accessibilityLabel: t("blockBar.removeBg", { defaultValue: "Remove background" }), disabled: busy, onPress: () => void removeBg() })}
    </>
  );

  // ── TABLE block: minimal set (Move / Delete). No text/format tools apply. ──
  const tableTools = <>{imageMoveDeleteChips}</>;

  // Resolve the toolset for the current block kind + form.
  const compactTools = isImage ? imagePillTools : isTable ? tableTools : pillTools;
  const expandedTools = isImage ? imageFullTools : isTable ? tableTools : fullTools;

  const AskAI = (
    <Pressable
      onPress={onAskAI}
      accessibilityRole="button"
      accessibilityLabel={t("blockBar.askAi", { defaultValue: "Ask AI" })}
      style={[styles.askBtn, { backgroundColor: colors.brandPrimary }]}
    >
      <Sparkles size={18} color={colors.bgPrimary} strokeWidth={2.2} />
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

  const renderExpansion = () => {
    if (!activeCategory) return null;
    let body: React.ReactNode = null;
    if (activeCategory === "style") {
      body = STYLE_LEVELS.map((l) => {
        const active = allLevel(l);
        return (
          <Pressable key={l} onPress={() => apply({ level: l })} disabled={!canFormat} style={optPill(active, !canFormat)}>
            <Text style={[styles.optText, { color: active ? colors.bgPrimary : colors.textPrimary }]}>
              {l === 0 ? t("composer.edit.normal", { defaultValue: "Normal" }) : `H${l}`}
            </Text>
          </Pressable>
        );
      });
    } else if (activeCategory === "align") {
      body = ALIGN_OPTIONS.map(({ value, Icon }) => {
        const active = allAlign(value);
        return (
          <Pressable key={value} onPress={() => apply({ alignment: value })} disabled={!canFormat} style={optPill(active, !canFormat)}>
            <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
          </Pressable>
        );
      });
    } else if (activeCategory === "direction") {
      body = DIRECTION_OPTIONS.map(({ value, Icon }) => {
        const active = allDirection(value);
        return (
          <Pressable key={value} onPress={() => apply({ direction: value })} disabled={!canFormat} style={optPill(active, !canFormat)}>
            <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
          </Pressable>
        );
      });
    } else {
      // list / color — Phase 2 (DTO can't carry these yet): show the options
      // disabled with a "coming soon" caption so the expansion mechanism is real.
      const items = activeCategory === "list" ? ["•", "1.", "☑"] : ["A", "A", "A"];
      body = (
        <>
          {items.map((label, i) => (
            <Pressable key={i} onPress={soon} style={optPill(false, true)}>
              <Text style={[styles.optText, { color: colors.textPlaceholder }]}>{label}</Text>
            </Pressable>
          ))}
          <Text style={[styles.soonCaption, { color: colors.textPlaceholder }]}>{t("blockBar.soonTitle", { defaultValue: "Coming soon" })}</Text>
        </>
      );
    }
    return (
      <View style={[styles.expansion, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.expansionRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          {body}
        </ScrollView>
      </View>
    );
  };

  // ── Layout: floating pill vs full-width docked bar ──
  if (!showFull) {
    // Compact floating pill (keyboard closed).
    return (
      <View style={styles.pillWrap} pointerEvents="box-none">
        {renderExpansion()}
        <View style={[styles.pill, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle, flexDirection: rtl ? "row-reverse" : "row" }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            style={styles.pillScroll}
            contentContainerStyle={[styles.pillToolsRow, { flexDirection: rtl ? "row-reverse" : "row" }]}
          >
            {compactTools}
          </ScrollView>
          <View style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />
          {AskAI}
        </View>
        {cropModal}
      </View>
    );
  }

  // Full-width docked bar (keyboard open, or pill expanded).
  return (
    <View
      style={[
        keyboardOpen ? styles.fullWrap : styles.fullCard,
        {
          backgroundColor: colors.bgPrimary,
          borderColor: colors.borderSubtle,
          borderTopColor: colors.borderSubtle,
          paddingBottom: keyboardOpen ? 6 : 8,
        },
      ]}
    >
      {renderExpansion()}
      <View style={[styles.fullRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={[styles.fullTools, { flexDirection: rtl ? "row-reverse" : "row" }]}
          style={styles.fullScroll}
        >
          {expandedTools}
          {/* Collapse the expanded pill back to compact (keyboard-closed only). */}
          {!keyboardOpen
            ? chip({ keyProp: "collapse", Icon: X, accessibilityLabel: t("common.close", { defaultValue: "Close" }), onPress: () => setPillExpanded(false) })
            : null}
        </ScrollView>
        {AskAI}
      </View>
      {saving ? <View style={[styles.savingDot, { backgroundColor: colors.brandPrimary }]} /> : null}
      {cropModal}
    </View>
  );
}

const CHIP = 40;

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
  // Expanded pill inline (keyboard closed) — a rounded floating card on the paper.
  fullCard: {
    marginHorizontal: 8,
    marginTop: 2,
    paddingHorizontal: 10,
    paddingTop: 8,
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
  soonCaption: { fontSize: 11, fontFamily: "Inter_500Medium", alignSelf: "center", marginLeft: 6 },

  savingDot: { position: "absolute", top: 4, right: 8, width: 6, height: 6, borderRadius: 3 },
});
