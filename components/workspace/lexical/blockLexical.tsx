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
import { diffWords, type DiffSegment } from "@/lib/word-diff";
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

// ── AI suggestion node (in-place proposal, replaces its block) ────────────────
// A faithful web port of the native InlineSuggestion: instruction chip, a
// "Thought for Xs" trace, the proposal AS the paragraph with a green logical-edge
// bar and word-level add-marks, the original as an expandable teaser (del-marks),
// and a white floating pill — Approve (green tint + dark ink) / Edit / Again /
// Reject; the error state swaps to Again / Reject. Same palette as the native.
export const SUGGEST_APPROVE_COMMAND: LexicalCommand<void> = createCommand("SUGGEST_APPROVE");
export const SUGGEST_REJECT_COMMAND: LexicalCommand<void> = createCommand("SUGGEST_REJECT");
export const SUGGEST_AGAIN_COMMAND: LexicalCommand<void> = createCommand("SUGGEST_AGAIN");
export const SUGGEST_EDIT_COMMAND: LexicalCommand<string> = createCommand("SUGGEST_EDIT");
export type SugData = {
  original: string;
  proposed: string;
  status: string; // "loading" | "ready" | "error"
  instruction: string;
  label: string;
  reasoning: string;
  reasoningMs?: number;
};
type SerializedSuggestionNode = SerializedLexicalNode & { sug: SugData; origType: string };

// Inline SVG glyphs — the WebView font tofus bare ✓/✕ chars (they showed as "?"),
// so draw them as stroked paths (lucide geometry) that always render.
function svgIcon(path: string, size: number) {
  return React.createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" },
    ...path.split("|").map((d, i) => React.createElement("path", { key: i, d })),
  );
}
const ICON_CHECK = "M20 6 9 17l-5-5";
const ICON_X = "M18 6 6 18|M6 6l12 12";
const ICON_PENCIL = "M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z";
const ICON_AGAIN = "M23 4v6h-6|M20.49 15a9 9 0 1 1-2.12-9.36L23 10";
const ICON_SPARK = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z";

// A word-diff run in the proposal (add) / teaser (del), or plain same-text.
function renderSegs(segs: DiffSegment[], kind: "add" | "del"): React.ReactNode {
  const cls = kind === "add" ? "lx-sug-add" : "lx-sug-del";
  return segs
    .filter((s) => s.kind !== (kind === "add" ? "del" : "add"))
    .map((s, k) =>
      s.kind === kind
        ? React.createElement("span", { key: k, className: cls }, s.text + " ")
        : React.createElement(React.Fragment, { key: k }, s.text + " "),
    );
}

function pillBtn(key: string, opts: { primary?: boolean; icon: string; label?: string; danger?: boolean; onClick: () => void }) {
  return React.createElement(
    "button",
    {
      key,
      className: opts.primary ? "lx-sug-approve" : "lx-sug-icon" + (opts.danger ? " lx-sug-danger" : ""),
      title: opts.label,
      "aria-label": opts.label,
      tabIndex: -1,
      // Don't let tapping the button focus it (→ caret lands in the editable → iOS
      // scrolls). preventDefault on pointer/mouse-down keeps focus where it is.
      onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
      onClick: opts.onClick,
    },
    svgIcon(opts.icon, opts.primary ? 15 : 16),
    opts.primary && opts.label ? React.createElement("span", { key: "t" }, opts.label) : null,
  );
}

