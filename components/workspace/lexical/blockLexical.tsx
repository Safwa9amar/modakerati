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
  $createNodeSelection,
  $setSelection,
  $isParagraphNode,
  $isTextNode,
  createCommand,
  SKIP_DOM_SELECTION_TAG,
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
// type-only — table-diff must never enter the web bundle by value.
import type { TableDiff } from "@/lib/table-diff";

// The inline-run extension the paragraph DTO carries (not in the base type).
export type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
// Word table styling the server rides on the table DTO next to `rows` (see
// server parseTableStyle) — not on the base `lib/api` DocBlockDTO type.
export type TableStyleExtra = {
  align?: "left" | "center" | "right" | null;
  direction?: "rtl" | "ltr";
  header?: boolean;
  fills?: (string | null)[][];
};
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

// Provided by LexicalDomEditor (wired to the native silent table-op sync). A
// table cell calls it on commit → the block-model editCell op → server. null when
// editing isn't available (read-only contexts).
export const EditCellContext = React.createContext<
  ((blockIndex: number, row: number, col: number, text: string) => void) | null
>(null);

// ── AI table proposal (in-place diff) ────────────────────────────────────────
// The ✦ dock requested a table rewrite; the store holds ONE proposal (full new
// grid + precomputed diff). While it targets this table, EditableTable renders
// DIFF MODE instead of the editable grid; the pill routes approve/reject/again
// back to native. Spec: docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md
export interface TableProposalData {
  index: number;
  originalRows: string[][];
  newRows: string[][];
  diff: TableDiff;
  /** How long the model reasoned, ms — the "Thought for Xs" chip. */
  thoughtMs?: number | null;
  /** Proposed layout styling (headerFill previews on row 0). */
  layout?: { headerFill?: string } | null;
  /** Proposed per-cell 6-hex shading aligned with newRows (null = unchanged). */
  fills?: (string | null)[][] | null;
}
// Every user-visible proposal string, resolved NATIVE-side via i18next (the DOM
// bundle has no i18n instance) and passed through the tableLabels prop — the app
// is trilingual (ar/fr/en). English here is only the standalone fallback.
export interface TableAILabels {
  proposal: string;
  original: string;
  /** "{s}" is replaced with the whole seconds the model reasoned. */
  thought: string;
  thinking: string;
  approve: string;
  compare: string;
  showProposal: string;
  again: string;
  reject: string;
  send: string;
  notePlaceholder: string;
  failed: string;
  retry: string;
}
export const TABLE_AI_LABELS_EN: TableAILabels = {
  proposal: "AI suggestion",
  original: "Original — before changes",
  thought: "Thought for {s}s",
  thinking: "Thinking…",
  approve: "Approve",
  compare: "Compare",
  showProposal: "Proposal",
  again: "Again",
  reject: "Reject",
  send: "Send",
  notePlaceholder: "Note for the retry…",
  failed: "Suggestion failed",
  retry: "Retry",
};
export const TableProposalContext = React.createContext<{
  proposal: TableProposalData | null;
  loadingIndex: number | null;
  /** Reasoning streamed so far for the in-flight request (live thinking panel). */
  thinking: string;
  /** Block index the last failed request targeted → inline error + retry. */
  errorIndex: number | null;
  labels: TableAILabels;
  onAction: (action: "approve" | "reject" | "again" | "retry", note?: string) => void;
} | null>(null);

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

// The cell editor input. Focused via rAF AFTER React's commit phase — React's
// autoFocus focuses during commit, which fires the CE root's blur synchronously
// inside the React lifecycle; Lexical dispatches BLUR/FOCUS commands from it and
// its decorator listener then hits `flushSync was called from inside a lifecycle
// method`. An rAF focus runs outside the lifecycle, so those commands are legal.
function CellInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  return React.createElement("input", { ...props, ref });
}

// Diff colors for the AI table proposal (match the approved mockups).
const DIFF_ADD_BG = "#dcfce7";
const DIFF_EDIT_BG = "#fef3c7";
const DIFF_DEL_BG = "#fee2e2";

