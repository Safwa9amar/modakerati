import React, { useRef } from "react";
import { View, ScrollView, Pressable, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, PilcrowLeft, PilcrowRight, ChevronUp, ChevronDown, ImagePlus, Eraser } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { DocBlockDTO } from "@/lib/api";
import type { FormatChange } from "@/lib/thesis-ops";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;
type Align = "left" | "center" | "right" | "justify";

interface Props {
  thesisId: string;
  /** The selected PARAGRAPH blocks, in document order. [] → nothing editable
   *  (shows the hint). One → single-block editing (all tools). Many → the style /
   *  alignment / direction / clear-formatting tools apply to every one at once. */
  selection: ParagraphBlock[];
  blockCount: number;           // total blocks — to disable move at the edges
  hint: string;                 // "Select a paragraph to edit."
  styleLabels: { normal: string };
  rtl: boolean;
}

const STYLE_OPTIONS: Array<{ level: number; label: string }> = [
  { level: 0, label: "" }, // label filled from styleLabels.normal at render
  { level: 1, label: "H1" }, { level: 2, label: "H2" }, { level: 3, label: "H3" },
  { level: 4, label: "H4" }, { level: 5, label: "H5" }, { level: 6, label: "H6" },
];
const ALIGN_OPTIONS: Array<{ value: Align; Icon: typeof AlignLeft }> = [
  { value: "left", Icon: AlignLeft }, { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight }, { value: "justify", Icon: AlignJustify },
];
// engine "both" == UI "justify"
const alignFromDoc = (a: string | null): Align | null => (a === "both" ? "justify" : (a as Align | null));

// Paragraph text direction (Word's RTL/LTR paragraph buttons). PilcrowLeft reads
// as right-to-left flow, PilcrowRight as left-to-right.
const DIRECTION_OPTIONS: Array<{ value: "rtl" | "ltr"; Icon: typeof PilcrowLeft }> = [
  { value: "rtl", Icon: PilcrowLeft },
  { value: "ltr", Icon: PilcrowRight },
];

export function ComposerEditTools({ thesisId, selection, blockCount, hint, styleLabels, rtl }: Props) {
  const colors = useThemeColors();
  // A subtle "saving…" hint while background flushes are in flight — the UI never
  // blocks on them (edits apply optimistically and the store reconciles behind).
  const saving = useThesisDocStore((s) => (s.pending[thesisId] ?? 0) > 0);
  // Guard the image picker against a double-launch (its own modal, not a doc edit).
  const pickingRef = useRef(false);

  if (selection.length === 0) {
    return <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>;
  }

  const indices = selection.map((b) => b.index);
  const multi = selection.length > 1;
  // Move / image insert operate on ONE block — only offered for a lone selection.
  const single = multi ? null : selection[0];

  // Apply one formatting change to every selected paragraph. Optimistic + durable:
  // the local blocks update instantly, the op is persisted, and the store's pump
  // flushes it in the background (retrying offline; alerting on a rejection).
  const apply = (changes: FormatChange) => {
    void useThesisDocStore.getState().mutate(thesisId, { type: "format", indices, changes });
  };

  // Nudge the lone block one position up/down. Reselect its new index immediately
  // (optimistic), then flush the move in the background.
  const move = (dir: "up" | "down") => {
    if (!single) return;
    const from = single.index;
    const to = dir === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= blockCount) return;
    useWorkspaceStore.getState().selectBlock(to, single.text);
    void useThesisDocStore.getState().mutate(thesisId, { type: "move", from, to });
  };
  const canUp = !!single && single.index > 0;
  const canDown = !!single && single.index < blockCount - 1;

  // Pick an image from the library and insert it as a new block right after the
  // lone selected block. iOS's system picker needs no explicit permission. The
  // picked bytes render instantly as an optimistic image block while the server
  // embeds them into the .docx in the background.
  const pickImage = async () => {
    if (!single || pickingRef.current) return;
    pickingRef.current = true;
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
    } catch {
      Alert.alert("Error");
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

  // A pill is "active" only when EVERY selected block already has that value — a
  // mixed multi-selection shows nothing highlighted (tapping still sets them all).
  const allLevel = (lvl: number) => selection.every((b) => b.level === lvl);
  const allAlign = (v: Align) => selection.every((b) => alignFromDoc(b.alignment) === v);
  const allDirection = (v: "rtl" | "ltr") => selection.every((b) => b.direction === v);

  const pill = (active: boolean) => [styles.pill, { borderColor: colors.borderDefault }, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }];
  const pillText = (active: boolean) => [styles.pillText, { color: active ? colors.bgPrimary : colors.textPrimary }];

  return (
    <View style={{ gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        {STYLE_OPTIONS.map((o) => {
          const active = allLevel(o.level);
          return (
            <Pressable key={o.level} onPress={() => apply({ level: o.level })} style={pill(active)}>
              <Text style={pillText(active)}>{o.level === 0 ? styleLabels.normal : o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}
      >
        {/* Move the block up / down one position — single selection only. */}
        {single && (
          <>
            <Pressable disabled={!canUp} onPress={() => move("up")} style={[styles.pill, { borderColor: colors.borderDefault }, !canUp && styles.disabled]}>
              <ChevronUp size={16} color={colors.textPrimary} strokeWidth={2} />
            </Pressable>
            <Pressable disabled={!canDown} onPress={() => move("down")} style={[styles.pill, { borderColor: colors.borderDefault }, !canDown && styles.disabled]}>
              <ChevronDown size={16} color={colors.textPrimary} strokeWidth={2} />
            </Pressable>
            <View style={styles.divider} />
          </>
        )}
        {ALIGN_OPTIONS.map(({ value, Icon }) => {
          const active = allAlign(value);
          return (
            <Pressable key={value} onPress={() => apply({ alignment: value })} style={pill(active)}>
              <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
            </Pressable>
          );
        })}
        {/* Paragraph direction — Word's RTL / LTR buttons. */}
        {DIRECTION_OPTIONS.map(({ value, Icon }) => {
          const active = allDirection(value);
          return (
            <Pressable key={value} onPress={() => apply({ direction: value })} style={pill(active)}>
              <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
            </Pressable>
          );
        })}
        <Pressable onPress={() => apply({ clearFormatting: true })} style={[styles.pill, { borderColor: colors.borderDefault }]}>
          <Eraser size={16} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
        {/* Insert an image after this block — single selection only. */}
        {single && (
          <>
            <View style={styles.divider} />
            <Pressable onPress={pickImage} style={[styles.pill, { borderColor: colors.brandPrimary }]}>
              <ImagePlus size={16} color={colors.brandPrimary} strokeWidth={2} />
            </Pressable>
          </>
        )}
      </ScrollView>
      {saving && <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginTop: 2 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 14, textAlign: "center" },
  row: { gap: 6, alignItems: "center", paddingVertical: 2 },
  pill: { minWidth: 40, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  disabled: { opacity: 0.35 },
  divider: { width: 1, height: 20, backgroundColor: "#8884", marginHorizontal: 2 },
});
