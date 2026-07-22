'use dom';

// Lexical rich-text editor rendered as an Expo DOM component ('use dom' →
// @expo/dom-webview). This is a SPIKE: an isolated proof that our NATIVE bubble
// can drive a web rich-text editor while keeping RTL + rich formatting for free.
//
// Data flow (per the Expo DOM-components contract — serializable props only):
//   • native → web:  `command` (a serializable {type,value,nonce} object). The
//     nonce forces a re-apply even when the same command repeats.
//   • web → native:  `onState` (a top-level async function prop) reports the
//     active formats so the native bubble can highlight B/I/U/heading/direction.
// Nothing here is wired to the thesis doc/op-queue yet — it's a feasibility test.

import { useEffect } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  HeadingNode,
  QuoteNode,
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  ListNode,
  ListItemNode,
  $isListNode,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $setBlocksType, $patchStyleText } from "@lexical/selection";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  type ElementFormatType,
  type TextFormatType,
} from "lexical";
import { $blocksToLexical, $lexicalToBlocks, BlockDataNode } from "./blockLexical";
import type { DocBlockDTO } from "@/lib/api";

// The serializable command the native bubble sends in. `nonce` bumps per tap.
export type LexicalCommand =
  | { type: "bold" | "italic" | "underline" | "undo" | "redo"; value?: undefined; nonce: number }
  | { type: "align"; value: ElementFormatType; nonce: number }
  | { type: "heading"; value: HeadingTagType | "paragraph"; nonce: number }
  | { type: "quote"; value?: undefined; nonce: number }
  | { type: "list"; value: "ul" | "ol" | "none"; nonce: number }
  | { type: "color"; value: string; nonce: number } // 6-hex, or "clear"
  | { type: "clearFormatting"; value?: undefined; nonce: number }
  | { type: "serialize"; value?: undefined; nonce: number };

// The active-format snapshot reported back to the native bubble.
export type LexicalState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: string; // paragraph | h1 | h2 | h3 | quote | bullet | number
  isRTL: boolean;
  index: number; // position of the focused top-level block (-1 if none)
  text: string; // the focused block's text (for the selection chip / AI targeting)
};

// Lexical maps active formats to THESE class names; the CSS below styles them.
const theme = {
  paragraph: "lx-p",
  heading: { h1: "lx-h1", h2: "lx-h2", h3: "lx-h3" },
  quote: "lx-quote",
  list: { ul: "lx-ul", ol: "lx-ol", listitem: "lx-li" },
  text: { bold: "lx-bold", italic: "lx-italic", underline: "lx-underline" },
};

const CSS = `
/* Use the GENERIC sans-serif keyword, inherited by all content, NOT concrete
   font names: on this WebView a concrete-first stack (Roboto/-apple-system/…)
   fails to fall back to an Arabic font and renders .notdef tofu, whereas the
   generic keyword chains to the system Arabic font (verified on-device). */
.lx-root { position: relative; height: 100%; background: #ffffff; font-family: sans-serif; }
.lx-content { outline: none; min-height: 100%; padding: 16px 18px 140px; color: #1a1a1a;
  font-size: 15px; line-height: 1.7; -webkit-user-select: text; }
.lx-ph { position: absolute; top: 16px; inset-inline-start: 18px; color: #8a8a8a; pointer-events: none; font-size: 15px; }
.lx-p { margin: 0 0 10px; }
.lx-h1 { font-size: 24px; font-weight: 700; margin: 6px 0 10px; }
.lx-h2 { font-size: 20px; font-weight: 700; margin: 6px 0 8px; }
.lx-h3 { font-size: 17px; font-weight: 600; margin: 4px 0 8px; }
.lx-quote { margin: 0 0 10px; border-inline-start: 3px solid #4b57c4; padding-inline-start: 12px; color: #555; font-style: italic; }
.lx-ul { margin: 0 0 10px; padding-inline-start: 26px; list-style: disc; }
.lx-ol { margin: 0 0 10px; padding-inline-start: 26px; list-style: decimal; }
.lx-li { margin: 2px 0; }
.lx-bold { font-weight: 700; }
.lx-italic { font-style: italic; }
.lx-underline { text-decoration: underline; }
::selection { background: #ffe08a; }
`;

