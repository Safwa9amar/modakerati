import { create } from "zustand";
import type { SearchMatch } from "@/lib/search-match";

export type SemanticHit = {
  blockIndex: number;
  headingPath: string | null;
  snippet: string;
  score: number;
};

interface SearchState {
  open: boolean;
  query: string;
  replaceText: string;
  replaceOpen: boolean;
  matches: SearchMatch[];
  // matches grouped per block — rebuilt ONLY in setMatches so per-block array
  // refs stay stable across unrelated updates (DocBlock selects one entry).
  matchesByBlock: Record<number, SearchMatch[]>;
  capped: boolean;
  current: number; // index into matches; -1 = none
  semantic: SemanticHit[] | null; // null = not run yet for this query
  semanticLoading: boolean;
  semanticError: boolean;
  semanticIndexing: boolean; // server said the RAG index is (re)building

  openSearch: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  setReplaceText: (t: string) => void;
  toggleReplace: () => void;
  setMatches: (matches: SearchMatch[], capped: boolean) => void;
  setCurrent: (i: number) => void;
  semanticStart: () => void;
  semanticDone: (hits: SemanticHit[], indexing: boolean) => void;
  semanticFail: () => void;
}

const INITIAL = {
  open: false,
  query: "",
  replaceText: "",
  replaceOpen: false,
  matches: [] as SearchMatch[],
  matchesByBlock: {} as Record<number, SearchMatch[]>,
  capped: false,
  current: -1,
  semantic: null as SemanticHit[] | null,
  semanticLoading: false,
  semanticError: false,
  semanticIndexing: false,
};

export const useSearchStore = create<SearchState>((set) => ({
  ...INITIAL,

  openSearch: () => set({ open: true }),

  // Full reset — closing must leave zero highlight/replace state behind.
  close: () => set(INITIAL),

  // A new query invalidates any semantic results shown for the old one.
  setQuery: (q) =>
    set({ query: q, semantic: null, semanticError: false, semanticIndexing: false }),

  setReplaceText: (t) => set({ replaceText: t }),

  toggleReplace: () => set((s) => ({ replaceOpen: !s.replaceOpen })),

  setMatches: (matches, capped) =>
    set((s) => {
      const byBlock: Record<number, SearchMatch[]> = {};
      for (const m of matches) (byBlock[m.blockIndex] ??= []).push(m);
      const current =
        matches.length === 0 ? -1 : Math.min(Math.max(s.current, 0), matches.length - 1);
      return { matches, matchesByBlock: byBlock, capped, current };
    }),

  setCurrent: (i) => set({ current: i }),

  semanticStart: () =>
    set({ semanticLoading: true, semanticError: false, semanticIndexing: false }),

  semanticDone: (hits, indexing) =>
    set({ semantic: hits, semanticLoading: false, semanticIndexing: indexing }),

  semanticFail: () => set({ semanticLoading: false, semanticError: true }),
}));
