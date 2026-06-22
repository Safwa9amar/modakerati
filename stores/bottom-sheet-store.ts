import { create } from "zustand";

// One name per globally-controlled bottom sheet. Add new sheets here as they're
// migrated to the store so any screen can open them without prop plumbing.
export type SheetName = "structure" | "ask" | "new-thesis";

interface BottomSheetState {
  openSheets: Set<SheetName>;
  openSheet: (name: SheetName) => void;
  closeSheet: (name: SheetName) => void;
  closeAllSheets: () => void;
  isOpen: (name: SheetName) => boolean;
}

/**
 * Global control for gorhom bottom sheets. A sheet component subscribes to
 * `openSheets.has(<its name>)` to present/dismiss itself; any caller opens it
 * with `useBottomSheet.getState().openSheet("structure")`.
 */
export const useBottomSheet = create<BottomSheetState>()((set, get) => ({
  openSheets: new Set<SheetName>(),

  openSheet: (name) =>
    set((state) => {
      const next = new Set(state.openSheets);
      next.add(name);
      return { openSheets: next };
    }),

  closeSheet: (name) =>
    set((state) => {
      const next = new Set(state.openSheets);
      next.delete(name);
      return { openSheets: next };
    }),

  closeAllSheets: () => set({ openSheets: new Set() }),

  isOpen: (name) => get().openSheets.has(name),
}));
