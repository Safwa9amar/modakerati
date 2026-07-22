import { create } from "zustand";

export type ActivePanel = "sources" | "outline" | null;
// The native outline ("the Writer") is the single editing surface. A read-only
// preview overlay may sit on top of it: "docx" = Word-fidelity pages (OnlyOffice /
// docx-preview), "pdf" = the OnlyOffice-converted PDF (PDF.js). null = writing
// (the Writer is active, no preview).
export type PreviewMode = "docx" | "pdf" | "lexical" | null;

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
  // True while a paragraph is being edited inline in EITHER doc view — the composer
  // sheet closes so it doesn't squeeze the editor + keyboard.
  inlineEditing: boolean;
  activePanel: ActivePanel;
  isFormatting: boolean;
  previewMode: PreviewMode;
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
  // Focus / typewriter mode: pure-styling toggle that dims every block EXCEPT the
  // one being worked on (the inline-edited block, else the single selected block)
  // to reduce distraction while writing. Does not touch the data model.
  focusMode: boolean;
  // True while the block-scoped "✦ Ask AI" input is open (the block-anchored AI
  // composer at the screen bottom). Lifted out of BlockComposer so the inline
  // block toolbar pill (rendered on the selected block) can open it, and so the
  // pill hides itself while the AI input is up. Reset on deselect / workspace leave.
  askAiOpen: boolean;
  // Pending "scroll the active doc view to this block" request. The active doc
  // layer (native outline / docx-preview) watches it and scrolls to `index`;
  // `nonce` bumps on every request so re-tapping the SAME heading re-scrolls.
  // Set by the outline sheet (tap a heading) and by a cold deep-link; null =
  // nothing pending. Reset on workspace leave.
  scrollTarget: { index: number; nonce: number } | null;
  // True while a heading-navigation jump is in flight. The workspace masks the
  // raw scroll with a fade + loader (so the user never sees the fly-through), then
  // clears this and flashes the target. Set by requestScrollToBlock.
  navigating: boolean;
  // One-shot "flash this block" pulse, fired when the jump lands so the eye finds
  // the heading. `nonce` re-fires it for a repeat navigation to the same block.
  flashTarget: { index: number; nonce: number } | null;
  // The block index currently at the top of the doc view (from the outline view's
  // viewability / scroll). The Structure drawer highlights the heading at/above it
  // so the user always sees where they are — a table-of-contents "you are here".
  activeBlockIndex: number | null;

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
  setInlineEditing: (v: boolean) => void;
  clearPendingCaret: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: "sources" | "outline") => void;
  setFormatting: (v: boolean) => void;
  openPreview: (mode: "docx" | "pdf") => void;
  setPreviewMode: (mode: PreviewMode) => void;
  closePreview: () => void;
  setThinkingEnabled: (v: boolean) => void;
  setComposerMode: (m: "ai" | "edit") => void;
  setComposerOpen: (open: boolean) => void;
  toggleComposer: () => void;
  setComposerInputFocused: (v: boolean) => void;
  setFocusMode: (v: boolean) => void;
  toggleFocusMode: () => void;
  setAskAiOpen: (v: boolean) => void;
  // Ask the active doc view to scroll to `index` (bumps the request nonce so a
  // repeat request for the same block still fires). Also raises `navigating`.
  requestScrollToBlock: (index: number) => void;
  setNavigating: (v: boolean) => void;
  flashBlock: (index: number) => void;
  setActiveBlockIndex: (index: number | null) => void;
  reset: () => void;
}

const INITIAL = {
  thesisId: null as string | null,
  selectedBlocks: [] as SelectedBlock[],
  multiSelect: false,
  editingBlockIndex: null as number | null,
  pendingCaret: null as { index: number; pos: number } | null,
  inlineEditing: false,
  activePanel: null as ActivePanel,
  isFormatting: false,
  previewMode: null as PreviewMode,
  thinkingEnabled: true,
  composerMode: "ai" as "ai" | "edit",
  composerOpen: true,
  composerInputFocused: false,
  focusMode: false,
  askAiOpen: false,
  scrollTarget: null as { index: number; nonce: number } | null,
  navigating: false,
  flashTarget: null as { index: number; nonce: number } | null,
  activeBlockIndex: null as number | null,
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

  clearSelection: () =>
    set({
      selectedBlocks: [],
      multiSelect: false,
      editingBlockIndex: null,
      pendingCaret: null,
      inlineEditing: false,
    }),

  setEditingBlock: (index, caretPos) =>
    set({
      editingBlockIndex: index,
      inlineEditing: index != null,
      pendingCaret: index != null && caretPos != null ? { index, pos: caretPos } : null,
    }),

  setInlineEditing: (v) => set({ inlineEditing: v }),

  clearPendingCaret: () => set({ pendingCaret: null }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  togglePanel: (panel) => {
    const current = get().activePanel;
    set({ activePanel: current === panel ? null : panel });
  },

  setFormatting: (v) => set({ isFormatting: v }),

  openPreview: (mode) => set({ previewMode: mode }),

  setPreviewMode: (mode) => set({ previewMode: mode }),

  closePreview: () => set({ previewMode: null }),

  setThinkingEnabled: (v) => set({ thinkingEnabled: v }),

  setComposerMode: (m) => set({ composerMode: m }),

  setComposerOpen: (open) => set({ composerOpen: open }),

  toggleComposer: () => set((s) => ({ composerOpen: !s.composerOpen })),

  setComposerInputFocused: (v) => set({ composerInputFocused: v }),

  setFocusMode: (v) => set({ focusMode: v }),

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  setAskAiOpen: (v) => set({ askAiOpen: v }),

  requestScrollToBlock: (index) =>
    set((s) => ({
      scrollTarget: { index, nonce: (s.scrollTarget?.nonce ?? 0) + 1 },
      navigating: true,
    })),

  setNavigating: (v) => set({ navigating: v }),

  flashBlock: (index) =>
    set((s) => ({ flashTarget: { index, nonce: (s.flashTarget?.nonce ?? 0) + 1 } })),

  setActiveBlockIndex: (index) =>
    set((s) => (s.activeBlockIndex === index ? {} : { activeBlockIndex: index })),

  reset: () => set(INITIAL),
}));
