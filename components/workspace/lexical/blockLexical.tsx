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
import { $isListNode, $isListItemNode, $createListNode, $createListItemNode, type ListNode } from "@lexical/list";
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

// Media resolution for figures in the WebView. An authed <Image> header can't be
// set on a browser <img>, so a LARGE figure (bytes too big to inline as dataUri)
// loads via <img src=".../media/:index?token=JWT"> — image loads ignore CORS, and
// the auth middleware now accepts the token query param. Provided by the editor.
export const MediaContext = React.createContext<{ base: string; token: string; thesisId: string; version: string | number }>({
  base: "", token: "", thesisId: "", version: "",
});

const FIGURE_STYLE: React.CSSProperties = { maxWidth: "100%", maxHeight: "320px", borderRadius: "6px", display: "block", margin: "8px auto" };

// A figure: inline dataUri when the server sent it (small), else the authed media
// URL (large), else a placeholder (a drawing with no resolvable image).
function Figure({ block }: { block: Extract<DocBlockDTO, { kind: "image" }> }) {
  const media = React.useContext(MediaContext);
  if (block.dataUri) return React.createElement("img", { src: block.dataUri, style: FIGURE_STYLE, alt: block.caption ?? "" });
  if (block.hasMedia && media.base && media.token) {
    const url = `${media.base}/api/thesis/${media.thesisId}/document/media/${block.index}?token=${encodeURIComponent(media.token)}&v=${encodeURIComponent(String(media.version))}`;
    return React.createElement("img", { src: url, style: FIGURE_STYLE, alt: block.caption ?? "", referrerPolicy: "no-referrer" });
  }
  return React.createElement("div", { style: PLACEHOLDER }, `🖼 figure${block.caption ? ` · ${block.caption}` : ""}`);
}

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
      return React.createElement(Figure, { block: b });
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

