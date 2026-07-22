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

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  $insertList,
  $removeList,
} from "@lexical/list";
import { $setBlocksType, $patchStyleText } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $setSelection,
  $isRangeSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isTextNode,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  SKIP_DOM_SELECTION_TAG,
  type ElementFormatType,
  type ElementNode,
  type TextFormatType,
  type LexicalEditor,
} from "lexical";
import {
  $blocksToLexical,
  $lexicalToBlocks,
  BlockDataNode,
  $isBlockDataNode,
  SuggestionNode,
  $createSuggestionNode,
  $isSuggestionNode,
  SUGGEST_APPROVE_COMMAND,
  SUGGEST_REJECT_COMMAND,
  SUGGEST_AGAIN_COMMAND,
  SUGGEST_EDIT_COMMAND,
  type SugData,
} from "./blockLexical";
import type { DocBlockDTO } from "@/lib/api";

// The pending AI proposal handed to the editor from the native suggestion store.
export type SuggestionInput = {
  index: number;
  original: string;
  proposed: string;
  status: string;
  instruction: string;
  label: string;
  reasoning: string;
  reasoningMs?: number;
};

// The serializable command the native bubble/pill sends in. `nonce` bumps per tap.
// Generic (a plain {type,value?} bag) so both the lab bubble's typed commands and
// the workspace pill's `blockFormat` (JSON value) / `direction` flow through it.
// Known types: bold | italic | underline | undo | redo | align | heading | quote |
// list | color | clearFormatting | serialize | direction | blockFormat.
export type LexicalCommand = { type: string; value?: string; nonce: number };

// The active-format snapshot reported back to the native bubble.
export type LexicalState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: string; // paragraph | h1 | h2 | h3 | quote | bullet | number
  isRTL: boolean;
  alignment: string | null; // left | center | right | justify | null (element format)
  index: number; // position of the focused top-level block (-1 if none)
  text: string; // the focused block's text (for the selection chip / AI targeting)
  // Every top-level block the current selection spans, in document order. Length 1
  // for a caret / in-paragraph selection; >1 for a cross-paragraph drag — lets the
  // native side build a MULTI-block selection instead of collapsing to the anchor.
  // Optional so the lab screens' bare initial-state literals still type-check.
  blocks?: { index: number; text: string }[];
  y?: number; // the block's top in WebView-viewport px (for anchoring the native pill)
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
/* Floating per-block bubble — a kind-icon bubble that expands to the pill of that
   block's tools (mirrors the native FloatingPill → BlockContextBar). */
