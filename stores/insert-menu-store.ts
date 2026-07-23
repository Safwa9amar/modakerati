import { create } from "zustand";

// The blocks the Insert menu can produce. Phase 1 wires the "ready" set; the
// Phase 2+ kinds are declared so the palette config and types are stable.
export type BlockKind =
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "bullet" | "number" // text (Lexical transform)
  | "figure" | "pageBreak"                              // structural (native op)
  | "table" | "divider" | "equation" | "toc" | "footnote"; // Phase 2+

// Where the menu blooms: the block index (for placement) + screen Y of that line
// (already computed by WorkspaceLexicalView.onState as editorTop + s.y).
export interface InsertAnchor { index: number; y: number; }

interface InsertMenuState {
  open: boolean;
  mode: "compact" | "full";
  query: string;            // live filter: in compact this is the /query text; in full, the search field
  anchor: InsertAnchor | null;
  recents: BlockKind[];     // most-recent-first, deduped, session-scoped (persistence deferred)
  openAt: (anchor: InsertAnchor, opts?: { query?: string }) => void;
  setQuery: (q: string) => void;
  setAnchor: (a: InsertAnchor) => void;
  expand: () => void;       // compact → full
  collapse: () => void;     // full → compact
  close: () => void;
  pushRecent: (kind: BlockKind) => void;
}

const RECENTS_MAX = 4;

export const useInsertMenuStore = create<InsertMenuState>((set, get) => ({
  open: false,
  mode: "compact",
  query: "",
  anchor: null,
  recents: [],
  openAt: (anchor, opts) => set({ open: true, mode: "compact", anchor, query: opts?.query ?? "" }),
  setQuery: (q) => set({ query: q }),
  setAnchor: (a) => set({ anchor: a }),
  expand: () => set({ mode: "full" }),
  collapse: () => set({ mode: "compact" }),
  close: () => set({ open: false, mode: "compact", query: "" }),
  pushRecent: (kind) =>
    set((s) => ({ recents: [kind, ...s.recents.filter((k) => k !== kind)].slice(0, RECENTS_MAX) })),
}));
