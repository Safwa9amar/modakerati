import { create } from "zustand";

export type ActivePanel = "sources" | "outline" | null;

interface WorkspaceState {
  thesisId: string | null;
  selectedBlockIndex: number | null;
  selectedBlockText: string | null;
  activePanel: ActivePanel;
  isFormatting: boolean;

  setThesis: (id: string) => void;
  selectBlock: (index: number, text: string | null) => void;
  clearSelection: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: "sources" | "outline") => void;
  setFormatting: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  thesisId: null as string | null,
  selectedBlockIndex: null as number | null,
  selectedBlockText: null as string | null,
  activePanel: null as ActivePanel,
  isFormatting: false,
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...INITIAL,

  setThesis: (id) => set({ thesisId: id }),

  selectBlock: (index, text) => set({
    selectedBlockIndex: index,
    selectedBlockText: text,
  }),

  clearSelection: () => set({
    selectedBlockIndex: null,
    selectedBlockText: null,
  }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  togglePanel: (panel) => {
    const current = get().activePanel;
    set({ activePanel: current === panel ? null : panel });
  },

  setFormatting: (v) => set({ isFormatting: v }),

  reset: () => set(INITIAL),
}));
