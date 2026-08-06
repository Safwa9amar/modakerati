import React from "react";
import { Text } from "react-native";
import {
  AlignLeft,
  Bold,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Eraser,
  ImagePlus,
  Italic,
  List,
  Palette,
  PilcrowLeft,
  Tag,
  Trash2,
  Type,
  Underline,
} from "lucide-react-native";
import { AnimatedChip } from "../AnimatedChip";
import { useChipKit, useTools } from "./context";
import { useCaptionSheetStore } from "@/stores/caption-sheet-store";
import { toolStyles } from "./styles";

/**
 * Body text — the default toolbar. Compact: the three inline marks + the Style /
 * Align / Direction categories + (+). Full: everything, plus List/Color, move,
 * insert image, clear formatting and delete.
 *
 * Headings share this toolbar's FULL set (a heading is a paragraph with a level);
 * only their compact set differs — see HeadingTools below.
 */
export function ParagraphTools({ full }: { full: boolean }) {
  const { chip, categoryChip, sep, moreChip, t } = useChipKit();
  const { thesisId, canFormat, single, selectedBlock, soleIndex, canUp, canDown, allBold, allItalic, allUnderline, apply, move, del, pickImage, pasteImage } = useTools();

  // A caption is a paragraph, but not an ordinary one: its label and number belong
  // to a numbered sequence, so re-wording it goes through the Caption sheet rather
  // than free text editing (which would eat the SEQ field). Only offered when the
  // selection IS a caption.
  const isCaption =
    selectedBlock?.kind === "paragraph" && selectedBlock.styleId === "Caption" && soleIndex != null;
  const captionChip = isCaption
    ? chip({
        keyProp: "p-caption",
        Icon: Tag,
        accessibilityLabel: t("blockBar.caption", { defaultValue: "Caption" }),
        enterIndex: 3,
        onPress: () => {
          if (soleIndex != null) useCaptionSheetStore.getState().openEdit({ thesisId, index: soleIndex, text: "" });
        },
      })
    : null;

  const marks = (
    <>
      {chip({ keyProp: "bold", Icon: Bold, accessibilityLabel: t("blockBar.bold", { defaultValue: "Bold" }), active: allBold, disabled: !canFormat, enterIndex: 0, onPress: () => apply({ bold: !allBold }) })}
      {chip({ keyProp: "italic", Icon: Italic, accessibilityLabel: t("blockBar.italic", { defaultValue: "Italic" }), active: allItalic, disabled: !canFormat, enterIndex: 1, onPress: () => apply({ italic: !allItalic }) })}
      {chip({ keyProp: "underline", Icon: Underline, accessibilityLabel: t("blockBar.underline", { defaultValue: "Underline" }), active: allUnderline, disabled: !canFormat, enterIndex: 2, onPress: () => apply({ underline: !allUnderline }) })}
    </>
  );

  if (!full) {
    return (
      <>
        {marks}
        {captionChip}
        {sep("s1-compact")}
        {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }), 4)}
        {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 5)}
        {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }), 6)}
        {moreChip("p-more", 7)}
      </>
    );
  }

  return (
    <>
      {marks}
      {captionChip}
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
            chip({ keyProp: "img-paste", Icon: ClipboardPaste, accessibilityLabel: t("blockBar.pasteImage", { defaultValue: "Paste image" }), enterIndex: 11, onPress: () => void pasteImage() }),
          ]
        : null}
      {chip({ keyProp: "clear", Icon: Eraser, accessibilityLabel: t("blockBar.clear", { defaultValue: "Clear formatting" }), disabled: !canFormat, enterIndex: 12, onPress: () => apply({ clearFormatting: true }) })}
      {chip({ keyProp: "del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: 13, onPress: del })}
    </>
  );
}

/**
 * Heading — the same block family as body text, but its compact set puts the LEVELS
 * up front (H1…Hn, tapping the active one demotes back to Normal) instead of the
 * inline marks: changing level is what you almost always came for. Expanding hands
 * over to the full paragraph set.
 */
export function HeadingTools({ full }: { full: boolean }) {
  const { moreChip, colors } = useChipKit();
  const { rtl, headingLevels, allLevel, canFormat, apply } = useTools();

  if (full) return <ParagraphTools full />;

  return (
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
              toolStyles.chip,
              { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
              active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
              !canFormat && toolStyles.chipDim,
            ]}
          >
            <Text style={[toolStyles.optText, { color: active ? colors.bgPrimary : colors.textPrimary, fontWeight: "bold" }]}>
              {`H${l}`}
            </Text>
          </AnimatedChip>
        );
      })}
      {moreChip("h-more", headingLevels.length)}
    </>
  );
}
