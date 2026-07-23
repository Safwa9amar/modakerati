import { create } from "zustand";
import { proposeCompletionStream, type CompletionContext } from "@/lib/thesis-suggest";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { DocBlockDTO } from "@/lib/api";

// One in-flight inline completion at a time. The editor's CompletionPlugin calls
// request({index,text}); we gate on the Settings toggle, assemble document context
// from the thesis doc store, stream the continuation, and expose it as {text,nonce}
// which WorkspaceLexicalView passes to the editor as the `completion` prop. Accept
// commits an editText op (coalesces with typing, syncs + undoes for free). A new
// request or cancel() aborts the previous fetch.

type Status = "idle" | "loading" | "done" | "error";

interface CompletionState {
  index: number;     // block being completed (-1 = none)
  text: string;      // streamed continuation so far
  status: Status;
  nonce: number;     // bumped per request; the editor keys the ghost on it
  controller: AbortController | null;
  request: (thesisId: string, index: number, text: string) => Promise<void>;
  accept: (thesisId: string, index: number, fullText: string) => void;
  cancel: () => void;
}

// Detect the block's language from its content (thesis.language is unreliable —
// imports default to "fr"). Arabic script ⇒ "ar"; otherwise fall back to the app
// language. Mirrors the RTL-from-content convention.
function detectLang(text: string): string {
  if (/[؀-ۿݐ-ݿࢠ-ࣿ]/.test(text)) return "ar";
  return useSettingsStore.getState().language;
}

// Plain text of a block for context. Only "paragraph" blocks (which also cover
// headings — there's no separate DocBlockDTO "heading" kind, just a `level` field
// on the paragraph) carry text; table/image/other contribute nothing.
function blockText(b: DocBlockDTO | undefined): string {
  return b?.kind === "paragraph" ? b.text : "";
}

// The nearest heading chain above `index` (outermost first). A paragraph block
// with level 1-6 is a heading; level 0 is body text.
function headingChain(blocks: DocBlockDTO[], index: number): string[] {
  const chain: string[] = [];
  let wantLevel = Infinity;
  for (let i = index - 1; i >= 0 && chain.length < 3; i--) {
    const b = blocks[i];
    const lvl = b?.kind === "paragraph" ? b.level : 0;
    if (lvl > 0 && lvl < wantLevel) { chain.unshift(blockText(b)); wantLevel = lvl; }
  }
  return chain;
}

export const useCompletionStore = create<CompletionState>((set, get) => ({
  index: -1,
  text: "",
  status: "idle",
  nonce: 0,
  controller: null,

  request: async (thesisId, index, text) => {
    const enabled = useSettingsStore.getState().autocompleteEnabled;
    if (__DEV__) console.log(`[autocomplete] request FIRED index=${index} textLen=${text?.length ?? 0} enabled=${enabled}`);
    if (!enabled) { if (__DEV__) console.log("[autocomplete] skipped — setting is OFF"); return; }
    get().controller?.abort();
    const controller = new AbortController();
    const nonce = get().nonce + 1;
    set({ index, text: "", status: "loading", nonce, controller });

    const doc = useThesisDocStore.getState().byId[thesisId];
    const blocks: DocBlockDTO[] = doc?.available ? doc.blocks : [];
    const preceding = blocks.slice(Math.max(0, index - 8), index).map(blockText).filter(Boolean);
    const ctx: CompletionContext = {
      before: text,
      precedingBlocks: preceding,
      headingChain: headingChain(blocks, index),
      language: detectLang(text),
      title: doc?.available ? doc.title : undefined,
    };
    // Trace the autocomplete lifecycle in dev (Metro console). Grep "[autocomplete]".
    if (__DEV__)
      console.log(
        `[autocomplete] request index=${index} textLen=${text.length} preceding=${ctx.precedingBlocks.length} lang=${ctx.language} nonce=${nonce}`,
      );

    // Only THIS request may write results (not aborted / superseded).
    const isMine = () => get().nonce === nonce && get().status === "loading";
    let acc = "";
    try {
      await proposeCompletionStream(thesisId, ctx, (delta) => {
        acc += delta;
        if (isMine()) set({ text: acc });
      }, controller.signal);
      if (isMine()) {
        const final = acc.trim();
        set({ text: final, status: final ? "done" : "error", controller: null });
        if (__DEV__) console.log(`[autocomplete] result index=${index} chars=${final.length} status=${final ? "done" : "empty"}`);
      }
    } catch (e) {
      if (isMine()) set({ status: "error", controller: null });
      if (__DEV__) console.log(`[autocomplete] error index=${index}`, e);
    }
  },

  accept: (thesisId, index, fullText) => {
    if (__DEV__) console.log(`[autocomplete] accept index=${index} len=${fullText.length}`);
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text: fullText });
    get().controller?.abort();
    set({ index: -1, text: "", status: "idle", controller: null });
  },

  cancel: () => {
    if (__DEV__ && get().index >= 0) console.log("[autocomplete] cancel (dismiss/leave)");
    get().controller?.abort();
    set({ index: -1, text: "", status: "idle", controller: null });
  },
}));