// Seed a little bilingual content so RTL auto-detection is visible immediately.
function seed(): void {
  const root = $getRoot();
  if (root.getFirstChild() !== null) return;
  const h = $createHeadingNode("h1");
  h.append($createTextNode("الفصل الأول: منهجية البحث"));
  const p1 = $createParagraphNode();
  p1.append($createTextNode("تُعدّ هذه الدراسة محاولةً لفهم أثر التحول الرقمي على جودة التعليم العالي."));
  const p2 = $createParagraphNode();
  p2.append($createTextNode("This mixed-language note flows left-to-right on its own — Lexical handles bidi."));
  root.append(h, p1, p2);
}

// Bridge between the native props and the Lexical editor instance: apply an
// incoming command, and report the active formats out on every update.
function EditorBridge({
  command,
  onState,
  onBlocks,
}: {
  command?: LexicalCommand | null;
  onState: (s: LexicalState) => void;
  onBlocks?: (blocks: DocBlockDTO[]) => void;
}) {
  const [editor] = useLexicalComposerContext();

  // Apply the latest command. Keyed on nonce so a repeated tap re-fires.
  useEffect(() => {
    if (!command) return;
    editor.focus();
    switch (command.type) {
      case "bold":
      case "italic":
      case "underline":
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, command.type as TextFormatType);
        break;
      case "align":
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, command.value);
        break;
      case "heading":
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          $setBlocksType(sel, () =>
            command.value === "paragraph" ? $createParagraphNode() : $createHeadingNode(command.value),
          );
        });
        break;
      case "quote":
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) $setBlocksType(sel, () => $createQuoteNode());
        });
        break;
      case "list":
        if (command.value === "ul") editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        else if (command.value === "ol") editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        else editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        break;
      case "undo":
        editor.dispatchCommand(UNDO_COMMAND, undefined);
        break;
      case "redo":
        editor.dispatchCommand(REDO_COMMAND, undefined);
        break;
      case "color":
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) $patchStyleText(sel, { color: command.value === "clear" ? "" : `#${command.value.replace(/^#/, "")}` });
        });
        break;
      case "clearFormatting":
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          $patchStyleText(sel, { color: "" });
          (["bold", "italic", "underline"] as const).forEach((f) => { if (sel.hasFormat(f)) sel.formatText(f); });
        });
        break;
      case "serialize":
        if (onBlocks) editor.getEditorState().read(() => onBlocks($lexicalToBlocks()));
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.nonce]);

  // Report active formats to the native bubble on every editor update.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) {
          onState({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, index: -1, text: "" });
          return;
        }
        const anchor = sel.anchor.getNode();
        const top = anchor.getKey() === "root" ? null : anchor.getTopLevelElementOrThrow();
        let blockType = "paragraph";
        if (top) {
          if ($isHeadingNode(top)) blockType = top.getTag();
          else if ($isListNode(top)) blockType = top.getListType() === "bullet" ? "bullet" : "number";
          else blockType = top.getType(); // "paragraph" | "quote"
        }
        const index = top ? $getRoot().getChildren().indexOf(top) : -1;
        onState({
          bold: sel.hasFormat("bold"),
          italic: sel.hasFormat("italic"),
          underline: sel.hasFormat("underline"),
          blockType,
          isRTL: !!top && top.getDirection() === "rtl",
          index,
          text: top ? top.getTextContent() : "",
        });
      });
    });
  }, [editor, onState]);

  return null;
}

export default function LexicalDomEditor({
  command,
  onState,
  onBlocks,
  initialBlocks,
}: {
  command?: LexicalCommand | null;
  onState: (s: LexicalState) => void;
  // Serialized blocks emitted in response to a `serialize` command (round-trip test).
  onBlocks?: (blocks: DocBlockDTO[]) => void;
  // When provided, the editor is seeded FROM these blocks instead of the demo text.
  initialBlocks?: DocBlockDTO[];
  // Consumed by the Expo DOM runtime (WebView config); declared so native call
  // sites can pass it. Not read inside the component.
  dom?: import("expo/dom").DOMProps;
}) {
  const initialConfig = {
    namespace: "modakerati-lexical-lab",
    theme,
    onError: (error: Error) => console.error("[lexical]", error),
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, BlockDataNode],
    editorState: () => (initialBlocks && initialBlocks.length ? $blocksToLexical(initialBlocks) : seed()),
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <style>{CSS}</style>
      <div className="lx-root">
        <RichTextPlugin
          contentEditable={<ContentEditable className="lx-content" dir="auto" />}
          placeholder={<div className="lx-ph">اكتب هنا… · format from the bar below</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <EditorBridge command={command} onState={onState} onBlocks={onBlocks} />
      </div>
    </LexicalComposer>
  );
}
