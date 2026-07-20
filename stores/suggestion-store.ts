import { create } from "zustand";
import { proposeBlockEditStream } from "@/lib/thesis-suggest";
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
  // The model's reasoning ("thinking"), streamed live while `loading` and shown
  // in the collapsible ThinkingTrace on the inline card. Empty when the model
  // emits none (a short rewrite often does) — the card then just shows the spinner.
  reasoning: string;
  // How long the model spent reasoning, in ms — powers the "Thought for Xs" chip
  // once the suggestion is ready. Undefined when there was no reasoning.
  reasoningMs?: number;
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
      byIndex: { ...s.byIndex, [index]: { index, original, instruction, proposed: "", status: "loading", reasoning: "" } },
    }));
    // Accumulated locally; the store only holds the live reasoning (for the trace)
    // and, at the end, the final rewrite. Timing runs from the first reasoning
    // token to the first answer token → "Thought for Xs".
    let reasoning = "";
    let proposed = "";
    let reasoningStart = 0;
    let reasoningMs: number | undefined;
    // This request is still the one on `index` (not rejected / superseded by a
    // newer instruction while in flight).
    const isMine = (cur: PendingSuggestion | undefined) =>
      !!cur && cur.status === "loading" && cur.instruction === instruction;
    try {
      await proposeBlockEditStream(thesisId, index, instruction, {
        onReasoning: (delta) => {
          if (!reasoningStart) reasoningStart = Date.now();
          reasoning += delta;
          set((s) => {
            const cur = s.byIndex[index];
            if (!isMine(cur)) return {};
            return { byIndex: { ...s.byIndex, [index]: { ...cur!, reasoning } } };
          });
        },
        onProposed: (delta) => {
          // First answer token → reasoning is done; freeze its duration.
          if (reasoningStart && reasoningMs == null) reasoningMs = Date.now() - reasoningStart;
          proposed += delta;
        },
      });
      if (reasoningStart && reasoningMs == null) reasoningMs = Date.now() - reasoningStart;
      const finalText = proposed.trim();
      set((s) => {
        const cur = s.byIndex[index];
        if (!isMine(cur)) return {};
        // An empty rewrite (e.g. the model only "thought") is an error, not a
        // ready suggestion — don't show a blank green card.
        if (!finalText) return { byIndex: { ...s.byIndex, [index]: { ...cur!, reasoning, reasoningMs, status: "error" } } };
        return { byIndex: { ...s.byIndex, [index]: { ...cur!, proposed: finalText, reasoning, reasoningMs, status: "ready" } } };
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
