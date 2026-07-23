// AI TABLE proposal state — one in-flight/showing proposal at a time. The ✦
// AIDock (table chips / Ask) calls request(); the Lexical Writer renders the
// proposal as an in-place diff inside EditableTable and calls back approve /
// reject / again / retry through WorkspaceLexicalView. Memory-only by design:
// proposals are dismissible without answering and never persist.
//
// The request STREAMS: the model's reasoning arrives live (`thinking`, shown on
// the dimmed table like the paragraph inline suggestion), then the proposed-grid
// JSON. If the streamed JSON doesn't parse, falls back to the blocking
// /table-suggest (which carries the server-side repair retry). `thoughtMs`
// powers the "Thought for Xs" chip; a failure keeps `errorIndex` so the table
// shows an inline retry.
// Spec: docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md
import { create } from "zustand";
import { suggestTable, suggestTableStream } from "@/lib/thesis-suggest";
import { diffGrids, type TableDiff, type TableLayoutProposal } from "@/lib/table-diff";
import { useThesisDocStore } from "@/stores/thesis-doc-store";

export interface TableProposal {
  thesisId: string;
  index: number;
  instruction: string; // kept for "Again" (note appended)
  originalRows: string[][];
  originalLayout: { align: "left" | "center" | "right" | null; direction: "rtl" | "ltr"; header: boolean };
  newRows: string[][];
  layout?: TableLayoutProposal;
  /** Proposed per-cell shading (6-hex, null = unchanged), aligned with newRows. */
  fills?: (string | null)[][];
  /** Proposed per-cell FONT colors (6-hex, null = unchanged), aligned with newRows. */
  textColors?: (string | null)[][];
  diff: TableDiff;
  /** How long the model reasoned before the grid started, ms (chip label). */
  thoughtMs: number | null;
}

interface TableSuggestionState {
  proposal: TableProposal | null;
  /** Block index a request is in flight for (shimmer + thinking panel), or null. */
  loadingIndex: number | null;
  /** The reasoning streamed so far for the in-flight request. */
  thinking: string;
  error: string | null;
  /** Block index the last failure targeted — the table shows an inline retry. */
  errorIndex: number | null;
  request: (thesisId: string, index: number, instruction: string) => Promise<void>;
  /** Re-ask with an optional user note appended to the original instruction. */
  again: (note?: string) => Promise<void>;
  /** Re-run the last failed request (inline retry chip on the table). */
  retry: () => Promise<void>;
  clear: () => void;
}

// Module-level so a superseding request aborts the previous fetch (the store
// stays serializable-only). lastReq feeds retry().
let inflight: AbortController | null = null;
let lastReq: { thesisId: string; index: number; instruction: string } | null = null;

// Mirror of the server's grid validation (parse the streamed JSON app-side):
// strip fences, rows → rectangular string grid (ragged rows padded), size caps.
const MAX_ROWS = 60;
const MAX_COLS = 12;
const HEX6 = /^#?[0-9A-Fa-f]{6}$/;
// Parse an optional hex-color grid aligned to rows×width; invalid cells → null.
function parseColorGrid(v: unknown, rowCount: number, width: number): (string | null)[][] | undefined {
  if (!Array.isArray(v)) return undefined;
  const grid = v.slice(0, rowCount).map((fr) =>
    Array.isArray(fr)
      ? fr.slice(0, width).map((f) => (typeof f === "string" && HEX6.test(f) ? f.replace("#", "").toUpperCase() : null))
      : [],
  );
  return grid.some((fr) => fr.some((f) => f !== null)) ? grid : undefined;
}