// Cap a column's width so long text wraps inside a sane column instead of
// stretching the row; the TABLE lays out at natural width and the wrapper
// scrolls horizontally when it exceeds the view (a wide table squeezed into the
// viewport otherwise wraps every cell to one character per line — unreadable).
const CELL_MAX_WIDTH = "220px";
function ScrollWrap({ children }: { children: React.ReactNode }) {
  return React.createElement(
    "div",
    // lx-tblscroll styles the scroll indicator in the brand accent (see the
    // editor CSS) so the "there's more table sideways" affordance is visible.
    { className: "lx-tblscroll", style: { overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" } },
    children,
  );
}

// One pill button of the proposal bar. mousedown preventDefault: a tap must not
// move DOM focus (same WKWebView scroll-to-top rule as the table cells).
function PillBtn({ label, tone, onPress }: { label: string; tone?: "ok" | "no"; onPress: () => void }) {
  const style: React.CSSProperties = {
    borderRadius: "999px",
    padding: "5px 14px",
    border: "1px solid #d4d4dc",
    background: "#fff",
    color: "#222",
    cursor: "pointer",
    // Buttons do NOT inherit the page font — the iOS WebView UA button font
    // can't shape Arabic and tofus the labels (see webview-arabic-font).
    font: "inherit",
    fontSize: "12px",
  };
  if (tone === "ok") { style.background = "#16a34a"; style.borderColor = "#16a34a"; style.color = "#fff"; }
  if (tone === "no") { style.background = "#fff1f1"; style.borderColor = "#fca5a5"; style.color = "#b91c1c"; }
  return React.createElement(
    "button",
    {
      style,
      onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); onPress(); },
      onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
    label,
  );
}

// The reasoning trace box (auto-scrolls to the newest text while streaming).
function TraceBox({ text }: { text: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return React.createElement(
    "div",
    {
      ref,
      dir: "auto",
      style: {
        maxHeight: "84px",
        overflowY: "auto",
        border: "1px solid #e4e4ea",
        borderRadius: "8px",
        padding: "6px 10px",
        fontSize: "11.5px",
        lineHeight: 1.5,
        color: "#6b7280",
        fontStyle: "italic",
        whiteSpace: "pre-wrap",
      },
    },
    text,
  );
}

// The ✦ chip that heads the thinking/proposal UI. When it owns a trace it acts
// as a disclosure control (▸/▾ — collapsed by default, the user toggles it).
function AIChip({ label, open, onToggle }: { label: string; open?: boolean; onToggle?: () => void }) {
  return React.createElement(
    onToggle ? "button" : "div",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        font: "inherit", // buttons don't inherit — UA font tofus Arabic
        fontSize: "11.5px",
        color: "#4f46e5",
        background: "#eef2ff",
        border: "none",
        borderRadius: "999px",
        padding: "3px 10px",
        marginBottom: "4px",
        cursor: onToggle ? "pointer" : "default",
      },
      onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); onToggle?.(); },
      onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
    onToggle ? `✦ ${label} ${open ? "▾" : "▸"}` : `✦ ${label}`,
  );
}

