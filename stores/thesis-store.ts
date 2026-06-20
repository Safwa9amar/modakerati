import { create } from "zustand";
import type {
  Thesis,
  Chapter,
  Section,
  Template,
  ThesisStatus,
  ChapterStatus,
} from "@/types/thesis";

interface ThesisState {
  theses: Thesis[];
  currentThesisId: string | null;
  templates: Template[];

  // Thesis actions
  createThesis: (
    title: string,
    templateId?: string,
    chapters?: string[]
  ) => Thesis;
  deleteThesis: (id: string) => void;
  updateThesis: (id: string, updates: Partial<Thesis>) => void;
  setCurrentThesis: (id: string | null) => void;
  getCurrentThesis: () => Thesis | null;

  // Chapter actions
  addChapter: (
    thesisId: string,
    title: string,
    afterIndex?: number
  ) => void;
  updateChapter: (
    thesisId: string,
    chapterId: string,
    updates: Partial<Chapter>
  ) => void;
  deleteChapter: (thesisId: string, chapterId: string) => void;
  reorderChapters: (thesisId: string, chapterIds: string[]) => void;

  // Section actions
  addSection: (
    thesisId: string,
    chapterId: string,
    title: string
  ) => void;
  updateSection: (
    thesisId: string,
    chapterId: string,
    sectionId: string,
    updates: Partial<Section>
  ) => void;
  deleteSection: (
    thesisId: string,
    chapterId: string,
    sectionId: string
  ) => void;

  // Templates
  loadTemplates: () => void;
}

const generateId = (): string =>
  Math.random().toString(36).substring(2, 10) +
  Math.random().toString(36).substring(2, 10);

