import { create } from "zustand";

// Bridges the NATIVE formatting tools (BlockContextBar / bubble) to the Lexical
// Writer surface (WorkspaceLexicalView → LexicalDomEditor). The pill can't reach
// into the WebView directly, so it dispatches a serializable command here; the
// editor view subscribes and forwards it to the editor's `command` prop. The
// editor also reports the focused block's live format back here so the pill's
// active states (Bold on, H2, RTL, centered…) reflect the real Lexical selection.
//
// Formatting is WHOLE-BLOCK, matching the server's whole-paragraph `format` op
// (the pill applies the mark to every run of the selected block). The pill still
// persists through the durable op queue (mutate) exactly like the legacy composer;
// it also flags `skipReseed` so the optimistic doc change doesn't trigger a full
// Lexical rebuild — the editor already applied the change in place.

export interface LexicalFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: string; // paragraph | h1..h6 | quote | bullet | number
  isRTL: boolean;
  alignment: string | null; // left | center | right | justify | null
}

export interface LexicalCommand {
  type: string;
  value?: string;
  nonce: number;
}

const EMPTY_FORMAT: LexicalFormat = {
  bold: false,
  italic: false,
  underline: false,
  blockType: "paragraph",
  isRTL: false,
  alignment: null,
};

interface LexicalEditorState {
  // The latest command for the editor to run (nonce bumps per dispatch).
  command: LexicalCommand | null;
  // The focused block's live format (reported by the editor), for active states.
  format: LexicalFormat;
  // True while the Lexical Writer is the active surface (previewMode === null) —
  // the pill uses it to decide whether to route formatting to Lexical.
  active: boolean;
  // Consume-once flag: set right before a pill edit mutates the doc so the editor
  // view skips the reseed (it already applied the edit in place).
  skipReseed: boolean;
  dispatch: (type: string, value?: string) => void;
  setFormat: (f: LexicalFormat) => void;
  setActive: (a: boolean) => void;
  requestSkipReseed: () => void;
  consumeSkipReseed: () => boolean;
}

let nonce = 0;

// Cheap equality so setFormat only bumps state (→ pill re-render) on real changes.
function sameFormat(a: LexicalFormat, b: LexicalFormat): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.blockType === b.blockType &&
    a.isRTL === b.isRTL &&
    a.alignment === b.alignment
  );
}

export const useLexicalEditorStore = create<LexicalEditorState>((set, get) => ({
  command: null,
  format: EMPTY_FORMAT,
  active: false,
  skipReseed: false,
  dispatch: (type, value) => set({ command: { type, value, nonce: ++nonce } }),
  setFormat: (f) => {
    if (!sameFormat(get().format, f)) set({ format: f });
  },
  setActive: (a) => set({ active: a }),
  requestSkipReseed: () => set({ skipReseed: true }),
  consumeSkipReseed: () => {
    if (!get().skipReseed) return false;
    set({ skipReseed: false });
    return true;
  },
}));
