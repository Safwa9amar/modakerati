import { create } from "zustand";
import type { Thesis, Template, NormProfile } from "@/types/thesis";

interface ThesisState {
  theses: Thesis[];
  currentThesisId: string | null;
  templates: Template[];
  normProfiles: NormProfile[];

  setTheses: (theses: Thesis[]) => void;
  upsertThesis: (thesis: Thesis) => void;
  deleteThesis: (id: string) => void;
  setCurrentThesis: (id: string | null) => void;
  getCurrentThesis: () => Thesis | null;

  // Selection for the live-.docx workspace: the engine block index the student
  // tapped (+ its flat text), so an AI turn can target that exact paragraph.
  selected: { blockText: string | null; docBlockIndex: number | null };
  selectDocBlock: (docBlockIndex: number, blockText: string) => void;
  clearSelection: () => void;
  refreshThesis: (id: string) => Promise<void>;

  loadTemplates: () => Promise<void>;
  loadNormProfiles: () => Promise<void>;
}

export const useThesisStore = create<ThesisState>()((set, get) => ({
  theses: [],
  currentThesisId: null,
  templates: [],
  normProfiles: [],

  setTheses: (theses) => set({ theses }),
  upsertThesis: (thesis) => set((s) => ({
    theses: s.theses.some((t) => t.id === thesis.id)
      ? s.theses.map((t) => (t.id === thesis.id ? thesis : t))
      : [...s.theses, thesis],
  })),
  deleteThesis: (id) => set((s) => ({
    theses: s.theses.filter((t) => t.id !== id),
    currentThesisId: s.currentThesisId === id ? null : s.currentThesisId,
  })),
  setCurrentThesis: (id) => set({ currentThesisId: id }),
  getCurrentThesis: () => {
    const { theses, currentThesisId } = get();
    return theses.find((t) => t.id === currentThesisId) ?? null;
  },

  selected: { blockText: null, docBlockIndex: null },
  selectDocBlock: (docBlockIndex, blockText) => set({ selected: { blockText, docBlockIndex } }),
  clearSelection: () => set({ selected: { blockText: null, docBlockIndex: null } }),
  refreshThesis: async (id) => {
    try {
      const { getThesis } = await import("@/lib/api");
      const full = await getThesis(id);
      get().upsertThesis(full);
    } catch (e) {
      console.warn("refreshThesis failed", e);
    }
  },

  loadTemplates: async () => {
    try {
      const { listTemplates } = await import("@/lib/api");
      set({ templates: await listTemplates() });
    } catch {
      set({ templates: [] });
    }
  },

  loadNormProfiles: async () => {
    try {
      const { listNormProfiles } = await import("@/lib/api");
      const profiles = await listNormProfiles();
      set({ normProfiles: profiles });
    } catch (e) {
      console.error("Failed to load norm profiles:", e);
    }
  },
}));
