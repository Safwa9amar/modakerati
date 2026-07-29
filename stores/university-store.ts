import { create } from "zustand";
import type { University } from "@/types/thesis";

/**
 * The 130-institution catalogue, fetched once per session.
 *
 * It is small, public, and changes only when the server's seed changes, so there
 * is no reason to re-fetch it per screen — the picker at signup and the picker in
 * edit-profile share this one copy.
 *
 * NOTE for consumers: select primitives individually
 * (`useUniversityStore((s) => s.loaded)`), never a fresh object or array literal
 * from a selector — under Zustand v5's Object.is comparison that re-renders every
 * time and trips "Maximum update depth exceeded".
 */
interface UniversityState {
  universities: University[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  byId: (id: string | null | undefined) => University | null;
}

export const useUniversityStore = create<UniversityState>()((set, get) => ({
  universities: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    // Already have them, or a load is already in flight — don't stampede.
    if (get().loaded || get().loading) return;
    set({ loading: true, error: null });
    try {
      const { listUniversities } = await import("@/lib/api");
      const universities = await listUniversities();
      set({ universities, loaded: true, loading: false });
    } catch (e: any) {
      // Non-fatal: the picker degrades to "institution not listed" rather than
      // blocking signup entirely.
      set({ loading: false, error: e?.message ?? "Could not load universities" });
    }
  },

  byId: (id) => {
    if (!id) return null;
    return get().universities.find((u) => u.id === id) ?? null;
  },
}));
