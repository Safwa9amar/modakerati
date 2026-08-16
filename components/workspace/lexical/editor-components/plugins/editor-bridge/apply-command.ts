// The native → Lexical direction of the bridge: apply one command from the native
// bubble / pill / dock.
//
// Split out of EditorBridge because it is a pure dispatch — every case is
// "translate this command envelope into a Lexical mutation" and none of it needs
// the component's scope. `onBlocks` is passed explicitly rather than closed over,
// so the dependency is visible.

import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { $insertList, $removeList } from "@lexical/list";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
  type ElementFormatType,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";

import type { DocBlockDTO } from "@/lib/api";
import { $lexicalToBlocks, $patchBlockData } from "../../../blockLexical";
import { applyBlockFormat } from "../../block-format";
import { INSERT_BLOCK_COMMAND } from "../../commands";
import { lxQuietCommand, lxQuietUpdate } from "../../lexical-updates";
import type { InsertBlockPayload, LexicalCommand } from "../../types";

export function applyLexicalCommand(
  editor: LexicalEditor,
  command: LexicalCommand,
  onBlocks?: (blocks: DocBlockDTO[]) => void,
): void {
  // Don't focus for the block-scoped pill format or serialize — focusing the
  // content-editable pops the keyboard and scrolls (the pill applies formatting
  // without moving the caret). The lab's selection commands still focus. Undo/
  // redo also skip focus: tapped from the dock with the keyboard closed, they
  // must not pop it (Lexical's history doesn't need a live selection).
  if (command.type !== "blockFormat" && command.type !== "serialize" && command.type !== "list" && command.type !== "undo" && command.type !== "redo" && command.type !== "insert" && command.type !== "blur" && command.type !== "patchBlocks") editor.focus();
  switch (command.type) {
    case "bold":
    case "italic":
    case "underline":
      lxQuietCommand(editor, FORMAT_TEXT_COMMAND, command.type as TextFormatType);
      break;
    case "align":
      if (command.value) lxQuietCommand(editor, FORMAT_ELEMENT_COMMAND, command.value as ElementFormatType);
      break;
    case "blockFormat":
      // Whole-block formatting from the native pill: apply to every selected
      // block (matches the server's whole-paragraph `format` op). Tagged
      // SKIP_DOM_SELECTION so it never focuses/scrolls the WebView.
      editor.update(() => applyBlockFormat(command.value), { tag: SKIP_DOM_SELECTION_TAG });
      break;
    case "heading":
      lxQuietUpdate(editor, () => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        $setBlocksType(sel, () =>
          command.value === "paragraph" || !command.value ? $createParagraphNode() : $createHeadingNode(command.value as HeadingTagType),
        );
      });
      break;
    case "quote":
      lxQuietUpdate(editor, () => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) $setBlocksType(sel, () => $createQuoteNode());
      });
      break;
    case "list":
      // Indent/outdent nest a list item one level (promote/demote). They're
      // editor COMMANDS (not selection mutations) — dispatch straight through so
      // Lexical's list logic handles the nesting + renumbering, then stop.
      if (command.value === "indent") { lxQuietCommand(editor, INDENT_CONTENT_COMMAND, undefined); break; }
      if (command.value === "outdent") { lxQuietCommand(editor, OUTDENT_CONTENT_COMMAND, undefined); break; }
      // Apply on the preserved selection inside a tagged update (no focus/scroll,
      // like blockFormat). ul→bullet, ol→number, check→checklist, else remove.
      editor.update(
        () => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          if (command.value === "none") $removeList();
          else if (command.value === "check") $insertList("check");
          else $insertList(command.value === "ol" ? "number" : "bullet");
        },
        { tag: SKIP_DOM_SELECTION_TAG },
      );
      break;
    case "undo":
      editor.dispatchCommand(UNDO_COMMAND, undefined);
      break;
    case "redo":
      editor.dispatchCommand(REDO_COMMAND, undefined);
      break;
    case "color":
      lxQuietUpdate(editor, () => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) $patchStyleText(sel, { color: !command.value || command.value === "clear" ? "" : `#${command.value.replace(/^#/, "")}` });
      });
      break;
    case "clearFormatting":
      lxQuietUpdate(editor, () => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        $patchStyleText(sel, { color: "" });
        (["bold", "italic", "underline"] as const).forEach((f) => { if (sel.hasFormat(f)) sel.formatText(f); });
      });
      break;
    case "patchBlocks":
      // value = JSON DocBlockDTO[]. Restyle the named structural blocks (table /
      // chart / figure) IN PLACE — the reseed-free path for an external edit that
      // changed nothing but those blocks. Only those decorators re-render: no
      // rebuild, no repagination from scratch, no history clear, no scroll jump.
      // Quiet + selection-skipping, so the tapped table stays selected under the
      // bubble toolbar the student is still holding open.
      if (command.value) {
        const patch = JSON.parse(command.value) as DocBlockDTO[];
        lxQuietUpdate(editor, () => { $patchBlockData(patch); }, true);
      }
      break;
    case "serialize":
      if (onBlocks) editor.getEditorState().read(() => onBlocks($lexicalToBlocks()));
      break;
    case "insert":
      // value = JSON { kind }. Delegate to SlashPlugin's command (owns the /query
      // deletion + placement). No focus() side-effect needed — the caret is live.
      if (command.value) editor.dispatchCommand(INSERT_BLOCK_COMMAND, JSON.parse(command.value) as InsertBlockPayload);
      break;
    case "blur":
      // Close the OS keyboard. RN's Keyboard.dismiss() can't reach the caret
      // inside the WebView, so the surface that wants the keyboard gone (the
      // Insert drawer) dispatches this instead. `editor.blur()` only drops the
      // DOM range — the editor-state selection survives, so the /slash insert
      // still lands on the right block afterwards.
      editor.blur();
      break;
  }
}