.lx-tb-anchor { position: fixed; z-index: 40; }
.lx-tb-bubble { width: 34px; height: 34px; border: none; border-radius: 50%; background: #4b57c4; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 6px 16px -4px rgba(75,87,196,.5); }
.lx-tb-bubble:active { transform: scale(.92); }
.lx-tb { display: flex; gap: 3px; align-items: center; background: #ffffff; border: 1px solid #d8d8de; border-radius: 12px; padding: 4px 5px; box-shadow: 0 8px 22px -6px rgba(20,22,40,.30); max-width: calc(100vw - 12px); overflow-x: auto; scrollbar-width: none; }
.lx-tb::-webkit-scrollbar { display: none; }
.lx-tb-b { min-width: 30px; height: 30px; border: none; background: transparent; border-radius: 7px; font-size: 13px; color: #333; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0 7px; font-weight: 600; flex: 0 0 auto; }
.lx-tb-b:active { transform: scale(.9); }
.lx-tb-b.on { background: #4b57c4; color: #fff; }
.lx-tb-sep { width: 1px; height: 18px; background: #e4e5ee; margin: 0 2px; flex: 0 0 auto; }
.lx-tb-sw { width: 16px; height: 16px; border-radius: 8px; border: 1px solid #d8d8de; display: block; }
.lx-tb-lbl { font-size: 11px; color: #8a8a8a; padding: 0 6px; flex: 0 0 auto; }
/* Inline AI suggestion — a faithful web port of the native InlineSuggestion: an
   instruction chip, "Thought for Xs" trace, the proposal AS the paragraph with a
   green logical-edge bar + word add-marks, an expandable original teaser, and a
   white floating pill (Approve tint + dark ink / Edit / Again / Reject). Same
   fixed on-white palette as the native (this sits on the white document paper). */
.lx-sug { margin: 6px 0 10px; }
/* instruction chip */
.lx-sug-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 92%; margin: 4px 0 6px; padding: 3px 10px; border-radius: 999px; background: rgba(14,122,70,.08); border: 1px solid rgba(14,122,70,.18); color: #0E5C36; font-size: 11px; font-weight: 600; }
.lx-sug-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* "Thought for Xs" trace */
.lx-sug-trace { margin: 0 0 6px; border: 1px solid #D4DAE1; border-radius: 10px; background: #fff; padding: 4px 10px; }
.lx-sug-trace > summary { list-style: none; cursor: pointer; font-size: 11.5px; font-weight: 600; color: #0E5C36; }
.lx-sug-trace > summary::-webkit-details-marker { display: none; }
.lx-sug-trace-body { margin-top: 6px; font-size: 12px; line-height: 1.55; color: #3C4654; white-space: pre-wrap; max-height: 160px; overflow-y: auto; }
/* proposed text = the paragraph */
.lx-sug-proposed { font-size: 15px; line-height: 1.7; color: #16171d; border-inline-start: 3px solid #22C07A; padding-inline-start: 10px; }
.lx-sug-proposed.lx-sug-loading { color: #16171d; opacity: .38; }
.lx-sug-add { background: rgba(34,192,122,.18); border-radius: 3px; }
/* original teaser (tap to expand; del-marks when open) */
.lx-sug-teaser { margin-top: 8px; padding: 6px 9px; background: #F6F8FA; border-radius: 8px; cursor: pointer; }
.lx-sug-teaser-txt { font-size: 12.5px; line-height: 1.5; color: #8A94A4; }
.lx-sug-teaser-txt.lx-sug-clamp { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.lx-sug-del { background: #FDECEC; color: #B3564A; text-decoration: line-through; border-radius: 3px; }
/* error slip */
.lx-sug-err { margin-top: 8px; padding: 8px 10px; background: #FDF0EF; border: 1px solid rgba(192,57,43,.25); border-radius: 8px; color: #C0392B; font-size: 12.5px; font-weight: 500; }
/* edit-in-place textarea */
.lx-sug-edit { width: 100%; box-sizing: border-box; font-size: 15px; line-height: 1.7; color: #16171d; border: 1px solid #D4DAE1; border-radius: 8px; padding: 8px 10px; resize: vertical; min-height: 72px; background: #fff; }
/* white floating action pill */
.lx-sug-pill { display: flex; justify-content: center; margin: 10px 0 4px; }
.lx-sug-pillrow { display: inline-flex; align-items: center; gap: 2px; background: #fff; border: 1px solid #E8ECEF; border-radius: 999px; padding: 4px; box-shadow: 0 5px 12px -2px rgba(10,30,20,.16); }
.lx-sug-approve { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 96px; padding: 8px 16px; border: 1px solid rgba(14,122,70,.18); border-radius: 999px; background: rgba(14,122,70,.12); color: #0E5C36; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.lx-sug-approve:active { background: rgba(14,122,70,.24); }
.lx-sug-approve:disabled { opacity: .5; }
.lx-sug-icon { display: inline-flex; align-items: center; justify-content: center; padding: 8px 10px; border: none; border-radius: 999px; background: transparent; color: #3C4654; cursor: pointer; }
.lx-sug-icon:active { background: rgba(60,70,84,.10); }
.lx-sug-icon.lx-sug-danger { color: #C0392B; }
.lx-sug-think { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; color: #0E5C36; font-size: 12px; font-weight: 500; }
/* --- motion: a web port of the native InlineSuggestion (Reanimated) animations --- */
/* entrance: calm ease-out fade + rise (native FadeInDown 220ms). Runs once on mount
   — the decorator's outer div persists across stream re-renders, so it never replays. */
@keyframes lx-sug-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.lx-sug { animation: lx-sug-in 240ms cubic-bezier(0.33, 1, 0.68, 1) both; }
/* the floating pill rises a touch after the body (native pill anchor). */
.lx-sug-pill { animation: lx-sug-in 300ms cubic-bezier(0.33, 1, 0.68, 1) both; }
/* thinking: a light band sweeping across the dimmed original (native SweepBand). */
.lx-sug-proposed.lx-sug-loading { position: relative; overflow: hidden; }
.lx-sug-proposed.lx-sug-loading::after { content: ""; position: absolute; top: 0; bottom: 0; width: 55%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent); animation: lx-sug-sweep 1.4s linear infinite; pointer-events: none; }
@keyframes lx-sug-sweep { from { transform: translateX(-140%); } to { transform: translateX(320%); } }
/* thinking capsule ✦ spinner (native SpinSparkle). */
.lx-sug-think svg { animation: lx-sug-spin 1s linear infinite; transform-origin: center; }
@keyframes lx-sug-spin { to { transform: rotate(360deg); } }
/* added words flash brighter on appear, then settle to the soft tint (native AddSpan). */
@keyframes lx-sug-addflash { 0% { background: rgba(34, 192, 122, 0.5); } 100% { background: rgba(34, 192, 122, 0.18); } }
.lx-sug-add { animation: lx-sug-addflash 700ms ease-out both; }
/* pill press feedback: scale squish (native usePressFx). */
.lx-sug-approve, .lx-sug-icon { transition: transform 120ms ease, background 120ms ease; }
.lx-sug-approve:active, .lx-sug-icon:active { transform: scale(0.92); }
/* exit: approve = absorb up + shrink + fade; reject = tip down + fade (native
   pillSink / pillDrop choreography). Played for ~200ms before the node is settled. */
.lx-sug.lx-leaving-approve { animation: lx-sug-approve-out 220ms cubic-bezier(0.4, 0, 1, 1) forwards; }
@keyframes lx-sug-approve-out { to { opacity: 0; transform: translateY(-8px) scale(0.97); } }
.lx-sug.lx-leaving-reject { animation: lx-sug-reject-out 200ms cubic-bezier(0.4, 0, 1, 1) forwards; }
@keyframes lx-sug-reject-out { to { opacity: 0; transform: translateY(10px) rotate(0.6deg); } }
@media (prefers-reduced-motion: reduce) {
  .lx-sug, .lx-sug-pill { animation: none; }
  .lx-sug-proposed.lx-sug-loading::after, .lx-sug-think svg, .lx-sug-add { animation: none; }
  .lx-sug.lx-leaving-approve, .lx-sug.lx-leaving-reject { animation: none; }
}
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
  reseed,
  scrollToIndex,
}: {
  command?: LexicalCommand | null;
  onState: (s: LexicalState) => void;
  onBlocks?: (blocks: DocBlockDTO[]) => void;
  reseed?: { blocks: DocBlockDTO[]; nonce: number };
  scrollToIndex?: { index: number; nonce: number };
}) {
  const [editor] = useLexicalComposerContext();

  // In-place reconcile from the block model when an external edit (native pill /
  // AI dock / undo-redo) changed the doc — rebuilds the content on the SAME editor
  // instance (no WebView remount, no flicker) instead of re-keying the component.
  useEffect(() => {
    if (!reseed) return;
    // Clear the selection after rebuilding AND blur the editor (blurAfter): the
    // rebuild otherwise leaves the caret at the document END and the WebView
    // re-focuses + scrolls it into view (the reported "Approve jumps to the
    // bottom"). No focus, no caret → nothing to scroll to.
    withScrollPinned(editor, () => { $blocksToLexical(reseed.blocks); $setSelection(null); }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseed?.nonce]);

  // Outline-drawer navigation: scroll the block at `index` into view.
  useEffect(() => {
    if (!scrollToIndex || scrollToIndex.index < 0) return;
    let key: string | null = null;
    editor.getEditorState().read(() => {
      const n = $getRoot().getChildren()[scrollToIndex.index];
      key = n ? n.getKey() : null;
    });
    if (key) editor.getElementByKey(key)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex?.nonce]);

  // Apply the latest command. Keyed on nonce so a repeated tap re-fires.
  useEffect(() => {
    if (!command) return;
    // Don't focus for the block-scoped pill format or serialize — focusing the
    // content-editable pops the keyboard and scrolls (the pill applies formatting
    // without moving the caret). The lab's selection commands still focus.
    if (command.type !== "blockFormat" && command.type !== "serialize" && command.type !== "list") editor.focus();
    switch (command.type) {
      case "bold":
      case "italic":
      case "underline":
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, command.type as TextFormatType);
        break;
      case "align":
        if (command.value) editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, command.value as ElementFormatType);
        break;
      case "blockFormat":
        // Whole-block formatting from the native pill: apply to every selected
        // block (matches the server's whole-paragraph `format` op). Tagged
        // SKIP_DOM_SELECTION so it never focuses/scrolls the WebView.
        editor.update(() => applyBlockFormat(command.value), { tag: SKIP_DOM_SELECTION_TAG });
        break;
      case "heading":
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          $setBlocksType(sel, () =>
            command.value === "paragraph" || !command.value ? $createParagraphNode() : $createHeadingNode(command.value as HeadingTagType),
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
        // Apply on the preserved selection inside a tagged update (no focus/scroll,
        // like blockFormat). ul→bullet, ol→number, else remove.
        editor.update(
          () => {
            const sel = $getSelection();
            if (!$isRangeSelection(sel)) return;
            if (command.value === "none") $removeList();
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
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) $patchStyleText(sel, { color: !command.value || command.value === "clear" ? "" : `#${command.value.replace(/^#/, "")}` });
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

  // Report the focused block (formats, index, text, screen-Y) to the native side
  // so the reused native pill / AI dock can attach to the Lexical selection.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let key: string | null = null;
      let payload: LexicalState = { bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, alignment: null, index: -1, text: "", y: -1 };
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        const anchor = sel.anchor.getNode();
        const top = anchor.getKey() === "root" ? null : anchor.getTopLevelElement();
        if (anchor.getKey() !== "root" && !top) return; // selection detached (e.g. mid-suggestion)
        let blockType = "paragraph";
        if (top) {
          if ($isHeadingNode(top)) blockType = top.getTag();
          else if ($isListNode(top)) blockType = top.getListType() === "bullet" ? "bullet" : "number";
          else blockType = top.getType(); // "paragraph" | "quote"
        }
        key = top ? top.getKey() : null;
        // ElementNode.getFormatType() → "" | "left" | "center" | "right" | "justify" | "start" | "end"
        const fmt = top ? top.getFormatType() : "";
        const rootKids = $getRoot().getChildren();
        // Every top-level block the selection spans, in document order. A caret or an
        // in-paragraph selection yields ONE entry; a cross-paragraph drag lists them
        // all. We walk the selected nodes (not just the anchor, which stays put while
        // the focus extends downward) so extending a selection grows the set — that's
        // what lets the native side build a MULTI-block selection instead of
        // collapsing everything to the anchor block.
        const spanned: { index: number; text: string }[] = [];
        const seen = new Set<string>();
        for (const n of sel.getNodes()) {
          const t = n.getKey() === "root" ? null : n.getTopLevelElement();
          if (!t) continue;
          const k = t.getKey();
          if (seen.has(k)) continue;
          seen.add(k);
          spanned.push({ index: rootKids.indexOf(t), text: t.getTextContent() });
        }
        spanned.sort((a, b) => a.index - b.index);
        payload = {
          bold: sel.hasFormat("bold"),
          italic: sel.hasFormat("italic"),
          underline: sel.hasFormat("underline"),
          blockType,
          isRTL: !!top && top.getDirection() === "rtl",
          alignment: fmt === "left" || fmt === "center" || fmt === "right" || fmt === "justify" ? fmt : null,
          index: top ? rootKids.indexOf(top) : -1,
          text: top ? top.getTextContent() : "",
          blocks: spanned,
          y: -1,
        };
      });
      if (key) {
        const el = editor.getElementByKey(key);
        if (el) payload = { ...payload, y: el.getBoundingClientRect().top };
      }
      onState(payload);
    });
  }, [editor, onState]);

  return null;
}

// The per-block floating toolbar: appears anchored ABOVE the selected block and
// shows tools for THAT block's kind — text blocks (paragraph/heading/list/quote)
// get formatting; structural blocks (image/table/other, selected as a node) get
// move/delete. Lives inside the WebView so anchoring is just web positioning.
type TbInfo = { key: string; kind: "text" | "block"; block: string; bold: boolean; italic: boolean; underline: boolean };

// Collapsed-bubble glyph for the selected block's kind (like the native bubble icon).
function kindIcon(kind: "text" | "block", block: string): string {
  if (kind === "block") return block === "image" ? "🖼" : block === "table" ? "▦" : "⋯";
  if (block === "h1" || block === "h2" || block === "h3") return "H";
  if (block === "bullet") return "•";
  if (block === "number") return "1.";
  if (block === "quote") return "❝";
  return "¶";
}

function FloatingToolbar() {
  const [editor] = useLexicalComposerContext();
  const [tb, setTb] = useState<(TbInfo & { top: number; left: number }) | null>(null);
  const [expanded, setExpanded] = useState(false);

  const compute = useCallback(() => {
    const rootEl = editor.getRootElement();
    if (!rootEl) return setTb(null);
    let info: TbInfo | null = null;
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        const anchor = sel.anchor.getNode();
        const top = anchor.getKey() === "root" ? null : anchor.getTopLevelElementOrThrow();
        if (top) {
          const block = $isHeadingNode(top) ? top.getTag() : $isListNode(top) ? (top.getListType() === "bullet" ? "bullet" : "number") : top.getType();
          info = { key: top.getKey(), kind: "text", block, bold: sel.hasFormat("bold"), italic: sel.hasFormat("italic"), underline: sel.hasFormat("underline") };
        }
      } else if ($isNodeSelection(sel)) {
        const ns = sel.getNodes();
        if (ns.length === 1 && $isBlockDataNode(ns[0])) info = { key: ns[0].getKey(), kind: "block", block: (ns[0] as BlockDataNode).getBlock().kind, bold: false, italic: false, underline: false };
      }
    });
    // Cast: TS can't track the assignment made inside the read() callback above.
    const chosen = info as TbInfo | null;
    if (!chosen) return setTb(null);
    const el = editor.getElementByKey(chosen.key);
    if (!el) return setTb(null);
    const br = el.getBoundingClientRect();
    setTb({ ...chosen, top: Math.max(6, br.top - 42), left: 6 });
  }, [editor]);

  useEffect(() => {
    const onScroll = () => compute();
    const rootEl = editor.getRootElement();
    rootEl?.addEventListener("scroll", onScroll, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const off = mergeRegister(editor.registerUpdateListener(() => compute()));
    return () => {
      rootEl?.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      off();
    };
  }, [editor, compute]);

  // Collapse back to the kind-icon bubble whenever the selected block changes.
  useEffect(() => { setExpanded(false); }, [tb?.key]);

  if (!tb) return null;

  const fmt = (f: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
  const align = (a: ElementFormatType) => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, a);
  const setBlock = (make: () => HeadingNode | QuoteNode | ReturnType<typeof $createParagraphNode>) =>
    editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, make); });
  const list = (t: "ul" | "ol" | "none") =>
    editor.dispatchCommand(t === "ul" ? INSERT_UNORDERED_LIST_COMMAND : t === "ol" ? INSERT_ORDERED_LIST_COMMAND : REMOVE_LIST_COMMAND, undefined);
  const color = (hex: string) => editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $patchStyleText(s, { color: `#${hex}` }); });
  const move = (dir: -1 | 1) => editor.update(() => {
    const n = $getNodeByKey(tb.key); if (!n) return;
    const sib = dir === -1 ? n.getPreviousSibling() : n.getNextSibling(); if (!sib) return;
    if (dir === -1) sib.insertBefore(n); else sib.insertAfter(n);
  });
  const del = () => editor.update(() => { const n = $getNodeByKey(tb.key); if (n) n.remove(); });

  const B = (props: { on?: boolean; onClick: () => void; children: React.ReactNode }) =>
    React.createElement("button", { className: "lx-tb-b" + (props.on ? " on" : ""), onClick: props.onClick }, props.children);
  const sep = (k: string) => React.createElement("span", { key: k, className: "lx-tb-sep" });

  const isH = (t: string) => tb.block === t;
  return (
    <div className="lx-tb-anchor" style={{ top: tb.top, left: tb.left }}>
      {!expanded ? (
        <button className="lx-tb-bubble" onClick={() => setExpanded(true)} aria-label={`Edit ${tb.block}`}>{kindIcon(tb.kind, tb.block)}</button>
      ) : (
        <div className="lx-tb" onMouseDown={(e) => e.preventDefault()}>
          <B onClick={() => setExpanded(false)}>‹</B>
          {sep("sx")}
          {tb.kind === "text" ? (
        <>
          <B on={tb.bold} onClick={() => fmt("bold")}><b>B</b></B>
          <B on={tb.italic} onClick={() => fmt("italic")}><i>I</i></B>
          <B on={tb.underline} onClick={() => fmt("underline")}><u>U</u></B>
          {sep("s1")}
          <B on={isH("h1")} onClick={() => setBlock(() => (isH("h1") ? $createParagraphNode() : $createHeadingNode("h1")))}>H1</B>
          <B on={isH("h2")} onClick={() => setBlock(() => (isH("h2") ? $createParagraphNode() : $createHeadingNode("h2")))}>H2</B>
          <B on={isH("h3")} onClick={() => setBlock(() => (isH("h3") ? $createParagraphNode() : $createHeadingNode("h3")))}>H3</B>
          <B on={isH("quote")} onClick={() => setBlock(() => (isH("quote") ? $createParagraphNode() : $createQuoteNode()))}>❝</B>
          {sep("s2")}
          <B on={isH("bullet")} onClick={() => list(isH("bullet") ? "none" : "ul")}>•</B>
          <B on={isH("number")} onClick={() => list(isH("number") ? "none" : "ol")}>1.</B>
          {sep("s3")}
          <B onClick={() => align("left")}>L</B>
          <B onClick={() => align("center")}>C</B>
          <B onClick={() => align("right")}>R</B>
          <B onClick={() => align("justify")}>J</B>
          {sep("s4")}
          {["C0392B", "E67E22", "27AE60", "2980B9", "8E44AD"].map((h) =>
            React.createElement("button", { key: h, className: "lx-tb-b", onClick: () => color(h) },
              React.createElement("span", { className: "lx-tb-sw", style: { background: `#${h}` } })),
          )}
        </>
      ) : (
        <>
          <span className="lx-tb-lbl">{tb.block}</span>
          {sep("s1")}
          <B onClick={() => move(-1)}>↑</B>
          <B onClick={() => move(1)}>↓</B>
          <B onClick={del}>🗑</B>
        </>
      )}
        </div>
      )}
    </div>
  );
}

// Run a Lexical mutation without letting the WebView jump: capture the page scroll
// before the update and pin it back after the DOM reconciles. A node replace (a
// suggestion appearing) or a full reseed (approve → doc rebuild) otherwise scrolls
// the moved caret / rebuilt content into view — the reported "editor scrolls away
// when I hit Improve, and jumps to the bottom on Approve".
function withScrollPinned(editor: LexicalEditor, mutator: () => void, _blurAfter = false) {
  // The REAL fix (per Lexical docs): tag the update SKIP_DOM_SELECTION_TAG so the
  // reconciler skips the ENTIRE DOM-selection update — which is what re-focuses the
  // root (popping the keyboard → iOS scroll) AND scrolls the selection into view.
  // SKIP_SCROLL_INTO_VIEW_TAG alone wasn't enough: it stopped the scroll but the
  // re-focus still fired and iOS scrolled the focused editable into view. A light
  // 2-frame scroll restore stays as a backstop for plain reflow.
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  const restore = () => { if (typeof window !== "undefined") window.scrollTo(0, y); };
  editor.update(mutator, {
    tag: SKIP_DOM_SELECTION_TAG,
    onUpdate: () => { restore(); requestAnimationFrame(restore); },
  });
}

// Whole-block formatting from the native pill (mirror of the server's
// whole-paragraph `format` op): inline marks to every text child, level via a
// paragraph⇄heading swap, alignment/direction on the element. Call inside update().
type BlockFmtChange = {
  bold?: boolean; italic?: boolean; underline?: boolean;
  color?: string | null; clearFormatting?: boolean;
  level?: number; alignment?: string; direction?: "rtl" | "ltr";
};
function applyBlockFormat(json: string | undefined) {
  let payload: { indices?: number[]; changes?: BlockFmtChange };
  try { payload = JSON.parse(json || "{}"); } catch { return; }
  const indices = payload.indices || [];
  const ch = payload.changes || {};
  const roots = $getRoot().getChildren();
  for (const idx of indices) {
    const base = roots[idx];
    if (!base || !($isHeadingNode(base) || $isParagraphNode(base))) continue;
    let node: ElementNode = base;
    // level → paragraph⇄heading swap, preserving children + element format/dir
    if (ch.level !== undefined) {
      const wantHead = ch.level >= 1;
      const tag = ("h" + Math.min(ch.level, 6)) as HeadingTagType;
      const isHead = $isHeadingNode(node);
      if (wantHead !== isHead || ($isHeadingNode(node) && node.getTag() !== tag)) {
        const el: ElementNode = wantHead ? $createHeadingNode(tag) : $createParagraphNode();
        el.setFormat(node.getFormatType());
        const d = node.getDirection(); if (d) el.setDirection(d);
        el.append(...node.getChildren());
        node.replace(el);
        node = el;
      }
    }
    if (ch.alignment !== undefined) node.setFormat(ch.alignment as ElementFormatType);
    if (ch.direction !== undefined) node.setDirection(ch.direction);
    // inline marks on every text child (whole-block, matching patchRuns)
    for (const child of node.getChildren()) {
      if (!$isTextNode(child)) continue;
      (["bold", "italic", "underline"] as const).forEach((f) => {
        if (ch[f] !== undefined && child.hasFormat(f) !== ch[f]) child.toggleFormat(f);
      });
      if (ch.color !== undefined) child.setStyle(ch.color == null ? "" : `color: #${String(ch.color).replace(/^#/, "")}`);
      if (ch.clearFormatting) {
        (["bold", "italic", "underline"] as const).forEach((f) => { if (child.hasFormat(f)) child.toggleFormat(f); });
        child.setStyle("");
      }
    }
  }
}

// Rebuild the original block node from a suggestion's captured type/text — used to
// restore it when a proposal is rejected (approve routes through the sync layer,
// which reseeds the whole doc from server truth anyway).
function rebuildOriginal(text: string, origType: string) {
  const el =
    origType === "h1" || origType === "h2" || origType === "h3"
      ? $createHeadingNode(origType as HeadingTagType)
      : origType === "quote"
        ? $createQuoteNode()
        : $createParagraphNode();
  if (text) el.append($createTextNode(text));
  return el;
}

// Renders a pending AI proposal IN PLACE OF its block (matching the native
// InlineSuggestion — proposal as the paragraph, original teaser, ✓ Approve / ✕
// pill), driven by the native suggestion store via the `suggestion` prop. The
// SuggestionNode captures the replaced block's type so reject can restore it, and
// $lexicalToBlocks reports the original text for it (so a flush never drops the
// block). Approve/Reject dispatch commands that call back to `onSuggestAction`.
function SuggestionPlugin({
  suggestion,
  onSuggestAction,
}: {
  suggestion?: SuggestionInput;
  onSuggestAction?: (action: string, text?: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Which action last cleared the suggestion — decides whether the node settles to
  // the PROPOSED text (approve) or the ORIGINAL (reject). This lets approve apply
  // IN PLACE (one node) instead of triggering a full doc reseed, which is what was
  // scrolling the view to the document end.
  const lastActionRef = useRef<string>("");
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(SUGGEST_APPROVE_COMMAND, () => { lastActionRef.current = "approve"; onSuggestAction?.("approve"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_REJECT_COMMAND, () => { lastActionRef.current = "reject"; onSuggestAction?.("reject"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_AGAIN_COMMAND, () => { onSuggestAction?.("again"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_EDIT_COMMAND, (text) => { onSuggestAction?.("edit", text); return true; }, COMMAND_PRIORITY_LOW),
      ),
    [editor, onSuggestAction],
  );
  useEffect(() => {
    const mutate = () => {
      const root = $getRoot();
      const existing = root.getChildren().find($isSuggestionNode);
      // Cleared: settle the node in place — approve → the applied proposal, reject →
      // the untouched original. Doing it here (one node) means approve does NOT need
      // the sync-layer reseed (WorkspaceLexicalView skips it), so the view stays put.
      if (!suggestion || suggestion.index < 0) {
        if (existing) {
          const applied = lastActionRef.current === "approve";
          existing.replace(rebuildOriginal(applied ? existing.__sug.proposed : existing.__sug.original, existing.__origType));
          $setSelection(null);
        }
        lastActionRef.current = "";
        return;
      }
      const data: SugData = {
        original: suggestion.original,
        proposed: suggestion.proposed,
        status: suggestion.status,
        instruction: suggestion.instruction,
        label: suggestion.label,
        reasoning: suggestion.reasoning,
        reasoningMs: suggestion.reasoningMs,
      };
      if (existing) { existing.getWritable().__sug = data; return; } // stream in place
      const target = root.getChildren()[suggestion.index];
      if (target) {
        const origType = $isHeadingNode(target)
          ? target.getTag()
          : target.getType() === "quote"
            ? "quote"
            : "paragraph";
        // Detach the caret from the block we're about to replace — a RangeSelection
        // left pointing into a removed node makes Lexical throw during reconcile.
        $setSelection(null);
        target.replace($createSuggestionNode(data, origType));
      }
    };
    // Pin scroll ONLY when the node is created/removed (that's what moves layout);
    // an in-place stream update (existing __sug) must not fight the user's scroll.
    // On the CLEAR path (approve/reject) also blur: tapping the pill button focused
    // it, and removing it drops the caret at the document end → iOS scroll.
    const isClear = !suggestion || suggestion.index < 0;
    const structural = isClear || !suggestion.proposed;
    if (structural) withScrollPinned(editor, mutate, isClear);
    else editor.update(mutate, { tag: SKIP_DOM_SELECTION_TAG }); // stream in place — never touch focus/scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion?.index, suggestion?.proposed, suggestion?.status, suggestion?.reasoning, suggestion?.label]);
  return null;
}

export default function LexicalDomEditor({
  command,
  onState,
  onBlocks,
  initialBlocks,
  reseed,
  scrollToIndex,
  suggestion,
  onSuggestAction,
}: {
  command?: LexicalCommand | null;
  onState: (s: LexicalState) => void;
  // Serialized blocks emitted in response to a `serialize` command (round-trip test).
  onBlocks?: (blocks: DocBlockDTO[]) => void;
  // When provided, the editor is seeded FROM these blocks instead of the demo text.
  initialBlocks?: DocBlockDTO[];
  // In-place reconcile trigger: on nonce change, rebuild content from `blocks`
  // WITHOUT remounting (used to reflect external native/AI edits).
  reseed?: { blocks: DocBlockDTO[]; nonce: number };
  // Outline-drawer navigation: on nonce change, scroll the block at `index` into view.
  scrollToIndex?: { index: number; nonce: number };
  // Pending AI proposal to render in-flow, and its approve/reject callback.
  suggestion?: SuggestionInput;
  onSuggestAction?: (action: string, text?: string) => void;
  // Consumed by the Expo DOM runtime (WebView config); declared so native call
  // sites can pass it. Not read inside the component.
  dom?: import("expo/dom").DOMProps;
}) {
  const initialConfig = {
    namespace: "modakerati-lexical-lab",
    theme,
    onError: (error: Error) => console.error("[lexical]", error),
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, BlockDataNode, SuggestionNode],
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
        <EditorBridge command={command} onState={onState} onBlocks={onBlocks} reseed={reseed} scrollToIndex={scrollToIndex} />
        <SuggestionPlugin suggestion={suggestion} onSuggestAction={onSuggestAction} />
      </div>
    </LexicalComposer>
  );
}
