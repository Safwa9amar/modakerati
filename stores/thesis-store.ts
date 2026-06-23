import { create } from "zustand";
import type { Thesis, Section, Chapter, Template, SectionKind, ChapterStatus } from "@/types/thesis";

const generateId = (): string =>
  Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

interface ThesisState {
  theses: Thesis[];
  currentThesisId: string | null;
  templates: Template[];

  setTheses: (theses: Thesis[]) => void;
  upsertThesis: (thesis: Thesis) => void;
  deleteThesis: (id: string) => void;
  setCurrentThesis: (id: string | null) => void;
  getCurrentThesis: () => Thesis | null;

  addSection: (thesisId: string, title: string, kind?: SectionKind) => void;
  updateSection: (thesisId: string, sectionId: string, updates: Partial<Section>) => void;
  deleteSection: (thesisId: string, sectionId: string) => void;
  reorderSections: (thesisId: string, sectionIds: string[]) => void;

  addChapter: (thesisId: string, sectionId: string, title: string) => void;
  updateChapter: (thesisId: string, sectionId: string, chapterId: string, updates: Partial<Chapter>) => void;
  deleteChapter: (thesisId: string, sectionId: string, chapterId: string) => void;

  loadTemplates: () => Promise<void>;
}

export const useThesisStore = create<ThesisState>()((set, get) => ({
  theses: [],
  currentThesisId: null,
  templates: [],

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

  addSection: (thesisId, title, kind = "section") => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: [...t.sections, { id: generateId(), thesisId, title, kind, orderIndex: t.sections.length, chapters: [] }],
      updatedAt: new Date().toISOString(),
    }),
  })),
  updateSection: (thesisId, sectionId, updates) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t, sections: t.sections.map((sec) => sec.id === sectionId ? { ...sec, ...updates } : sec), updatedAt: new Date().toISOString(),
    }),
  })),
  deleteSection: (thesisId, sectionId) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t, sections: t.sections.filter((sec) => sec.id !== sectionId).map((sec, i) => ({ ...sec, orderIndex: i })), updatedAt: new Date().toISOString(),
    }),
  })),
  reorderSections: (thesisId, sectionIds) => set((s) => ({
    theses: s.theses.map((t) => {
      if (t.id !== thesisId) return t;
      const map = new Map(t.sections.map((sec) => [sec.id, sec]));
      const reordered = sectionIds.map((id, i) => { const sec = map.get(id); return sec ? { ...sec, orderIndex: i } : null; }).filter(Boolean) as Section[];
      return { ...t, sections: reordered, updatedAt: new Date().toISOString() };
    }),
  })),

  addChapter: (thesisId, sectionId, title) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: t.sections.map((sec) => sec.id !== sectionId ? sec : {
        ...sec,
        chapters: [...sec.chapters, { id: generateId(), sectionId, title, content: "", orderIndex: sec.chapters.length, wordCount: 0, status: "not_started" as ChapterStatus }],
      }),
      updatedAt: new Date().toISOString(),
    }),
  })),
  updateChapter: (thesisId, sectionId, chapterId, updates) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: t.sections.map((sec) => sec.id !== sectionId ? sec : {
        ...sec, chapters: sec.chapters.map((ch) => ch.id === chapterId ? { ...ch, ...updates } : ch),
      }),
      updatedAt: new Date().toISOString(),
    }),
  })),
  deleteChapter: (thesisId, sectionId, chapterId) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: t.sections.map((sec) => sec.id !== sectionId ? sec : {
        ...sec, chapters: sec.chapters.filter((ch) => ch.id !== chapterId).map((ch, i) => ({ ...ch, orderIndex: i })),
      }),
      updatedAt: new Date().toISOString(),
    }),
  })),

  loadTemplates: async () => {
    try {
      const { listTemplates } = await import("@/lib/api");
      set({ templates: await listTemplates() });
    } catch {
      set({ templates: [] });
    }
  },
}));