function pillBtn(key: string, opts: { primary?: boolean; icon: string; label?: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return React.createElement(
    "button",
    {
      key,
      className: opts.primary ? "lx-sug-approve" : "lx-sug-icon" + (opts.danger ? " lx-sug-danger" : ""),
      title: opts.label,
      "aria-label": opts.label,
      tabIndex: -1,
      disabled: opts.disabled,
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
  // Play the exit animation, THEN dispatch (which settles/removes the node) — so
  // the absorb/drop motion is visible (native pillSink/pillDrop choreography).
  const [leaving, setLeaving] = React.useState<"" | "approve" | "reject">("");
  const loading = sug.status === "loading";
  const err = sug.status === "error";
  const ready = sug.status === "ready";
  const rootCls = "lx-sug" + (leaving ? " lx-leaving-" + leaving : "");
  const doApprove = () => { if (leaving) return; setLeaving("approve"); setTimeout(() => editor.dispatchCommand(SUGGEST_APPROVE_COMMAND, undefined), 190); };
  const doReject = () => { if (leaving) return; setLeaving("reject"); setTimeout(() => editor.dispatchCommand(SUGGEST_REJECT_COMMAND, undefined), 170); };

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
      { className: rootCls },
      chip,
      trace,
      React.createElement("div", { className: "lx-sug-proposed", dir: "auto" }, sug.original),
      React.createElement("div", { className: "lx-sug-err" }, "Couldn’t generate a suggestion."),
      pill([
        pillBtn("again", { primary: true, icon: ICON_AGAIN, label: "Again", onClick: () => editor.dispatchCommand(SUGGEST_AGAIN_COMMAND, undefined) }),
        pillBtn("reject", { danger: true, icon: ICON_X, label: "Reject", onClick: doReject }),
      ]),
    );
  }

  // ---- ready ----
  return React.createElement(
    "div",
    { className: rootCls },
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
      pillBtn("approve", { primary: true, icon: ICON_CHECK, label: "Approve", onClick: doApprove }),
      pillBtn("edit", { icon: ICON_PENCIL, label: "Edit", onClick: () => { setDraft(sug.proposed); setEditing(true); } }),
      pillBtn("again", { icon: ICON_AGAIN, label: "Again", onClick: () => editor.dispatchCommand(SUGGEST_AGAIN_COMMAND, undefined) }),
      pillBtn("reject", { danger: true, icon: ICON_X, label: "Reject", onClick: doReject }),
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

// ── AI RANGE suggestion node (multi-block dynamic rewrite) ────────────────────
// Occupies the WHOLE selected range: it replaces blocks [start..end] with a single
// node showing the AI's rewritten PASSAGE — which may be one paragraph or several
// (the count follows the content). Same card language as SuggestionNode, but the
// proposal renders as multiple passage paragraphs and there's no word-diff (a
// full-passage rewrite diffs poorly). Approve replaces the range via the server;
// reject / a flush restores the captured originals. Its own command set carries no
// index (only one range suggestion is ever active).
// Approve carries the KEPT passage (the paragraphs the student didn't drop, joined
// by blank lines) so the apply replaces the range with only those.
export const RANGE_APPROVE_COMMAND: LexicalCommand<string> = createCommand("RANGE_APPROVE");
export const RANGE_REJECT_COMMAND: LexicalCommand<void> = createCommand("RANGE_REJECT");
export const RANGE_AGAIN_COMMAND: LexicalCommand<void> = createCommand("RANGE_AGAIN");
export const RANGE_EDIT_COMMAND: LexicalCommand<string> = createCommand("RANGE_EDIT");
export type RangeData = {
  original: string; // combined original passage (paragraphs joined by \n\n)
  proposed: string; // combined proposed passage (paragraphs joined by \n\n)
  status: string; // "loading" | "ready" | "error"
  instruction: string;
  reasoning: string;
  reasoningMs?: number;
};
// The captured originals (text + block type) so a flush/reject restores them.
export type RangeOriginal = { text: string; type: string };
type SerializedRangeSuggestionNode = SerializedLexicalNode & { data: RangeData; originals: RangeOriginal[] };

// Split a combined passage on blank lines into its paragraph divs.
function renderPassage(text: string, cls: string): React.ReactNode {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const list = paras.length ? paras : [text];
  return React.createElement(
    "div",
    { className: "lx-sug-passage" },
    ...list.map((p, i) => React.createElement("div", { key: i, className: cls, dir: "auto" }, p)),
  );
}

function RangeSuggestionView({ data, editor }: { data: RangeData; editor: LexicalEditor }) {
  const [peek, setPeek] = React.useState(false);
  const [leaving, setLeaving] = React.useState<"" | "approve" | "reject">("");
  // The proposed paragraphs the student DROPPED (kept by default). Reset whenever the
  // proposal text changes (a fresh stream / Again), so a new result starts all-kept.
  const [dropped, setDropped] = React.useState<Set<number>>(new Set());
  React.useEffect(() => { setDropped(new Set()); }, [data.proposed]);

  const loading = data.status === "loading";
  const err = data.status === "error";
  const rootCls = "lx-sug" + (leaving ? " lx-leaving-" + leaving : "");

  // The dynamic paragraphs the AI produced (count follows the content).
  const paras = data.proposed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const kept = paras.filter((_, i) => !dropped.has(i));

  const doApprove = () => {
    if (leaving || !kept.length) return;
    const keptText = kept.join("\n\n");
    setLeaving("approve");
    setTimeout(() => editor.dispatchCommand(RANGE_APPROVE_COMMAND, keptText), 190);
  };
  const doReject = () => { if (leaving) return; setLeaving("reject"); setTimeout(() => editor.dispatchCommand(RANGE_REJECT_COMMAND, undefined), 170); };
  const toggleDrop = (i: number) =>
    setDropped((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const chip = React.createElement(
    "div",
    { className: "lx-sug-chip", dir: "auto" },
    svgIcon(ICON_SPARK, 12),
    React.createElement("span", { key: "t" }, data.instruction),
  );
  const trace = data.reasoning.trim()
    ? React.createElement(
        "details",
        { className: "lx-sug-trace" },
        React.createElement("summary", { key: "s" }, data.reasoningMs ? `Thought for ${Math.max(1, Math.round(data.reasoningMs / 1000))}s` : "Reasoning"),
        React.createElement("div", { key: "b", className: "lx-sug-trace-body", dir: "auto" }, data.reasoning),
      )
    : null;
  const pill = (children: React.ReactNode) =>
    React.createElement("div", { className: "lx-sug-pill" }, React.createElement("div", { className: "lx-sug-pillrow" }, children));

  // ---- loading ----
  if (loading) {
    return React.createElement(
      "div",
      { className: "lx-sug" },
      chip,
      trace,
      React.createElement("div", { className: "lx-sug-proposed lx-sug-loading", dir: "auto" }, data.proposed || data.original),
      pill(React.createElement("div", { className: "lx-sug-think" }, svgIcon(ICON_SPARK, 13), React.createElement("span", { key: "t" }, "Thinking…"))),
    );
  }

  // ---- error ----
  if (err) {
    return React.createElement(
      "div",
      { className: rootCls },
      chip,
      trace,
      renderPassage(data.original, "lx-sug-proposed lx-sug-ppara"),
      React.createElement("div", { className: "lx-sug-err" }, "Couldn’t generate a suggestion."),
      pill([
        pillBtn("again", { primary: true, icon: ICON_AGAIN, label: "Again", onClick: () => editor.dispatchCommand(RANGE_AGAIN_COMMAND, undefined) }),
        pillBtn("reject", { danger: true, icon: ICON_X, label: "Reject", onClick: doReject }),
      ]),
    );
  }

  // ---- ready: one row per DYNAMIC paragraph, each with a keep/drop toggle. Apply
  //      replaces the range with only the kept paragraphs. ----
  const rows = React.createElement(
    "div",
    { className: "lx-sug-passage" },
    ...paras.map((p, i) => {
      const isDropped = dropped.has(i);
      return React.createElement(
        "div",
        { key: i, className: "lx-sug-prow" },
        React.createElement("div", { className: "lx-sug-proposed lx-sug-ppara" + (isDropped ? " lx-sug-dropped" : ""), dir: "auto" }, p),
        React.createElement(
          "button",
          {
            className: "lx-sug-toggle" + (isDropped ? " on" : ""),
            title: isDropped ? "Keep" : "Drop",
            "aria-label": isDropped ? "Keep paragraph" : "Drop paragraph",
            tabIndex: -1,
            onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
            onClick: () => toggleDrop(i),
          },
          svgIcon(ICON_X, 15),
        ),
      );
    }),
  );

  const applyLabel = dropped.size ? `Apply ${kept.length}` : "Apply";
  return React.createElement(
    "div",
    { className: rootCls },
    chip,
    trace,
    rows,
    data.original.trim()
      ? React.createElement(
          "div",
          { className: "lx-sug-teaser", role: "button", onClick: () => setPeek((v) => !v) },
          React.createElement("div", { className: "lx-sug-teaser-txt" + (peek ? "" : " lx-sug-clamp"), dir: "auto" }, data.original),
        )
      : null,
    pill([
      pillBtn("apply", { primary: true, icon: ICON_CHECK, label: applyLabel, disabled: !kept.length, onClick: doApprove }),
      pillBtn("again", { icon: ICON_AGAIN, label: "Again", onClick: () => editor.dispatchCommand(RANGE_AGAIN_COMMAND, undefined) }),
      pillBtn("reject", { danger: true, icon: ICON_X, label: "Reject", onClick: doReject }),
    ]),
  );
}

export class RangeSuggestionNode extends DecoratorNode<React.ReactNode> {
  __data: RangeData;
  __originals: RangeOriginal[];
  static getType(): string { return "ai-range-suggestion"; }
  static clone(n: RangeSuggestionNode): RangeSuggestionNode { return new RangeSuggestionNode(n.__data, n.__originals, n.__key); }
  constructor(data: RangeData, originals: RangeOriginal[], key?: NodeKey) { super(key); this.__data = data; this.__originals = originals; }
  createDOM(): HTMLElement { const el = document.createElement("div"); el.style.margin = "4px 0"; return el; }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  decorate(editor: LexicalEditor): React.ReactNode { return React.createElement(RangeSuggestionView, { data: this.getLatest().__data, editor }); }
  exportJSON(): SerializedRangeSuggestionNode { return { ...super.exportJSON(), type: "ai-range-suggestion", version: 1, data: this.__data, originals: this.__originals }; }
  static importJSON(j: SerializedRangeSuggestionNode): RangeSuggestionNode { return new RangeSuggestionNode(j.data, j.originals ?? []); }
}
export function $createRangeSuggestionNode(data: RangeData, originals: RangeOriginal[]): RangeSuggestionNode { return new RangeSuggestionNode(data, originals); }
export function $isRangeSuggestionNode(n: LexicalNode | null | undefined): n is RangeSuggestionNode { return n instanceof RangeSuggestionNode; }

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
// Append a paragraph DTO's inline runs (text + bold/italic/underline/color) to an
// element — shared by plain paragraphs, headings, and list items.
function appendRuns(el: ElementNode, b: ParagraphDTO): void {
  for (const run of runsOf(b)) {
    const t = $createTextNode(run.text);
    if (run.bold) t.toggleFormat("bold");
    if (run.italic) t.toggleFormat("italic");
    if (run.underline) t.toggleFormat("underline");
    if (run.color) t.setStyle(`color: #${run.color.replace(/^#/, "")}`);
    el.append(t);
  }
}

// The list kind a paragraph belongs to (server read-back on the DTO; not in the
// base type, so read defensively — same convention as `runs`).
function blockList(b: DocBlockDTO): "bullet" | "number" | null {
  const l = (b as { list?: unknown }).list;
  return l === "bullet" || l === "number" ? l : null;
}

export function $blocksToLexical(blocks: DocBlockDTO[]): void {
  const root = $getRoot();
  root.clear();
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const lk = b.kind === "paragraph" ? blockList(b) : null;
    // A run of consecutive same-kind list paragraphs → ONE Lexical list.
    if (b.kind === "paragraph" && lk) {
      const listNode = $createListNode(lk === "number" ? "number" : "bullet");
      while (i < blocks.length && blocks[i].kind === "paragraph" && blockList(blocks[i]) === lk) {
        const bb = blocks[i] as ParagraphDTO;
        const li = $createListItemNode();
        appendRuns(li, bb);
        if (bb.direction) li.setDirection(bb.direction);
        listNode.append(li);
        i++;
      }
      root.append(listNode);
      continue;
    }
    if (b.kind === "paragraph") {
      const el: ElementNode =
        b.level >= 1
          ? $createHeadingNode(("h" + Math.min(b.level, 6)) as HeadingTagType)
          : $createParagraphNode();
      appendRuns(el, b);
      const fmt = b.alignment ? alignToFormat[b.alignment] : undefined;
      if (fmt) el.setFormat(fmt);
      if (b.direction) el.setDirection(b.direction);
      root.append(el);
    } else {
      root.append($createBlockDataNode(b));
    }
    i++;
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
    if ($isRangeSuggestionNode(node)) {
      // A range proposal occupies its WHOLE range's slot — serialize each captured
      // ORIGINAL block (unapplied) so a flush while it's showing restores the range.
      for (const o of node.__originals) {
        const level = o.type === "h1" ? 1 : o.type === "h2" ? 2 : o.type === "h3" ? 3 : 0;
        out.push({ index: 0, kind: "paragraph", text: o.text, styleId: level ? `Heading${level}` : "Normal", level, alignment: null, direction: null });
      }
      continue;
    }
    if ($isBlockDataNode(node)) {
      out.push({ ...node.getBlock() });
      continue;
    }
    if ($isHeadingNode(node) || $isParagraphNode(node)) {
      const level = $isHeadingNode(node) ? Number((node as HeadingNode).getTag().slice(1)) : 0;
      out.push($paraFromElement(node as ElementNode, level));
      continue;
    }
    // A Lexical list → ONE paragraph per list item (the DTO/server has no list
    // structure yet, so bullets don't persist across reload — but the CONTENT does,
    // and items are never mashed into a single block). Nested lists flatten.
    if ($isListNode(node)) {
      pushListItems(node, out);
      continue;
    }
    // Anything else unknown: flatten its text into a paragraph so it's never dropped.
    const text = node.getTextContent();
    if (text) {
      out.push({ index: 0, kind: "paragraph", text, styleId: "Normal", level: 0, alignment: null, direction: null });
    }
  }
  return out.map((b, i) => ({ ...b, index: i }));
}

// One paragraph DTO from a text-holding element (paragraph / heading / list item):
// gathers inline runs (bold/italic/underline/color) + flat text + block props.
function $paraFromElement(el: ElementNode, level: number): ParagraphDTO {
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
  return para;
}

// Serialize a list's items as separate paragraphs tagged with the list KIND
// (bullet/number) so the server can write Word numbering and it round-trips.
// Recurses nested lists (flattened to their own kind).
function pushListItems(list: ListNode, out: DocBlockDTO[]): void {
  const kind: "bullet" | "number" = list.getListType() === "number" ? "number" : "bullet";
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const nested = item.getChildren().find($isListNode);
    if (nested) { pushListItems(nested as ListNode, out); continue; }
    const para = $paraFromElement(item as unknown as ElementNode, 0);
    (para as { list?: "bullet" | "number" }).list = kind;
    out.push(para);
  }
}
