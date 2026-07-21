import { create } from "zustand";

// Open/closed state for the Thesis Structure push-drawer (the root-level
// `PushDrawer`). The boolean is the SETTLED source of truth — the drawer's
// Reanimated `progress` is driven live by the edge/peek gestures and commits back
// here on release, and an effect animates `progress` to match when this flips from
// a button / back / heading-tap. Replaces the old bottom-sheet "structure" key.
interface NavDrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useNavDrawerStore = create<NavDrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  toggleDrawer: () => set((s) => ({ open: !s.open })),
}));
