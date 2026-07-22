// DocBlockDTO ⇄ Lexical conversions for the round-trip spike. This file runs in
// the WEB bundle only — it is imported EXCLUSIVELY by LexicalDomEditor.tsx (a
// 'use dom' component). Never import it from a native (non-dom) file, or Lexical
// + DOM globals get pulled into the native bundle.
//
// The point of the spike: prove that a thesis's blocks can become a Lexical tree
// and serialize back to the SAME blocks, so a real integration could persist
// through the existing op-queue / mdocxengine (.docx) pipeline. Text blocks
// (paragraph/heading + alignment + direction + inline runs) map to editable
// Lexical nodes; structural blocks (table/image/other) are carried OPAQUE in a
// BlockDataNode so they round-trip verbatim instead of being dropped.

import * as React from "react";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
  createCommand,
  DecoratorNode,
  type ElementNode,
  type ElementFormatType,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type TextNode,
} from "lexical";
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import type { DocBlockDTO } from "@/lib/api";

// The inline-run extension the paragraph DTO carries (not in the base type).
export type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
type ParagraphDTO = Extract<DocBlockDTO, { kind: "paragraph" }>;

// ── Opaque structural-block node (table / image / other) ─────────────────────
type SerializedBlockDataNode = SerializedLexicalNode & { block: DocBlockDTO };

const PLACEHOLDER: React.CSSProperties = {
  border: "1px dashed #b9c0d8",
  borderRadius: "8px",
  padding: "10px",
  color: "#5b6b8c",
  fontSize: "13px",
  background: "#f6f8ff",
};

export class BlockDataNode extends DecoratorNode<React.ReactNode> {
  __block: DocBlockDTO;

  static getType(): string {
    return "block-data";
  }
  static clone(node: BlockDataNode): BlockDataNode {
    return new BlockDataNode(node.__block, node.__key);
  }
  constructor(block: DocBlockDTO, key?: NodeKey) {
    super(key);
    this.__block = block;
  }
  getBlock(): DocBlockDTO {
    return this.getLatest().__block;
  }
  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = "margin:8px 0;";
    return el;
  }
  updateDOM(): false {
    return false;
  }
  isInline(): false {
    return false;
  }
  // Render the real content (table grid / inline image) so a real thesis LOOKS
  // right — while the block stays opaque to editing and round-trips verbatim via
  // __block. Large figures (media not inlined as dataUri) show a placeholder.
  decorate(): React.ReactNode {
    const b = this.__block;
    if (b.kind === "table") {
      return React.createElement(
        "table",
        { style: { borderCollapse: "collapse", width: "100%", fontSize: "13px", margin: "6px 0" } },
        React.createElement(
          "tbody",
          null,
          b.rows.map((row, ri) =>
            React.createElement(
              "tr",
              { key: ri },
              row.map((cell, ci) =>
                React.createElement("td", { key: ci, style: { border: "1px solid #d8d8de", padding: "4px 8px" } }, cell),
              ),
            ),
          ),
        ),
      );
    }
    if (b.kind === "image") {
      if (b.dataUri) {
        return React.createElement("img", {
          src: b.dataUri,
          style: { maxWidth: "100%", maxHeight: "320px", borderRadius: "6px", display: "block", margin: "8px auto" },
        });
      }
      return React.createElement(
        "div",
        { style: PLACEHOLDER },
        `🖼 figure${b.caption ? ` · ${b.caption}` : ""} · media not inlined`,
      );
    }
    return React.createElement("div", { style: PLACEHOLDER }, `⋯ ${b.kind === "other" ? b.tag : b.kind}`);
  }
  exportJSON(): SerializedBlockDataNode {
    return { ...super.exportJSON(), type: "block-data", version: 1, block: this.__block };
  }
  static importJSON(json: SerializedBlockDataNode): BlockDataNode {
    return new BlockDataNode(json.block);
  }
}

export function $createBlockDataNode(block: DocBlockDTO): BlockDataNode {
  return new BlockDataNode(block);
}
export function $isBlockDataNode(node: LexicalNode | null | undefined): node is BlockDataNode {
  return node instanceof BlockDataNode;
}

// ── AI suggestion node (transient inline proposal, in the content flow) ───────
export const SUGGEST_APPROVE_COMMAND: LexicalCommand<void> = createCommand("SUGGEST_APPROVE");
export const SUGGEST_REJECT_COMMAND: LexicalCommand<void> = createCommand("SUGGEST_REJECT");
export type SugData = { original: string; proposed: string; status: string };
type SerializedSuggestionNode = SerializedLexicalNode & { sug: SugData };

function SuggestionView({ sug, editor }: { sug: SugData; editor: LexicalEditor }) {
  const loading = sug.status === "loading" && !sug.proposed;
  const err = sug.status === "error";
  return React.createElement(
    "div",
    { className: "lx-sug" },
    React.createElement("div", { className: "lx-sug-head" }, "✦ AI suggestion"),
    React.createElement("div", { className: "lx-sug-body" }, err ? "Couldn’t generate a suggestion." : loading ? "thinking…" : sug.proposed || sug.original),
    React.createElement(
      "div",
      { className: "lx-sug-bar" },
      React.createElement("button", { className: "lx-sug-btn", onClick: () => editor.dispatchCommand(SUGGEST_REJECT_COMMAND, undefined) }, "Reject"),
      React.createElement(
        "button",
        { className: "lx-sug-btn lx-sug-ok", disabled: loading || err, onClick: () => editor.dispatchCommand(SUGGEST_APPROVE_COMMAND, undefined) },
        "Approve",
      ),
    ),
  );
}

