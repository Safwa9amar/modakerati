import { create } from "zustand";
import {
  addSource as addSourceApi,
  deleteSource as deleteSourceApi,
  listSources,
} from "@/lib/api";
import type { ThesisSource } from "@/types/source";

// Stable empty array for the `?? EMPTY` default in selectors. Returning a fresh
// `[]` from a selector makes Zustand see a new reference every render and can
// trigger a "Maximum update depth exceeded" crash — never inline `?? []`.
const EMPTY: ThesisSource[] = [];

interface SourceState {
  // Sources keyed by thesis id so several theses can be cached independently.
  byThesis: Record<string, ThesisSource[]>;
  loading: boolean;
  load: (thesisId: string) => Promise<void>;
  // Insert a freshly-uploaded source at the top (matches server list ordering).
  add: (thesisId: string, source: ThesisSource) => void;
  // Optimistically drop a source; restore it on failure.
  remove: (thesisId: string, sourceId: string) => Promise<void>;
}

export const useSourceStore = create<SourceState>((set, get) => ({
  byThesis: {},
  loading: false,

  load: async (thesisId) => {
    set({ loading: true });
    try {
      const sources = await listSources(thesisId);
      set((state) => ({ byThesis: { ...state.byThesis, [thesisId]: sources } }));
    } catch {
      set((state) => ({ byThesis: { ...state.byThesis, [thesisId]: EMPTY } }));
    } finally {
      set({ loading: false });
    }
  },

  add: (thesisId, source) =>
    set((state) => ({
      byThesis: {
        ...state.byThesis,
        [thesisId]: [source, ...(state.byThesis[thesisId] ?? EMPTY)],
      },
    })),

  remove: async (thesisId, sourceId) => {
    const prev = get().byThesis[thesisId] ?? EMPTY;
    set((state) => ({
      byThesis: {
        ...state.byThesis,
        [thesisId]: prev.filter((s) => s.id !== sourceId),
      },
    }));
    try {
      await deleteSourceApi(thesisId, sourceId);
    } catch {
      set((state) => ({ byThesis: { ...state.byThesis, [thesisId]: prev } }));
    }
  },
}));
