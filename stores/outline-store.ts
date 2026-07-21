import { create } from "zustand";
import { getThesisOutline, type OutlineDTO } from "@/lib/api";
import { getCachedOutline, setCachedOutline } from "@/lib/outline-cache";

// Owns the Thesis Structure outline per thesis so the navigator sheet opens
// INSTANTLY and WITHOUT a network round-trip. Two explicit operations:
//   • hydrate() — cache-only (in-memory, else SQLite). Never touches the network.
//     Called when the sheet OPENS, so viewing the outline is always free.
//   • sync()    — fetch from the server + persist to the cache. Called only when
//     the source actually changes: entering the thesis (workspace open) and after
//     the doc's headings change (an AI turn finishes / a manual edit drains).
//
// The server stays the source of truth; the sheet just renders the last synced
// copy. `byId[thesisId]` is undefined until first hydrate/sync.

interface OutlineState {
  byId: Record<string, OutlineDTO | undefined>;
  // Guards against overlapping network syncs for the same thesis.
  syncing: Record<string, boolean>;
  // Cache-only paint (memory → SQLite). No network. Use when the sheet opens.
  hydrate: (thesisId: string) => Promise<void>;
  // Network fetch + persist. Use on thesis-enter and on heading/doc changes only.
  sync: (thesisId: string) => Promise<void>;
  setOutline: (thesisId: string, outline: OutlineDTO) => void;
}

export const useOutlineStore = create<OutlineState>((set, get) => ({
  byId: {},
  syncing: {},

  hydrate: async (thesisId) => {
    // Already in memory (warmed by a prior sync this session) → nothing to do.
    if (get().byId[thesisId] !== undefined) return;
    const cached = await getCachedOutline(thesisId);
    // Guard against a sync that landed while we were reading SQLite.
    if (cached && get().byId[thesisId] === undefined) {
      set((s) => ({ byId: { ...s.byId, [thesisId]: cached } }));
    }
  },

  sync: async (thesisId) => {
    if (get().syncing[thesisId]) return;
    set((s) => ({ syncing: { ...s.syncing, [thesisId]: true } }));
    try {
      const outline = await getThesisOutline(thesisId);
      get().setOutline(thesisId, outline);
    } catch {
      // Keep the last synced/cached copy; a failed refresh must never blank the sheet.
    } finally {
      set((s) => ({ syncing: { ...s.syncing, [thesisId]: false } }));
    }
  },

  setOutline: (thesisId, outline) => {
    set((s) => ({ byId: { ...s.byId, [thesisId]: outline } }));
    void setCachedOutline(thesisId, outline);
  },
}));
