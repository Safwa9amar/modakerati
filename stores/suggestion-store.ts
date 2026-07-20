import { create } from "zustand";
import { proposeBlockEditStream, type SuggestAction } from "@/lib/thesis-suggest";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import i18n from "@/lib/i18n";

// The block kind the caller asks a suggestion for — decides the initial action
// (image → caption, else rewrite); the server's [[MODK_ACTION]] header confirms it.
type SuggestKind = "paragraph" | "image";

// Localised label shown at the top of the inline card so the student sees WHAT the
// approval will do ("Rewrite" vs "Add caption").
function actionLabel(action: SuggestAction): string {
  return action === "setCaption"
    ? i18n.t("suggestion.actionCaption", { defaultValue: "Add caption" })
    : i18n.t("suggestion.actionRewrite", { defaultValue: "Rewrite" });
}

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
  // Which unified action the approval applies: "rewrite" (paragraph) or
  // "setCaption" (figure). Initialised from the requested block kind, then
  // confirmed by the server's [[MODK_ACTION]] header. `approve` dispatches on it.
  action: SuggestAction;
  // Localised label for `action`, rendered at the top of the inline card.
  label: string;
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
  // Block index whose suggestion was JUST approved — the returning DocBlock
  // reads this to play a one-shot green settle flash, then clears it.
  justApplied: number | null;
  // Kick off a proposal for `index`: mark loading, call the server, then set the
  // proposed text (ready) or mark error. `original` is kept from the arg. `kind`
  // (default "paragraph") picks the initial action so an image asks for a caption.
  request: (thesisId: string, index: number, original: string, instruction: string, kind?: SuggestKind) => Promise<void>;
  // Apply a ready suggestion via the doc op queue, dispatching by action
  // (rewrite → editText, setCaption → setCaption), then drop it.
  approve: (thesisId: string, index: number) => void;
  // Dismiss a suggestion without applying it.
  reject: (index: number) => void;
  // Re-run the proposal with the stored original + instruction.
  again: (thesisId: string, index: number) => Promise<void>;
  // Edit the proposed text in place (inline editing of the suggestion).
  setProposed: (index: number, text: string) => void;
  // Clear the settle-flash marker (called by the flash animation when done).
  clearApplied: () => void;
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
  justApplied: null,

  request: async (thesisId, index, original, instruction, kind = "paragraph") => {
    const initialAction: SuggestAction = kind === "image" ? "setCaption" : "rewrite";
    set((s) => ({
      byIndex: {
        ...s.byIndex,
        [index]: {
          index, original, instruction, proposed: "", status: "loading", reasoning: "",
          action: initialAction, label: actionLabel(initialAction),
        },
      },
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
        onAction: (action) => {
          // The server confirms which action this is; update the label so the card
          // shows it. (Initial action from `kind` already covers the common case.)
          set((s) => {
            const cur = s.byIndex[index];
            if (!isMine(cur) || cur!.action === action) return {};
            return { byIndex: { ...s.byIndex, [index]: { ...cur!, action, label: actionLabel(action) } } };
          });
        },
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
    // Dispatch by action: a paragraph rewrite goes through editText (unchanged); a
    // figure caption goes through the new setCaption op. Both flow through the
    // durable op queue so they flush / reconcile like any other manual edit.
    const op =
      cur.action === "setCaption"
        ? ({ type: "setCaption", index, caption: cur.proposed } as const)
        : ({ type: "editText", index, text: cur.proposed } as const);
    void useThesisDocStore.getState().mutate(thesisId, op);
    set((s) => ({ byIndex: without(s.byIndex, index), justApplied: index }));
  },

  reject: (index) => set((s) => ({ byIndex: without(s.byIndex, index) })),

  again: async (thesisId, index) => {
    const cur = get().byIndex[index];
    if (!cur) return;
    // Re-run against the same block kind so the server picks the same action.
    const kind: SuggestKind = cur.action === "setCaption" ? "image" : "paragraph";
    await get().request(thesisId, index, cur.original, cur.instruction, kind);
  },

  setProposed: (index, text) =>
    set((s) => {
      const cur = s.byIndex[index];
      if (!cur) return {};
      return { byIndex: { ...s.byIndex, [index]: { ...cur, proposed: text } } };
    }),

  clearApplied: () => set({ justApplied: null }),

  clear: () => set({ byIndex: {}, justApplied: null }),
}));