// Live reasoning while the model works — COLLAPSED by default (just the pulsing
// "✦ Thinking…" chip); tapping the chip expands the auto-scrolling trace.
// Mirrors the paragraph inline suggestion's collapsible ThinkingTrace.
function ThinkingPanel({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = React.useState(false);
  return React.createElement(
    "div",
    { style: { margin: "6px 0" } },
    React.createElement(AIChip, { label, open, onToggle: text ? () => setOpen((v) => !v) : undefined }),
    open && text ? React.createElement(TraceBox, { text }) : null,
  );
}

// DIFF MODE: the proposed grid with cell-level highlights + the action pill.
// Added rows/cols green; edited cells amber with the struck old value inside;
// removed rows/cols as red struck ghosts at their mapped positions. Compare
// toggles the plain ORIGINAL grid. Again opens a small note input.
function ProposalDiffTable({
  proposal,
  dir,
  loading,
  thinking,
  labels: L,
  onAction,
}: {
  proposal: TableProposalData;
  dir?: "rtl" | "ltr";
  loading: boolean;
  /** The full reasoning trace — the "Thought for Xs" chip toggles it (collapsed by default). */
  thinking: string;
  labels: TableAILabels;
  onAction: (action: "approve" | "reject" | "again" | "retry", note?: string) => void;
}) {
  const [compare, setCompare] = React.useState(false);
  const [againOpen, setAgainOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [traceOpen, setTraceOpen] = React.useState(false);
  const { originalRows, newRows, diff } = proposal;

  const edited = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const e of diff.editedCells) m.set(`${e.r},${e.c}`, e.oldText);
    return m;
  }, [diff]);

  // Interleave ghost (removed) rows at their mapped positions among the new rows.
  const rowEntries = React.useMemo(() => {
    const entries: ({ kind: "new"; r: number } | { kind: "ghost"; oldR: number })[] =
      newRows.map((_, r) => ({ kind: "new" as const, r }));
    for (const oldR of [...diff.removedRows].sort((a, b) => a - b)) {
      let pos = entries.length;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.kind === "new") {
          const m = diff.rowMap[e.r];
          if (m != null && m > oldR) { pos = i; break; }
        }
      }
      entries.splice(pos, 0, { kind: "ghost", oldR });
    }
    return entries;
  }, [newRows, diff]);

  const baseCell: React.CSSProperties = { border: "1px solid #c8c8d0", padding: "4px 8px", maxWidth: CELL_MAX_WIDTH };
  // Natural width inside a horizontal scroller — wide tables stay readable.
  const table = (body: React.ReactNode) =>
    React.createElement(
      ScrollWrap,
      null,
      React.createElement(
        "table",
        { style: { borderCollapse: "collapse", fontSize: "13px", margin: "6px 0", width: "max-content", minWidth: "100%" }, dir },
        React.createElement("tbody", null, body),
      ),
    );

  let grid: React.ReactNode;
  if (compare) {
    // The ORIGINAL, plain — "this is what you have now".
    grid = table(
      originalRows.map((row, ri) =>
        React.createElement("tr", { key: ri }, row.map((cell, ci) => React.createElement("td", { key: ci, style: baseCell }, cell))),
      ),
    );
  } else {
    grid = table(
      rowEntries.map((entry, ei) => {
        if (entry.kind === "ghost") {
          return React.createElement(
            "tr",
            { key: `g${entry.oldR}` },
            (originalRows[entry.oldR] ?? []).map((cell, ci) =>
              React.createElement(
                "td",
                { key: ci, style: { ...baseCell, backgroundColor: DIFF_DEL_BG, color: "#b91c1c", textDecoration: "line-through" } },
                cell,
              ),
            ),
          );
        }
        const r = entry.r;
        const rowAdded = diff.rowMap[r] == null;
        const cells = (newRows[r] ?? []).map((cell, c) => {
          const colAdded = diff.colMap[c] == null;
          const oldText = edited.get(`${r},${c}`);
          // Proposed COLOR for this cell (per-cell fills grid, or headerFill on
          // row 0) — the point of a "color the header/cells" ask is SEEING the
          // color; diff tints only cover cells whose TEXT also changed.
          const proposedFill =
            proposal.fills?.[r]?.[c] ?? (r === 0 && proposal.layout?.headerFill ? proposal.layout.headerFill : null);
          const style: React.CSSProperties = { ...baseCell };
          if (proposedFill) style.backgroundColor = `#${proposedFill.replace("#", "")}`;
          if (rowAdded || colAdded) style.backgroundColor = DIFF_ADD_BG;
          else if (oldText !== undefined) style.backgroundColor = DIFF_EDIT_BG;
          const content =
            oldText !== undefined && !rowAdded && !colAdded
              ? [
                  React.createElement(
                    "span",
                    { key: "o", style: { display: "block", fontSize: "10px", color: "#b91c1c", textDecoration: "line-through" } },
                    oldText,
                  ),
                  cell,
                ]
              : cell;
          return React.createElement("td", { key: c, style }, content);
        });
        // Ghost (removed) columns appended at the row's end, from the mapped old row.
        const oldR = diff.rowMap[r];
        const ghosts = diff.removedCols.map((oc) =>
          React.createElement(
            "td",
            { key: `gc${oc}`, style: { ...baseCell, backgroundColor: DIFF_DEL_BG, color: "#b91c1c", textDecoration: "line-through" } },
            oldR != null ? (originalRows[oldR]?.[oc] ?? "") : "",
          ),
        );
        return React.createElement("tr", { key: r }, [...cells, ...ghosts]);
      }),
    );
  }

  return React.createElement(
    "div",
    {
      className: loading ? "lx-tbl-loading" : undefined,
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
    React.createElement(AIChip, {
      label: compare
        ? L.original
        : proposal.thoughtMs != null
          ? L.thought.replace("{s}", String(Math.max(1, Math.round(proposal.thoughtMs / 1000))))
          : L.proposal,
      open: traceOpen,
      // The chip doubles as the trace disclosure (collapsed by default) when a
      // reasoning trace exists for this proposal.
      onToggle: thinking && !compare ? () => setTraceOpen((v) => !v) : undefined,
    }),
    traceOpen && thinking && !compare ? React.createElement(TraceBox, { text: thinking }) : null,
    grid,
    React.createElement(
      "div",
      { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" } },
      React.createElement(PillBtn, { label: `✓ ${L.approve}`, tone: "ok", onPress: () => onAction("approve") }),
      React.createElement(PillBtn, { label: `⇄ ${compare ? L.showProposal : L.compare}`, onPress: () => setCompare((v) => !v) }),
      React.createElement(PillBtn, { label: `↻ ${L.again}`, onPress: () => setAgainOpen((v) => !v) }),
      React.createElement(PillBtn, { label: `✕ ${L.reject}`, tone: "no", onPress: () => onAction("reject") }),
    ),
    againOpen
      ? React.createElement(
          "div",
          { style: { display: "flex", gap: "6px", marginTop: "6px" } },
          React.createElement("input", {
            value: note,
            placeholder: L.notePlaceholder,
            dir: "auto",
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value),
            onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") { e.preventDefault(); setAgainOpen(false); onAction("again", note); }
            },
            style: { flex: 1, border: "1px solid #d4d4dc", borderRadius: "8px", padding: "5px 10px", font: "inherit", fontSize: "12.5px" },
          }),
          React.createElement(PillBtn, { label: L.send, tone: "ok", onPress: () => { setAgainOpen(false); onAction("again", note); } }),
        )
      : null,
  );
}

