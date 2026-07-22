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
} from "@lexical/list";
import { $setBlocksType, $patchStyleText } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isNodeSelection,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  type ElementFormatType,
  type TextFormatType,
} from "lexical";
import { $blocksToLexical, $lexicalToBlocks, BlockDataNode, $isBlockDataNode } from "./blockLexical";
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
    editor.update(() => { $blocksToLexical(reseed.blocks); });
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

  // Report the focused block (formats, index, text, screen-Y) to the native side
  // so the reused native pill / AI dock can attach to the Lexical selection.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let key: string | null = null;
      let payload: LexicalState = { bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, index: -1, text: "", y: -1 };
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        const anchor = sel.anchor.getNode();
        const top = anchor.getKey() === "root" ? null : anchor.getTopLevelElementOrThrow();
        let blockType = "paragraph";
        if (top) {
          if ($isHeadingNode(top)) blockType = top.getTag();
          else if ($isListNode(top)) blockType = top.getListType() === "bullet" ? "bullet" : "number";
          else blockType = top.getType(); // "paragraph" | "quote"
        }
        key = top ? top.getKey() : null;
        payload = {
          bold: sel.hasFormat("bold"),
          italic: sel.hasFormat("italic"),
          underline: sel.hasFormat("underline"),
          blockType,
          isRTL: !!top && top.getDirection() === "rtl",
          index: top ? $getRoot().getChildren().indexOf(top) : -1,
          text: top ? top.getTextContent() : "",
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

export default function LexicalDomEditor({
  command,
  onState,
  onBlocks,
  initialBlocks,
  reseed,
  scrollToIndex,
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
        <EditorBridge command={command} onState={onState} onBlocks={onBlocks} reseed={reseed} scrollToIndex={scrollToIndex} />
      </div>
    </LexicalComposer>
  );
}
