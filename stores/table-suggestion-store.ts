// AI TABLE proposal state — one in-flight/showing proposal at a time. The ✦
// AIDock (table chips / Ask) calls request(); the Lexical Writer renders the
// proposal as an in-place diff inside EditableTable and calls back approve /
// reject / again through WorkspaceLexicalView. Memory-only by design: proposals
// are dismissible without answering and never persist.
// Spec: docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md
import { create } from "zustand";
import { suggestTable } from "@/lib/thesis-suggest";
import { diffGrids, type TableDiff, type TableLayoutProposal } from "@/lib/table-diff";

export interface TableProposal {
  thesisId: string;
  index: number;
  instruction: string; // kept for "Again" (note appended)
  originalRows: string[][];
  originalLayout: { align: "left" | "center" | "right" | null; direction: "rtl" | "ltr"; header: boolean };
  newRows: string[][];
  layout?: TableLayoutProposal;
  diff: TableDiff;
}

interface TableSuggestionState {
  proposal: TableProposal | null;
  /** Block index a request is in flight for (shimmer), or null. */
  loadingIndex: number | null;
  error: string | null;
  request: (thesisId: string, index: number, instruction: string) => Promise<void>;
  /** Re-ask with an optional user note appended to the original instruction. */
  again: (note?: string) => Promise<void>;
  clear: () => void;
}

// Module-level so a superseding request aborts the previous fetch (the store
// stays serializable-only).
let inflight: AbortController | null = null;

export const useTableSuggestionStore = create<TableSuggestionState>((set, get) => ({
  proposal: null,
  loadingIndex: null,
  error: null,

  request: async (thesisId, index, instruction) => {
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    set({ loadingIndex: index, error: null });
    try {
      const res = await suggestTable(thesisId, index, instruction, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const diff = diffGrids(res.original.rows, res.rows);
      set({
        proposal: {
          thesisId,
          index,
          instruction,
          originalRows: res.original.rows,
          originalLayout: res.original.layout,
          newRows: res.rows,
          layout: res.layout,
          diff,
        },
        loadingIndex: null,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      set({ loadingIndex: null, error: e instanceof Error ? e.message : "suggest failed" });
    }
  },

  again: async (note) => {
    const p = get().proposal;
    if (!p) return;
    const instruction = note?.trim() ? `${p.instruction}\n\nFollow-up: ${note.trim()}` : p.instruction;
    // Keep the current proposal visible (dimmed by the loading state) until the
    // new one lands or errors.
    await get().request(p.thesisId, p.index, instruction);
  },

  clear: () => {
    inflight?.abort();
    inflight = null;
    set({ proposal: null, loadingIndex: null, error: null });
  },
}));
