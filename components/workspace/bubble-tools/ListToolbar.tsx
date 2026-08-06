import React from "react";
import {
  AlignLeft,
  Bold,
  ChevronDown,
  ChevronUp,
  Italic,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Pilcrow,
  Trash2,
} from "lucide-react-native";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useChipKit, useTools } from "./context";

/**
 * A live Lexical list item (bullet / number / check). List ops are PRIMARY here:
 * tapping the ACTIVE kind removes the list (the bubble morphs back to text/heading),
 * tapping another switches, and indent/outdent nest the item. All of it is
 * live-editor-only, persisted by the Writer's batched auto-sync — only bullets and
 * numbers round-trip to Word (a checklist degrades to bullets).
 *
 * Everything else (marks, move, delete) is the paragraph behaviour, because a list
 * item IS a paragraph in the document model.
 */
export function ListTools({ full }: { full: boolean }) {
  const { chip, categoryChip, sep, moreChip, t } = useChipKit();
  const { lexFmt, canFormat, canUp, canDown, allBold, allItalic, apply, move, del } = useTools();

  const dispatchList = (v: "ul" | "ol" | "check" | "none" | "indent" | "outdent") =>
    useLexicalEditorStore.getState().dispatch("list", v);

  const isBullet = lexFmt.blockType === "bullet";
  const isNumber = lexFmt.blockType === "number";
  const isCheck = lexFmt.blockType === "check";

  const kindChips = (base: number) => [
    chip({ keyProp: "ls-ul", Icon: List, accessibilityLabel: t("blockBar.listBulleted", { defaultValue: "Bulleted list" }), active: isBullet, enterIndex: base, onPress: () => dispatchList(isBullet ? "none" : "ul") }),
    chip({ keyProp: "ls-ol", Icon: ListOrdered, accessibilityLabel: t("blockBar.listNumbered", { defaultValue: "Numbered list" }), active: isNumber, enterIndex: base + 1, onPress: () => dispatchList(isNumber ? "none" : "ol") }),
    chip({ keyProp: "ls-check", Icon: ListChecks, accessibilityLabel: t("blockBar.listCheck", { defaultValue: "Checklist" }), active: isCheck, enterIndex: base + 2, onPress: () => dispatchList(isCheck ? "none" : "check") }),
  ];
  // Outdent/indent ordered leading→trailing (outdent = promote, indent = demote).
  const nestChips = (base: number) => [
    chip({ keyProp: "ls-out", Icon: ListIndentDecrease, accessibilityLabel: t("blockBar.listOutdent", { defaultValue: "Decrease indent" }), enterIndex: base, onPress: () => dispatchList("outdent") }),
    chip({ keyProp: "ls-in", Icon: ListIndentIncrease, accessibilityLabel: t("blockBar.listIndent", { defaultValue: "Increase indent" }), enterIndex: base + 1, onPress: () => dispatchList("indent") }),
  ];

  if (!full) {
    return (
      <>
        {kindChips(0)}
        {sep("ls1")}
        {nestChips(3)}
        {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 5)}
        {moreChip("ls-more", 6)}
      </>
    );
  }

  return (
    <>
      {kindChips(0)}
      {sep("ls1")}
      {nestChips(3)}
      {chip({ keyProp: "ls-para", Icon: Pilcrow, accessibilityLabel: t("blockBar.listToParagraph", { defaultValue: "Convert to paragraph" }), enterIndex: 5, onPress: () => dispatchList("none") })}
      {sep("ls2")}
      {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 6)}
      {sep("ls2b")}
      {chip({ keyProp: "ls-bold", Icon: Bold, accessibilityLabel: t("blockBar.bold", { defaultValue: "Bold" }), active: allBold, disabled: !canFormat, enterIndex: 7, onPress: () => apply({ bold: !allBold }) })}
      {chip({ keyProp: "ls-italic", Icon: Italic, accessibilityLabel: t("blockBar.italic", { defaultValue: "Italic" }), active: allItalic, disabled: !canFormat, enterIndex: 8, onPress: () => apply({ italic: !allItalic }) })}
      {sep("ls3")}
      {chip({ keyProp: "ls-up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, enterIndex: 9, onPress: () => move("up") })}
      {chip({ keyProp: "ls-down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, enterIndex: 10, onPress: () => move("down") })}
      {chip({ keyProp: "ls-del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: 11, onPress: del })}
    </>
  );
}