function parseProposedGrid(
  raw: string,
): { rows: string[][]; layout?: TableLayoutProposal; fills?: (string | null)[][]; textColors?: (string | null)[][] } | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const obj = parsed as { rows?: unknown; layout?: unknown; fills?: unknown; textColors?: unknown };
  if (!Array.isArray(obj.rows) || obj.rows.length === 0 || obj.rows.length > MAX_ROWS) return null;
  const rows: string[][] = [];
  let width = 0;
  for (const r of obj.rows) {
    if (!Array.isArray(r)) return null;
    const cells = r.map((c) => (typeof c === "string" ? c : String(c ?? "")));
    width = Math.max(width, cells.length);
    rows.push(cells);
  }
  if (width === 0 || width > MAX_COLS) return null;
  for (const r of rows) while (r.length < width) r.push("");
  let layout: TableLayoutProposal | undefined;
  if (obj.layout && typeof obj.layout === "object") {
    const l = obj.layout as Record<string, unknown>;
    layout = {};
    if (l.alignment === "left" || l.alignment === "center" || l.alignment === "right") layout.alignment = l.alignment;
    if (l.direction === "rtl" || l.direction === "ltr") layout.direction = l.direction;
    if (typeof l.headerRow === "boolean") layout.headerRow = l.headerRow;
    if (typeof l.headerFill === "string" && HEX6.test(l.headerFill)) layout.headerFill = l.headerFill.replace("#", "").toUpperCase();
    if (typeof l.borders === "boolean") layout.borders = l.borders;
    if (l.borderStyle === "single" || l.borderStyle === "double" || l.borderStyle === "dashed" || l.borderStyle === "dotted" || l.borderStyle === "thick") layout.borderStyle = l.borderStyle;
    if (typeof l.borderSizePt === "number" && l.borderSizePt > 0 && l.borderSizePt <= 6) layout.borderSizePt = l.borderSizePt;
    if (typeof l.borderColor === "string" && HEX6.test(l.borderColor)) layout.borderColor = l.borderColor.replace("#", "").toUpperCase();
    if (Object.keys(layout).length === 0) layout = undefined;
  }
  // Optional per-cell background + font-color grids aligned with rows.
  const fills = parseColorGrid(obj.fills, rows.length, width);
  const textColors = parseColorGrid(obj.textColors, rows.length, width);
  return { rows, layout, fills, textColors };
}

export const useTableSuggestionStore = create<TableSuggestionState>((set, get) => ({
  proposal: null,
  loadingIndex: null,
  thinking: "",
  error: null,
  errorIndex: null,

  request: async (thesisId, index, instruction) => {
    // The ORIGINAL grid/style comes from the local doc DTO — same data the
    // Writer renders, so the diff baseline always matches what's on screen.
    const doc = useThesisDocStore.getState().byId[thesisId];
    const b = doc?.available ? doc.blocks[index] : null;
    if (!b || b.kind !== "table") return;
    const tb = b as typeof b & { align?: "left" | "center" | "right" | null; direction?: "rtl" | "ltr"; header?: boolean };
    const originalRows = b.rows.map((r) => r.map((c) => c.trim()));
    const originalLayout = { align: tb.align ?? null, direction: tb.direction ?? ("ltr" as const), header: !!tb.header };

    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    lastReq = { thesisId, index, instruction };
    set({ loadingIndex: index, thinking: "", error: null, errorIndex: null });

    const started = Date.now();
    let firstAnswerAt: number | null = null;
    let jsonBuf = "";
    let parsed: { rows: string[][]; layout?: TableLayoutProposal; fills?: (string | null)[][]; textColors?: (string | null)[][] } | null = null;
    try {
      await suggestTableStream(
        thesisId,
        index,
        instruction,
        {
          onReasoning: (delta) => {
            if (!ctrl.signal.aborted) set((s) => ({ thinking: s.thinking + delta }));
          },
          onProposed: (delta) => {
            if (firstAnswerAt == null) firstAnswerAt = Date.now();
            jsonBuf += delta;
          },
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      parsed = parseProposedGrid(jsonBuf);
    } catch {
      if (ctrl.signal.aborted) return;
      // Stream failed (network/HTTP) — the blocking fallback below still runs.
    }
    if (!parsed) {
      // Unparseable or failed stream → blocking endpoint (server repair retry).
      try {
        const res = await suggestTable(thesisId, index, instruction, ctrl.signal);
        if (ctrl.signal.aborted) return;
        parsed = { rows: res.rows, layout: res.layout, fills: res.fills, textColors: res.textColors };
      } catch (e) {
        if (ctrl.signal.aborted) return;
        set({ loadingIndex: null, error: e instanceof Error ? e.message : "suggest failed", errorIndex: index });
        return;
      }
    }
    set({
      proposal: {
        thesisId,
        index,
        instruction,
        originalRows,
        originalLayout,
        newRows: parsed.rows,
        layout: parsed.layout,
        fills: parsed.fills,
        textColors: parsed.textColors,
        diff: diffGrids(originalRows, parsed.rows),
        thoughtMs: firstAnswerAt != null ? firstAnswerAt - started : Date.now() - started,
      },
      loadingIndex: null,
    });
  },

  again: async (note) => {
    const p = get().proposal;
    if (!p) return;
    const instruction = note?.trim() ? `${p.instruction}\n\nFollow-up: ${note.trim()}` : p.instruction;
    // Keep the current proposal visible (dimmed by the loading state) until the
    // new one lands or errors.
    await get().request(p.thesisId, p.index, instruction);
  },

  retry: async () => {
    if (!lastReq) return;
    await get().request(lastReq.thesisId, lastReq.index, lastReq.instruction);
  },

  clear: () => {
    inflight?.abort();
    inflight = null;
    set({ proposal: null, loadingIndex: null, thinking: "", error: null, errorIndex: null });
  },
}));
