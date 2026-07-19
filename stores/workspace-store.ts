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
  // The engine block index whose paragraph is being edited inline in the OUTLINE
  // view (null = none). Distinct from selection: a block is first selected, then a
  // second tap promotes it to editing.
  editingBlockIndex: number | null;
  // After a split/merge moves editing to a different block, the caret position the
  // newly-editing block should open at (start of the new paragraph / the join
  // point). Consumed once by that block's TextInput, then cleared.
  pendingCaret: { index: number; pos: number } | null;
  activePanel: ActivePanel;
  isFormatting: boolean;
  viewMode: DocViewMode;
  thinkingEnabled: boolean;
  // Composer bottom-sheet mode: "ai" = chat/generation, "edit" = manual
  // block-level style/alignment tools. Only meaningful on a live-.docx thesis.
  composerMode: "ai" | "edit";
  // Whether the composer bottom sheet is shown. Toggled by the header button;
  // forced open when the AI starts working. When false the document reclaims the
  // full height (no reserved peek spacing).
  composerOpen: boolean;
  // True while one of the composer's OWN text inputs has focus. Gates the
  // composer's keyboard docking: other inputs on the screen (e.g. the Sources
  // sheet search) also raise the keyboard, and the composer must not react.
  composerInputFocused: boolean;

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
  setEditingBlock: (index: number | null, caretPos?: number) => void;
  clearPendingCaret: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: "sources" | "outline") => void;
  setFormatting: (v: boolean) => void;
  setViewMode: (mode: DocViewMode) => void;
  toggleViewMode: () => void;
  setThinkingEnabled: (v: boolean) => void;
  setComposerMode: (m: "ai" | "edit") => void;
  setComposerOpen: (open: boolean) => void;
  toggleComposer: () => void;
  setComposerInputFocused: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  thesisId: null as string | null,
  selectedBlocks: [] as SelectedBlock[],
  multiSelect: false,
  editingBlockIndex: null as number | null,
  pendingCaret: null as { index: number; pos: number } | null,
  activePanel: null as ActivePanel,
  isFormatting: false,
  viewMode: "docx" as DocViewMode,
  thinkingEnabled: true,
  composerMode: "ai" as "ai" | "edit",
  composerOpen: true,
  composerInputFocused: false,
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

  clearSelection: () => set({ selectedBlocks: [], multiSelect: false, editingBlockIndex: null, pendingCaret: null }),

  setEditingBlock: (index, caretPos) =>
    set({
      editingBlockIndex: index,
      pendingCaret: index != null && caretPos != null ? { index, pos: caretPos } : null,
    }),

  clearPendingCaret: () => set({ pendingCaret: null }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  togglePanel: (panel) => {
    const current = get().activePanel;
    set({ activePanel: current === panel ? null : panel });
  },

  setFormatting: (v) => set({ isFormatting: v }),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleViewMode: () => set({ viewMode: get().viewMode === "docx" ? "outline" : "docx" }),

  setThinkingEnabled: (v) => set({ thinkingEnabled: v }),

  setComposerMode: (m) => set({ composerMode: m }),

  setComposerOpen: (open) => set({ composerOpen: open }),

  toggleComposer: () => set((s) => ({ composerOpen: !s.composerOpen })),

  setComposerInputFocused: (v) => set({ composerInputFocused: v }),

  reset: () => set(INITIAL),
}));