export class SuggestionNode extends DecoratorNode<React.ReactNode> {
  __sug: SugData;
  static getType(): string { return "ai-suggestion"; }
  static clone(n: SuggestionNode): SuggestionNode { return new SuggestionNode(n.__sug, n.__key); }
  constructor(sug: SugData, key?: NodeKey) { super(key); this.__sug = sug; }
  createDOM(): HTMLElement { const el = document.createElement("div"); el.style.margin = "4px 0"; return el; }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  decorate(editor: LexicalEditor): React.ReactNode { return React.createElement(SuggestionView, { sug: this.getLatest().__sug, editor }); }
  exportJSON(): SerializedSuggestionNode { return { ...super.exportJSON(), type: "ai-suggestion", version: 1, sug: this.__sug }; }
  static importJSON(j: SerializedSuggestionNode): SuggestionNode { return new SuggestionNode(j.sug); }
}
export function $createSuggestionNode(sug: SugData): SuggestionNode { return new SuggestionNode(sug); }
export function $isSuggestionNode(n: LexicalNode | null | undefined): n is SuggestionNode { return n instanceof SuggestionNode; }

// ── Alignment mapping (engine "both" == Lexical "justify") ───────────────────
const alignToFormat: Partial<Record<NonNullable<ParagraphDTO["alignment"]>, ElementFormatType>> = {
  left: "left",
  center: "center",
  right: "right",
  both: "justify",
};
function formatToAlign(f: ElementFormatType): ParagraphDTO["alignment"] {
  return f === "left" ? "left" : f === "center" ? "center" : f === "right" ? "right" : f === "justify" ? "both" : null;
}

function runsOf(b: ParagraphDTO): ParaRun[] {
  const r = (b as { runs?: ParaRun[] }).runs;
  if (r && r.length) return r;
  return b.text ? [{ text: b.text }] : [];
}

// ── blocks → Lexical (call inside editor.update() / editorState init) ────────
export function $blocksToLexical(blocks: DocBlockDTO[]): void {
  const root = $getRoot();
  root.clear();
  for (const b of blocks) {
    if (b.kind === "paragraph") {
      const el: ElementNode =
        b.level >= 1
          ? $createHeadingNode(("h" + Math.min(b.level, 6)) as HeadingTagType)
          : $createParagraphNode();
      for (const run of runsOf(b)) {
        const t = $createTextNode(run.text);
        if (run.bold) t.toggleFormat("bold");
        if (run.italic) t.toggleFormat("italic");
        if (run.underline) t.toggleFormat("underline");
        if (run.color) t.setStyle(`color: #${run.color.replace(/^#/, "")}`);
        el.append(t);
      }
      const fmt = b.alignment ? alignToFormat[b.alignment] : undefined;
      if (fmt) el.setFormat(fmt);
      if (b.direction) el.setDirection(b.direction);
      root.append(el);
    } else {
      root.append($createBlockDataNode(b));
    }
  }
  if (root.getFirstChild() === null) root.append($createParagraphNode());
}

// ── Lexical → blocks (call inside editorState.read()) ────────────────────────
export function $lexicalToBlocks(): DocBlockDTO[] {
  const out: DocBlockDTO[] = [];
  for (const node of $getRoot().getChildren()) {
    if ($isSuggestionNode(node)) continue; // transient AI proposal — not a document block
    if ($isBlockDataNode(node)) {
      out.push({ ...node.getBlock() });
      continue;
    }
    if ($isHeadingNode(node) || $isParagraphNode(node)) {
      const el = node as ElementNode;
      const runs: ParaRun[] = [];
      let text = "";
      for (const child of el.getChildren()) {
        if ($isTextNode(child)) {
          const tn = child as TextNode;
          const run: ParaRun = { text: tn.getTextContent() };
          if (tn.hasFormat("bold")) run.bold = true;
          if (tn.hasFormat("italic")) run.italic = true;
          if (tn.hasFormat("underline")) run.underline = true;
          const m = /color:\s*#?([0-9a-fA-F]{6})/.exec(tn.getStyle());
          if (m) run.color = m[1].toUpperCase();
          runs.push(run);
          text += run.text;
        } else {
          text += child.getTextContent();
        }
      }
      const level = $isHeadingNode(node) ? Number((node as HeadingNode).getTag().slice(1)) : 0;
      const dir = el.getDirection();
      const para: ParagraphDTO = {
        index: 0,
        kind: "paragraph",
        text,
        styleId: level === 0 ? "Normal" : `Heading${level}`,
        level: Math.min(level, 6) as ParagraphDTO["level"],
        alignment: formatToAlign(el.getFormatType()),
        direction: dir === "rtl" || dir === "ltr" ? dir : null,
      };
      (para as { runs?: ParaRun[] }).runs = runs.length ? runs : [{ text }];
      out.push(para);
      continue;
    }
    // Anything else (e.g. a Lexical list — not representable in the block model):
    // flatten its text into a paragraph so it's never SILENTLY dropped. This is
    // the known-lossy case the round-trip screen flags.
    const text = node.getTextContent();
    if (text) {
      out.push({ index: 0, kind: "paragraph", text, styleId: "Normal", level: 0, alignment: null, direction: null });
    }
  }
  return out.map((b, i) => ({ ...b, index: i }));
}
