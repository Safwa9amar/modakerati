import { create } from "zustand";

export type ActivePanel = "sources" | "outline" | null;
// "docx" = Word-fidelity editor (OnlyOffice / docx-preview), "outline" = native
// block render, "pdf" = OnlyOffice-rendered PDF in a WebView (PDF.js). The PDF
// tool sets this directly; toggleViewMode only swaps the docx↔outline pair.
export type DocViewMode = "docx" | "outline" | "pdf";

/** One selected document block: its engine index + a snippet of its text. */
export interface SelectedBlock {
  index: number;
  text: string;
}

interface WorkspaceState {
  thesisId: string | null;
  // Ordered list of selected blocks (in selection order). [] = nothing selected.
  // A single tap yields a one-element list; long-press grows it (multiSelect mode).
  selectedBlocks: SelectedBlock[];
  // True once the student is building a MULTI-block selection (started by a
  // long-press). Drives whether a subsequent tap REPLACES the selection (single)
  // or TOGGLES the tapped block in/out of the set.
  multiSelect: boolean;
  activePanel: ActivePanel;
  isFormatting: boolean;
  viewMode: DocViewMode;
  thinkingEnabled: boolean;

  setThesis: (id: string) => void;
  // Single-select: replace the whole selection with just this block and exit
  // multi mode. Used by a normal tap, deep-links, and outline pre-selection.
  selectBlock: (index: number, text: string | null) => void;
  // Long-press: enter multi mode and ensure this block is in the set (keeps any
  // existing selection; no-op if the block is already selected).
  addToSelection: (index: number, text: string | null) => void;
  // Tap while in multi mode: add the block if absent, remove it if present.
  // Removing the last block drops back out of multi mode.
  toggleBlock: (index: number, text: string | null) => void;
  clearSelection: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: "sources" | "outline") => void;
  setFormatting: (v: boolean) => void;
  setViewMode: (mode: DocViewMode) => void;
  toggleViewMode: () => void;
  setThinkingEnabled: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  thesisId: null as string | null,
  selectedBlocks: [] as SelectedBlock[],
  multiSelect: false,
  activePanel: null as ActivePanel,
  isFormatting: false,
  viewMode: "docx" as DocViewMode,
  thinkingEnabled: true,
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...INITIAL,

  setThesis: (id) => set({ thesisId: id }),

  selectBlock: (index, text) =>
    set({ selectedBlocks: [{ index, text: text ?? "" }], multiSelect: false }),

  addToSelection: (index, text) =>
    set((s) => {
      const exists = s.selectedBlocks.some((b) => b.index === index);
      return {
        selectedBlocks: exists ? s.selectedBlocks : [...s.selectedBlocks, { index, text: text ?? "" }],
        multiSelect: true,
      };
    }),

  toggleBlock: (index, text) =>
    set((s) => {
      const exists = s.selectedBlocks.some((b) => b.index === index);
      const next = exists
        ? s.selectedBlocks.filter((b) => b.index !== index)
        : [...s.selectedBlocks, { index, text: text ?? "" }];
      // Removing the last block exits multi mode (back to single-tap behaviour).
      return { selectedBlocks: next, multiSelect: next.length > 0 };
    }),

  clearSelection: () => set({ selectedBlocks: [], multiSelect: false }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  togglePanel: (panel) => {
    const current = get().activePanel;
    set({ activePanel: current === panel ? null : panel });
  },

  setFormatting: (v) => set({ isFormatting: v }),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleViewMode: () => set({ viewMode: get().viewMode === "docx" ? "outline" : "docx" }),

  setThinkingEnabled: (v) => set({ thinkingEnabled: v }),

  reset: () => set(INITIAL),
}));