function SuggestionView({ sug, editor }: { sug: SugData; editor: LexicalEditor }) {
  const [peek, setPeek] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const loading = sug.status === "loading";
  const err = sug.status === "error";
  const ready = sug.status === "ready";

  const segs = ready ? diffWords(sug.original, sug.proposed) : [];
  const hasMarks = segs.some((s) => s.kind === "same");

  // header: the instruction chip (✦ + what the student asked for)
  const chip = React.createElement(
    "div",
    { className: "lx-sug-chip", dir: "auto" },
    svgIcon(ICON_SPARK, 12),
    React.createElement("span", { key: "t" }, sug.instruction),
  );
  // "Thought for Xs" collapsible trace (native ThinkingTrace → <details>)
  const trace = sug.reasoning.trim()
    ? React.createElement(
        "details",
        { className: "lx-sug-trace" },
        React.createElement(
          "summary",
          { key: "s" },
          sug.reasoningMs ? `Thought for ${Math.max(1, Math.round(sug.reasoningMs / 1000))}s` : "Reasoning",
        ),
        React.createElement("div", { key: "b", className: "lx-sug-trace-body", dir: "auto" }, sug.reasoning),
      )
    : null;

  const pill = (children: React.ReactNode) =>
    React.createElement("div", { className: "lx-sug-pill" }, React.createElement("div", { className: "lx-sug-pillrow" }, children));

  // ---- editing (in place) ----
  if (ready && editing) {
    return React.createElement(
      "div",
      { className: "lx-sug" },
      chip,
      React.createElement("textarea", {
        className: "lx-sug-edit",
        dir: "auto",
        autoFocus: true,
        value: draft,
        onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      }),
      pill([
        pillBtn("done", { primary: true, icon: ICON_CHECK, label: "Done", onClick: () => { const t = draft.trim(); if (t) editor.dispatchCommand(SUGGEST_EDIT_COMMAND, t); setEditing(false); } }),
        pillBtn("cancel", { icon: ICON_X, label: "Cancel", onClick: () => setEditing(false) }),
      ]),
    );
  }

  // ---- loading ----
  if (loading) {
    return React.createElement(
      "div",
      { className: "lx-sug" },
      chip,
      trace,
      React.createElement("div", { className: "lx-sug-proposed lx-sug-loading", dir: "auto" }, sug.proposed || sug.original),
      pill(React.createElement("div", { className: "lx-sug-think" }, svgIcon(ICON_SPARK, 13), React.createElement("span", { key: "t" }, "Thinking…"))),
    );
  }

  // ---- error ----
  if (err) {
    return React.createElement(
      "div",
      { className: "lx-sug" },
      chip,
      trace,
      React.createElement("div", { className: "lx-sug-proposed", dir: "auto" }, sug.original),
      React.createElement("div", { className: "lx-sug-err" }, "Couldn’t generate a suggestion."),
      pill([
        pillBtn("again", { primary: true, icon: ICON_AGAIN, label: "Again", onClick: () => editor.dispatchCommand(SUGGEST_AGAIN_COMMAND, undefined) }),
        pillBtn("reject", { danger: true, icon: ICON_X, label: "Reject", onClick: () => editor.dispatchCommand(SUGGEST_REJECT_COMMAND, undefined) }),
      ]),
    );
  }

  // ---- ready ----
  return React.createElement(
    "div",
    { className: "lx-sug" },
    chip,
    trace,
    React.createElement(
      "div",
      { className: "lx-sug-proposed", dir: "auto" },
      hasMarks ? renderSegs(segs, "add") : sug.proposed,
    ),
    sug.original.trim()
      ? React.createElement(
          "div",
          { className: "lx-sug-teaser", role: "button", onClick: () => setPeek((v) => !v) },
          React.createElement(
            "div",
            { className: "lx-sug-teaser-txt" + (peek ? "" : " lx-sug-clamp"), dir: "auto" },
            peek && hasMarks ? renderSegs(segs, "del") : sug.original,
          ),
        )
      : null,
    pill([
      pillBtn("approve", { primary: true, icon: ICON_CHECK, label: "Approve", onClick: () => editor.dispatchCommand(SUGGEST_APPROVE_COMMAND, undefined) }),
      pillBtn("edit", { icon: ICON_PENCIL, label: "Edit", onClick: () => { setDraft(sug.proposed); setEditing(true); } }),
      pillBtn("again", { icon: ICON_AGAIN, label: "Again", onClick: () => editor.dispatchCommand(SUGGEST_AGAIN_COMMAND, undefined) }),
      pillBtn("reject", { danger: true, icon: ICON_X, label: "Reject", onClick: () => editor.dispatchCommand(SUGGEST_REJECT_COMMAND, undefined) }),
    ]),
  );
}

export class SuggestionNode extends DecoratorNode<React.ReactNode> {
  __sug: SugData;
  __origType: string; // the replaced block's type (paragraph|h1|h2|h3|quote) — for restore/serialize
  static getType(): string { return "ai-suggestion"; }
  static clone(n: SuggestionNode): SuggestionNode { return new SuggestionNode(n.__sug, n.__origType, n.__key); }
  constructor(sug: SugData, origType: string, key?: NodeKey) { super(key); this.__sug = sug; this.__origType = origType; }
  createDOM(): HTMLElement { const el = document.createElement("div"); el.style.margin = "4px 0"; return el; }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  decorate(editor: LexicalEditor): React.ReactNode { return React.createElement(SuggestionView, { sug: this.getLatest().__sug, editor }); }
  exportJSON(): SerializedSuggestionNode { return { ...super.exportJSON(), type: "ai-suggestion", version: 1, sug: this.__sug, origType: this.__origType }; }
  static importJSON(j: SerializedSuggestionNode): SuggestionNode { return new SuggestionNode(j.sug, j.origType ?? "paragraph"); }
}
export function $createSuggestionNode(sug: SugData, origType = "paragraph"): SuggestionNode { return new SuggestionNode(sug, origType); }
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
    if ($isSuggestionNode(node)) {
      // A pending proposal occupies its block's slot — serialize the ORIGINAL block
      // (unapplied) so a flush while it's showing never drops or mutates the block.
      const st = node.__origType;
      const level = st === "h1" ? 1 : st === "h2" ? 2 : st === "h3" ? 3 : 0;
      out.push({ index: 0, kind: "paragraph", text: node.__sug.original, styleId: level ? `Heading${level}` : "Normal", level, alignment: null, direction: null });
      continue;
    }
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
