import { create } from "zustand";
import {
  proposeBlockEditStream,
  proposeRangeRewriteStream,
  applyThesisRangeReplace,
  type SuggestAction,
} from "@/lib/thesis-suggest";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
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

// A DYNAMIC range rewrite: the student selects 2+ blocks and asks the AI to rewrite
// the whole passage. Unlike a per-block suggestion (1:1 editText), the model returns
// a passage that may be ONE big paragraph or SEVERAL — the count follows the content.
// The proposal appears inline over the selected range (see the Lexical
// RangeSuggestionNode); approve replaces blocks [start..end] with the split
// paragraphs via the server's replace-range endpoint. Only ONE range suggestion is
// active at a time (you rewrite one selection).
export interface RangeSuggestion {
  start: number; // first block index of the range
  end: number; // last block index of the range (inclusive)
  indices: number[]; // the exact selected indices sent to the rewrite endpoint
  // The original blocks (text + block type) — kept so a serialize/flush while the
  // proposal is showing can restore them, and so reject rebuilds them in place.
  originalBlocks: { text: string; type: string }[];
  original: string; // combined original text (paragraphs joined by \n\n) for the diff
  proposed: string; // the streamed combined proposed passage
  instruction: string;
  status: Status;
  reasoning: string;
  reasoningMs?: number;
}

// paragraph level (0 body, 1-3 heading) → the Lexical block type used to rebuild it.
function levelToType(level?: number): string {
  return level && level >= 1 && level <= 3 ? `h${level}` : "paragraph";
}

interface SuggestionState {
  byIndex: Record<number, PendingSuggestion>;
  // The single active range rewrite (multi-block dynamic proposal), or null.
  range: RangeSuggestion | null;
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
  // ── Range rewrite (multi-block dynamic) ──
  // Kick off a range rewrite for the selected `blocks` (2+): stream the proposed
  // passage, then set it ready / error. Replaces any prior range suggestion.
  requestRange: (
    thesisId: string,
    blocks: { index: number; text: string; level?: number }[],
    instruction: string,
  ) => Promise<void>;
  // Apply the ready range rewrite: replace blocks [start..end] via the server with
  // the KEPT paragraphs (`keptText`, blank-line separated — the ones the student
  // didn't drop; defaults to the whole proposal), then reconcile the doc + clear.
  approveRange: (thesisId: string, keptText?: string) => Promise<void>;
  // Dismiss the range rewrite without applying it.
  rejectRange: () => void;
  // Re-run the range rewrite with the stored originals + instruction.
  againRange: (thesisId: string) => Promise<void>;
  // Edit the proposed passage in place before approving.
  setRangeProposed: (text: string) => void;
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
  range: null,
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
        // An empty rewrite (the model only "thought") or an UNCHANGED one (the
        // model returned the text verbatim) is an error, not a ready suggestion
        // — a "suggestion" with zero visible change would still offer an
        // Approve that pushes a no-op edit through the op queue.
        if (!finalText || finalText === cur!.original)
          return { byIndex: { ...s.byIndex, [index]: { ...cur!, reasoning, reasoningMs, status: "error" } } };
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

  // ── Range rewrite (multi-block dynamic) ──
  requestRange: async (thesisId, blocks, instruction) => {
    const sorted = [...blocks].sort((a, b) => a.index - b.index);
    const indices = sorted.map((b) => b.index);
    const start = indices[0];
    const end = indices[indices.length - 1];
    const originalBlocks = sorted.map((b) => ({ text: b.text, type: levelToType(b.level) }));
    const original = sorted.map((b) => b.text).join("\n\n");
    set({
      range: { start, end, indices, originalBlocks, original, proposed: "", instruction, status: "loading", reasoning: "" },
    });

    let reasoning = "";
    let proposed = "";
    let reasoningStart = 0;
    let reasoningMs: number | undefined;
    // Still the live request on this same range + instruction (not superseded).
    const isMine = () => {
      const r = get().range;
      return !!r && r.status === "loading" && r.instruction === instruction && r.start === start && r.end === end;
    };
    try {
      await proposeRangeRewriteStream(thesisId, indices, instruction, {
        onReasoning: (delta) => {
          if (!reasoningStart) reasoningStart = Date.now();
          reasoning += delta;
          set((s) => (isMine() && s.range ? { range: { ...s.range, reasoning } } : {}));
        },
        onProposed: (delta) => {
          if (reasoningStart && reasoningMs == null) reasoningMs = Date.now() - reasoningStart;
          proposed += delta;
          set((s) => (isMine() && s.range ? { range: { ...s.range, proposed } } : {}));
        },
      });
      if (reasoningStart && reasoningMs == null) reasoningMs = Date.now() - reasoningStart;
      const finalText = proposed.trim();
      set((s) => {
        if (!isMine() || !s.range) return {};
        // Empty (only-thinking) or unchanged passage → error, not a no-op proposal.
        if (!finalText || finalText === s.range.original.trim())
          return { range: { ...s.range, reasoning, reasoningMs, status: "error" } };
        return { range: { ...s.range, proposed: finalText, reasoning, reasoningMs, status: "ready" } };
      });
    } catch {
      set((s) => (s.range && s.range.status === "loading" ? { range: { ...s.range, status: "error" } } : {}));
    }
  },

  approveRange: async (thesisId, keptText) => {
    const r = get().range;
    if (!r || r.status !== "ready") return;
    // The kept paragraphs (blank-line separated) — dropped ones are already excluded
    // by the caller; fall back to the whole proposal when no explicit set is passed.
    const paragraphs = (keptText ?? r.proposed).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!paragraphs.length) return;
    // Apply on the server FIRST — keep the proposal node up during the call so the
    // editor's auto-save stays suppressed and NOTHING settles in place (an in-place
    // settle fired a spurious save that raced the reseed and reverted the change).
    // Then clear the range AND publish the echoed doc TOGETHER, so the sync layer
    // reseeds the editor to server truth in ONE write. Only clear on a real document
    // (a reseed is what removes the node), else surface the error on the card.
    try {
      const res = await applyThesisRangeReplace(thesisId, r.start, r.end, paragraphs);
      if (res.document) {
        set({ range: null });
        // Force the editor to reseed to this applied doc even if a debounced typing
        // save is pending — otherwise that save fires against a stale baseline and
        // reverts the change (the reported revert bug).
        useLexicalEditorStore.getState().requestForceReseed();
        useThesisDocStore.getState().setDoc(thesisId, res.document);
      } else {
        set((s) => (s.range ? { range: { ...s.range, status: "error" } } : {}));
      }
    } catch {
      set((s) => (s.range ? { range: { ...s.range, status: "error" } } : {}));
    }
  },

  rejectRange: () => set({ range: null }),

  againRange: async (thesisId) => {
    const r = get().range;
    if (!r) return;
    const blocks = r.originalBlocks.map((b, i) => ({
      index: r.indices[i],
      text: b.text,
      level: b.type === "h1" ? 1 : b.type === "h2" ? 2 : b.type === "h3" ? 3 : 0,
    }));
    await get().requestRange(thesisId, blocks, r.instruction);
  },

  setRangeProposed: (text) => set((s) => (s.range ? { range: { ...s.range, proposed: text } } : {})),

  clearApplied: () => set({ justApplied: null }),

  clear: () => set({ byIndex: {}, range: null, justApplied: null }),
}));