export const useThesisStore = create<ThesisState>()(
    (set, get) => ({
      theses: [],
      currentThesisId: null,
      templates: [],

      createThesis: (title, templateId?, chapters?) => {
        const id = generateId();
        const now = new Date().toISOString();
        const defaultChapters = chapters ?? [
          "Introduction",
          "Literature Review",
          "Methodology",
          "Results",
          "Discussion",
          "Conclusion",
        ];

        const thesis: Thesis = {
          id,
          title,
          templateId,
          language: "fr",
          status: "active",
          progress: 0,
          wordCount: 0,
          pageCount: 0,
          chapters: defaultChapters.map((chapterTitle, index) => ({
            id: generateId(),
            thesisId: id,
            title: chapterTitle,
            orderIndex: index,
            status: "not_started" as ChapterStatus,
            sections: [],
          })),
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({ theses: [...state.theses, thesis] }));
        return thesis;
      },

      deleteThesis: (id) =>
        set((state) => ({
          theses: state.theses.filter((t) => t.id !== id),
          currentThesisId:
            state.currentThesisId === id ? null : state.currentThesisId,
        })),

      updateThesis: (id, updates) =>
        set((state) => ({
          theses: state.theses.map((t) =>
            t.id === id
              ? { ...t, ...updates, updatedAt: new Date().toISOString() }
              : t
          ),
        })),

      setCurrentThesis: (id) => set({ currentThesisId: id }),

      getCurrentThesis: () => {
        const { theses, currentThesisId } = get();
        return theses.find((t) => t.id === currentThesisId) ?? null;
      },

      addChapter: (thesisId, title, afterIndex?) =>
        set((state) => ({
          theses: state.theses.map((t) => {
            if (t.id !== thesisId) return t;
            const insertIndex =
              afterIndex !== undefined ? afterIndex + 1 : t.chapters.length;
            const newChapter: Chapter = {
              id: generateId(),
              thesisId,
              title,
              orderIndex: insertIndex,
              status: "not_started",
              sections: [],
            };
            const chapters = [...t.chapters];
            chapters.splice(insertIndex, 0, newChapter);
            // Reindex
            const reindexed = chapters.map((c, i) => ({
              ...c,
              orderIndex: i,
            }));
            return {
              ...t,
              chapters: reindexed,
              updatedAt: new Date().toISOString(),
            };
          }),
        })),

      updateChapter: (thesisId, chapterId, updates) =>
        set((state) => ({
          theses: state.theses.map((t) =>
            t.id !== thesisId
              ? t
              : {
                  ...t,
                  chapters: t.chapters.map((c) =>
                    c.id === chapterId ? { ...c, ...updates } : c
                  ),
                  updatedAt: new Date().toISOString(),
                }
          ),
        })),

      deleteChapter: (thesisId, chapterId) =>
        set((state) => ({
          theses: state.theses.map((t) => {
            if (t.id !== thesisId) return t;
            const chapters = t.chapters
              .filter((c) => c.id !== chapterId)
              .map((c, i) => ({ ...c, orderIndex: i }));
            return {
              ...t,
              chapters,
              updatedAt: new Date().toISOString(),
            };
          }),
        })),

      reorderChapters: (thesisId, chapterIds) =>
        set((state) => ({
          theses: state.theses.map((t) => {
            if (t.id !== thesisId) return t;
            const chapterMap = new Map(t.chapters.map((c) => [c.id, c]));
            const reordered = chapterIds
              .map((id, i) => {
                const chapter = chapterMap.get(id);
                return chapter ? { ...chapter, orderIndex: i } : null;
              })
              .filter(Boolean) as Chapter[];
            return {
              ...t,
              chapters: reordered,
              updatedAt: new Date().toISOString(),
            };
          }),
        })),

      addSection: (thesisId, chapterId, title) =>
        set((state) => ({
          theses: state.theses.map((t) =>
            t.id !== thesisId
              ? t
              : {
                  ...t,
                  chapters: t.chapters.map((c) => {
                    if (c.id !== chapterId) return c;
                    const newSection: Section = {
                      id: generateId(),
                      chapterId,
                      title,
                      content: "",
                      orderIndex: c.sections.length,
                      wordCount: 0,
                      status: "not_started",
                    };
                    return {
                      ...c,
                      sections: [...c.sections, newSection],
                    };
                  }),
                  updatedAt: new Date().toISOString(),
                }
          ),
        })),

      updateSection: (thesisId, chapterId, sectionId, updates) =>
        set((state) => ({
          theses: state.theses.map((t) =>
            t.id !== thesisId
              ? t
              : {
                  ...t,
                  chapters: t.chapters.map((c) =>
                    c.id !== chapterId
                      ? c
                      : {
                          ...c,
                          sections: c.sections.map((s) =>
                            s.id === sectionId ? { ...s, ...updates } : s
                          ),
                        }
                  ),
                  updatedAt: new Date().toISOString(),
                }
          ),
        })),

      deleteSection: (thesisId, chapterId, sectionId) =>
        set((state) => ({
          theses: state.theses.map((t) =>
            t.id !== thesisId
              ? t
              : {
                  ...t,
                  chapters: t.chapters.map((c) =>
                    c.id !== chapterId
                      ? c
                      : {
                          ...c,
                          sections: c.sections
                            .filter((s) => s.id !== sectionId)
                            .map((s, i) => ({ ...s, orderIndex: i })),
                        }
                  ),
                  updatedAt: new Date().toISOString(),
                }
          ),
        })),

      loadTemplates: () =>
        set({
          templates: [
            {
              id: "tpl-djelfa-master",
              university: "Universite de Djelfa",
              type: "Memoire de Master",
              language: "ar/fr",
              name: "Memoire de Master - Djelfa",
              config: {
                margins: {
                  top: "2.5cm",
                  bottom: "2.5cm",
                  left: "3cm",
                  right: "2cm",
                },
                bodyFont: "Traditional Arabic",
                bodySize: "14pt",
                headingFont: "Traditional Arabic",
                lineSpacing: "1.5",
                paperSize: "A4",
              },
              chapterStructure: [
                "Introduction Generale",
                "Chapitre 1 : Cadre Theorique",
                "Chapitre 2 : Etude de l'existant",
                "Chapitre 3 : Conception",
                "Chapitre 4 : Realisation",
                "Conclusion Generale",
              ],
            },
            {
              id: "tpl-usthb-doctorat",
              university: "USTHB Alger",
              type: "These de Doctorat",
              language: "fr",
              name: "These de Doctorat - USTHB",
              config: {
                margins: {
                  top: "2.5cm",
                  bottom: "2.5cm",
                  left: "3.5cm",
                  right: "2.5cm",
                },
                bodyFont: "Times New Roman",
                bodySize: "12pt",
                headingFont: "Times New Roman",
                lineSpacing: "1.5",
                paperSize: "A4",
              },
              chapterStructure: [
                "Introduction Generale",
                "Chapitre 1 : Etat de l'art",
                "Chapitre 2 : Problematique et Objectifs",
                "Chapitre 3 : Contribution",
                "Chapitre 4 : Experimentation et Resultats",
                "Chapitre 5 : Discussion",
                "Conclusion et Perspectives",
              ],
            },
            {
              id: "tpl-blida-licence",
              university: "Universite de Blida",
              type: "Memoire de Licence",
              language: "ar/fr",
              name: "Memoire de Licence - Blida",
              config: {
                margins: {
                  top: "2.5cm",
                  bottom: "2.5cm",
                  left: "3cm",
                  right: "2cm",
                },
                bodyFont: "Times New Roman",
                bodySize: "12pt",
                headingFont: "Times New Roman",
                lineSpacing: "1.5",
                paperSize: "A4",
              },
              chapterStructure: [
                "Introduction",
                "Chapitre 1 : Generalites",
                "Chapitre 2 : Methodologie",
                "Chapitre 3 : Resultats",
                "Conclusion",
              ],
            },
            {
              id: "tpl-esi-pfe",
              university: "ESI Alger",
              type: "PFE",
              language: "fr/en",
              name: "Projet de Fin d'Etudes - ESI",
              config: {
                margins: {
                  top: "2.5cm",
                  bottom: "2.5cm",
                  left: "3cm",
                  right: "2.5cm",
                },
                bodyFont: "Times New Roman",
                bodySize: "12pt",
                headingFont: "Arial",
                lineSpacing: "1.5",
                paperSize: "A4",
              },
              chapterStructure: [
                "Introduction Generale",
                "Chapitre 1 : Etude Preliminaire",
                "Chapitre 2 : Analyse et Specification",
                "Chapitre 3 : Conception",
                "Chapitre 4 : Implementation",
                "Chapitre 5 : Tests et Validation",
                "Conclusion Generale",
              ],
            },
            {
              id: "tpl-international-masters",
              university: "Generic International",
              type: "Master's Thesis",
              language: "en",
              name: "Master's Thesis - International",
              config: {
                margins: {
                  top: "1in",
                  bottom: "1in",
                  left: "1.5in",
                  right: "1in",
                },
                bodyFont: "Times New Roman",
                bodySize: "12pt",
                headingFont: "Arial",
                lineSpacing: "2.0",
                paperSize: "Letter",
              },
              chapterStructure: [
                "Introduction",
                "Literature Review",
                "Methodology",
                "Results",
                "Discussion",
                "Conclusion",
              ],
            },
          ],
        }),
    }));