// A Word-styled, in-place editable table. Renders the DTO's alignment / header /
// per-cell fills / direction (see server parseTableStyle) and lets the user edit a
// cell's text: DOUBLE-TAP a cell → inline input → commit (Enter / blur / switching
// cell) routes an editCell op through EditCellContext. SINGLE-tap still bubbles to
// the block-pick handler (selects the whole table → structure tools), so both
// gestures coexist. Cells preventDefault on mousedown so a tap NEVER moves DOM
// focus to the contentEditable root — a focused CE with no caret makes iOS
// WKWebView natively scroll to its start (= the document top), which was the
// "scrolls to top when I edit another cell" bug.
// While an AI proposal targets this table (TableProposalContext), renders
// ProposalDiffTable instead; while a request is loading, the current grid dims.
function EditableTable({
  block,
}: {
  block: Extract<DocBlockDTO, { kind: "table" }>;
}) {
  const onEditCell = React.useContext(EditCellContext);
  const tp = React.useContext(TableProposalContext);
  const [editing, setEditing] = React.useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = React.useState("");
  // Local overlay of committed cell edits. Committing shows the new value from
  // here IMMEDIATELY — the server sync then reconciles WITHOUT a full reseed
  // (which would rebuild the whole doc and scroll to the top). A real reseed
  // (structure edit / navigation) remounts this component, clearing the overlay;
  // by then the store's block carries the same edits, so they agree.
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const cellText = (r: number, c: number) => edits[`${r},${c}`] ?? block.rows[r]?.[c] ?? "";
  const t = block as typeof block & TableStyleExtra;
  const align = t.align ?? null;
  const header = !!t.header;
  const fills = t.fills;
  const dir = t.direction ?? undefined;

  // AI proposal targeting THIS table → diff mode (loading dims it in place; an
  // "Again" re-ask keeps the old proposal showing dimmed with the live thinking
  // under it until the new one lands).
  const proposalHere = tp?.proposal && tp.proposal.index === block.index ? tp.proposal : null;
  const loadingHere = tp?.loadingIndex === block.index;
  const errorHere = tp && tp.errorIndex === block.index && !proposalHere && !loadingHere;
  if (proposalHere && tp) {
    return React.createElement(
      "div",
      null,
      React.createElement(ProposalDiffTable, {
        proposal: proposalHere,
        dir,
        loading: loadingHere,
        thinking: tp.thinking,
        labels: tp.labels,
        onAction: tp.onAction,
      }),
      loadingHere ? React.createElement(ThinkingPanel, { text: tp.thinking, label: tp.labels.thinking }) : null,
    );
  }

  // Natural content width (capped per-cell) inside a horizontal scroller: a
  // wide table scrolls instead of squeezing to one character per line. An
  // unaligned table still stretches to fill the view (minWidth).
  const tableStyle: Record<string, unknown> = {
    borderCollapse: "collapse",
    fontSize: "13px",
    margin: "6px 0",
    width: "max-content",
    minWidth: align ? undefined : "100%",
  };
  if (align === "center") {
    tableStyle.marginLeft = "auto";
    tableStyle.marginRight = "auto";
  } else if (align === "right") {
    tableStyle.marginLeft = "auto";
    tableStyle.marginRight = "0";
  }

  // Commit the in-progress edit (if any). Plain function — NOT inside a state
  // updater (side effects there run during render and trip React warnings).
  const commit = () => {
    if (editing && draft !== cellText(editing.r, editing.c) && onEditCell) {
      setEdits((prev) => ({ ...prev, [`${editing.r},${editing.c}`]: draft })); // show it now, no reseed
      onEditCell(block.index, editing.r, editing.c, draft);
    }
    setEditing(null);
  };
  const startEdit = (r: number, c: number) => {
    if (!onEditCell) return;
    // Switching cells: commit the previous cell explicitly — its input's blur
    // won't fire (cell mousedown preventDefaults, so focus never leaves it until
    // the new input takes over).
    if (editing && draft !== cellText(editing.r, editing.c)) {
      setEdits((prev) => ({ ...prev, [`${editing.r},${editing.c}`]: draft }));
      onEditCell(block.index, editing.r, editing.c, draft);
    }
    setDraft(cellText(r, c));
    setEditing({ r, c });
  };

  const tableEl = React.createElement(
    "table",
    // While the AI request is thinking, dim + disable the grid in place.
    { style: tableStyle, dir, className: loadingHere ? "lx-tbl-loading" : undefined },
    React.createElement(
      "tbody",
      null,
      block.rows.map((row, ri) =>
        React.createElement(
          "tr",
          { key: ri },
          row.map((_cell, ci) => {
            const isHeader = header && ri === 0;
            const isEditing = editing?.r === ri && editing?.c === ci;
            const fill = fills?.[ri]?.[ci] ?? null;
            const cellStyle: Record<string, unknown> = {
              border: "1px solid #c8c8d0",
              padding: "4px 8px",
              maxWidth: CELL_MAX_WIDTH,
              cursor: onEditCell ? "text" : "default",
            };
            if (fill) cellStyle.backgroundColor = fill;
            else if (isHeader) cellStyle.backgroundColor = "#f0f0f3";
            if (isHeader) cellStyle.fontWeight = 600;
            const content = isEditing
              ? React.createElement(CellInput, {
                  value: draft,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
                  onBlur: commit,
                  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    else if (e.key === "Escape") setEditing(null);
                  },
                  // Keep events inside the input from re-triggering select/edit —
                  // and from the td's mousedown preventDefault (which would block
                  // caret placement inside the input itself).
                  onClick: (e: React.MouseEvent) => e.stopPropagation(),
                  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
                  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
                  style: {
                    width: "100%",
                    boxSizing: "border-box",
                    border: "none",
                    outline: "2px solid #5b6cff",
                    borderRadius: "3px",
                    padding: "2px 4px",
                    font: "inherit",
                    fontWeight: isHeader ? 600 : 400,
                    background: "#ffffff",
                    color: "#111114",
                    textAlign: dir === "rtl" ? "right" : "left",
                    direction: dir,
                  },
                })
              : cellText(ri, ci);
            return React.createElement(
              isHeader ? "th" : "td",
              {
                key: ci,
                style: cellStyle,
                // preventDefault on mousedown: a tap on a cell must NOT move DOM
                // focus (to the CE root) — that's what scrolled the WKWebView to
                // the document top. Click/dblclick still fire; the input's own
                // mousedown stopPropagations past this.
                onMouseDown: (e: React.MouseEvent) => { if (onEditCell) e.preventDefault(); },
                // Double-tap edits this cell; single-tap falls through to the
                // outer block-pick (table select). stopPropagation on the
                // double-tap so it doesn't also re-select mid-edit.
                onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); startEdit(ri, ci); },
              },
              content,
            );
          }),
        ),
      ),
    ),
  );

  const scrolled = React.createElement(ScrollWrap, null, tableEl);

  // In-flight request → live thinking under the dimmed grid; a failed request →
  // inline error strip with retry (not just a transient banner).
  if (loadingHere && tp) {
    return React.createElement(
      "div",
      null,
      scrolled,
      React.createElement(ThinkingPanel, { text: tp.thinking, label: tp.labels.thinking }),
    );
  }
  if (errorHere && tp) {
    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        {
          style: { display: "flex", alignItems: "center", gap: "8px", border: "1px solid #fca5a5", background: "#fff1f1", borderRadius: "10px", padding: "6px 10px", margin: "6px 0" },
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
        React.createElement("span", { style: { fontSize: "12px", color: "#b91c1c", flex: 1 } }, `⚠ ${tp.labels.failed}`),
        React.createElement(PillBtn, { label: `↻ ${tp.labels.retry}`, onPress: () => tp.onAction("retry") }),
        React.createElement(PillBtn, { label: "✕", tone: "no", onPress: () => tp.onAction("reject") }),
      ),
      scrolled,
    );
  }
  return scrolled;
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
    // Atomic island: the block is not rich-text-editable, so Lexical won't try to
    // manage a caret inside it. Form controls (the table cell <input>) inside a
    // contenteditable=false region stay interactive and keep their own focus, so
    // in-cell editing doesn't fight the editor for the selection.
    el.contentEditable = "false";
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
  // Wrapped in a tap-to-SELECT surface: a structural block can't hold a text caret,
  // so tapping it sets a NodeSelection → the native side shows THIS block's kind
  // tools (image/table/…), just like tapping a paragraph shows the text tools.
  decorate(editor: LexicalEditor): React.ReactNode {
    const b = this.__block;
    const key = this.getKey();
    let content: React.ReactNode;
    if (b.kind === "table") {
      // Word-styled + in-place editable table (alignment / header / per-cell fills
      // / direction from the DTO; double-tap a cell to edit). See EditableTable.
      content = React.createElement(EditableTable, { block: b });
    } else if (b.kind === "image") {
      content = React.createElement(Figure, { block: b });
    } else {
      content = React.createElement("div", { style: PLACEHOLDER }, `⋯ ${b.kind === "other" ? b.tag : b.kind}`);
    }
    // SKIP_DOM_SELECTION_TAG: selecting the block is for the NATIVE bubble only —
    // without it, Lexical's reconciler may re-focus the contentEditable root
    // (updateDOMSelection focus-restore), and iOS WKWebView natively scrolls to a
    // focused CE with no caret = jumps to the document top.
    const pick = () =>
      editor.update(
        () => {
          const ns = $createNodeSelection();
          ns.add(key);
          $setSelection(ns);
        },
        { tag: SKIP_DOM_SELECTION_TAG },
      );
    return React.createElement("div", { className: "lx-blockpick", onClick: pick }, content);
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

// ── Inline ghost-completion node (AI autocomplete) ────────────────────────────
// Inline ghost text for AI autocomplete. A DecoratorNode whose getTextContent() is
// "" → invisible to $lexicalToBlocks / serialization / the block model, so it NEVER
// enters the saved document until accepted. Rendered grey after the caret; a tap (or
// a swipe in the writing direction) dispatches ACCEPT_COMPLETION_COMMAND. Streamed
// text lives in __text and is updated in place.
export const ACCEPT_COMPLETION_COMMAND: LexicalCommand<void> = createCommand("ACCEPT_COMPLETION");
// Minimum horizontal drag (px) an accept-swipe must cross before it counts.
const GHOST_SWIPE_PX = 24;
type SerializedGhostCompletionNode = SerializedLexicalNode & { text: string };

export class GhostCompletionNode extends DecoratorNode<React.ReactNode> {
  __text: string;
  static getType(): string { return "ghost-completion"; }
  static clone(node: GhostCompletionNode): GhostCompletionNode { return new GhostCompletionNode(node.__text, node.__key); }
  constructor(text: string, key?: NodeKey) { super(key); this.__text = text; }
  isInline(): true { return true; }
  isKeyboardSelectable(): false { return false; }
  getTextContent(): string { return ""; } // invisible to the block model
  setText(text: string): void { this.getWritable().__text = text; }
  createDOM(): HTMLElement { const el = document.createElement("span"); el.style.display = "inline"; return el; }
  updateDOM(): false { return false; }
  decorate(editor: LexicalEditor): React.ReactNode {
    return React.createElement(GhostView, { text: this.getLatest().__text, editor });
  }
  exportJSON(): SerializedGhostCompletionNode { return { ...super.exportJSON(), type: "ghost-completion", version: 1, text: this.__text }; }
  static importJSON(json: SerializedGhostCompletionNode): GhostCompletionNode { return new GhostCompletionNode(json.text); }
}

function GhostView({ text, editor }: { text: string; editor: LexicalEditor }) {
  const startX = React.useRef(0);
  const accept = () => editor.dispatchCommand(ACCEPT_COMPLETION_COMMAND, undefined);
  return React.createElement("span", {
    className: "lx-ghost",
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); },
    onClick: accept,
    onTouchStart: (e: React.TouchEvent) => { startX.current = e.touches?.[0]?.clientX ?? 0; },
    onTouchEnd: (e: React.TouchEvent) => {
      const endX = e.changedTouches?.[0]?.clientX ?? startX.current;
      // preventDefault: without it, the WebView's touch→mouse emulation fires a
      // trailing synthetic click, which would call accept() again (double-dispatch).
      if (Math.abs(endX - startX.current) > GHOST_SWIPE_PX) { e.preventDefault(); accept(); }
    },
  }, text);
}

export function $createGhostCompletionNode(text: string): GhostCompletionNode { return new GhostCompletionNode(text); }
export function $isGhostCompletionNode(node: LexicalNode | null | undefined): node is GhostCompletionNode { return node instanceof GhostCompletionNode; }

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
