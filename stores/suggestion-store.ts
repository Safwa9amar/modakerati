import { create } from "zustand";
import { proposeBlockEdit } from "@/lib/thesis-suggest";
import { useThesisDocStore } from "@/stores/thesis-doc-store";

// Per-block pending AI suggestion: the student asks the AI to rewrite a single
// paragraph, the proposal appears INLINE on that block (see InlineSuggestion),
// and nothing is applied until they approve. Keyed by engine block index.
//
// The doc mutation (approve) is routed through the durable op queue via
// useThesisDocStore.mutate({ type: "editText" }) so it flushes / reconciles like
// any other manual edit. Removing a key always builds a NEW byIndex object
// (immutable update) so subscribers re-render.

type Status = "loading" | "ready" | "error";

export interface PendingSuggestion {
  index: number;
  original: string;
  proposed: string;
  instruction: string;
  status: Status;
}

interface SuggestionState {
  byIndex: Record<number, PendingSuggestion>;
  // Kick off a proposal for `index`: mark loading, call the server, then set the
  // proposed text (ready) or mark error. `original` is kept from the arg.
  request: (thesisId: string, index: number, original: string, instruction: string) => Promise<void>;
  // Apply a ready suggestion via the doc op queue (editText), then drop it.
  approve: (thesisId: string, index: number) => void;
  // Dismiss a suggestion without applying it.
  reject: (index: number) => void;
  // Re-run the proposal with the stored original + instruction.
  again: (thesisId: string, index: number) => Promise<void>;
  // Edit the proposed text in place (inline editing of the suggestion).
  setProposed: (index: number, text: string) => void;
  // Drop every pending suggestion (e.g. leaving the workspace).
  clear: () => void;
}

// Immutable delete: returns a new byIndex without `index` (or the same map when
// the key is absent, so no needless re-render).
function without(byIndex: Record<number, PendingSuggestion>, index: number): Record<number, PendingSuggestion> {
  if (!(index in byIndex)) return byIndex;
  const next = { ...byIndex };
  delete next[index];
  return next;
}

export const useSuggestionStore = create<SuggestionState>((set, get) => ({
  byIndex: {},

  request: async (thesisId, index, original, instruction) => {
    set((s) => ({
      byIndex: { ...s.byIndex, [index]: { index, original, instruction, proposed: "", status: "loading" } },
    }));
    try {
      const { proposed } = await proposeBlockEdit(thesisId, index, instruction);
      set((s) => {
        // The suggestion may have been rejected / superseded while in flight —
        // don't resurrect a dismissed one or clobber a newer request.
        const cur = s.byIndex[index];
        if (!cur || cur.status !== "loading" || cur.instruction !== instruction) return {};
        return { byIndex: { ...s.byIndex, [index]: { ...cur, proposed, status: "ready" } } };
      });
    } catch {
      set((s) => {
        const cur = s.byIndex[index];
        if (!cur || cur.status !== "loading") return {};
        return { byIndex: { ...s.byIndex, [index]: { ...cur, status: "error" } } };
      });
    }
  },

  approve: (thesisId, index) => {
    const cur = get().byIndex[index];
    if (!cur || cur.status !== "ready") return;
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text: cur.proposed });
    set((s) => ({ byIndex: without(s.byIndex, index) }));
  },

  reject: (index) => set((s) => ({ byIndex: without(s.byIndex, index) })),

  again: async (thesisId, index) => {
    const cur = get().byIndex[index];
    if (!cur) return;
    await get().request(thesisId, index, cur.original, cur.instruction);
  },

  setProposed: (index, text) =>
    set((s) => {
      const cur = s.byIndex[index];
      if (!cur) return {};
      return { byIndex: { ...s.byIndex, [index]: { ...cur, proposed: text } } };
    }),

  clear: () => set({ byIndex: {} }),
}));
