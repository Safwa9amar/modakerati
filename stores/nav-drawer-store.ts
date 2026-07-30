import { create } from "zustand";
import { makeMutable } from "react-native-reanimated";

// Open/closed state for the Thesis Structure push-drawer (the root-level
// `PushDrawer`). The boolean is the SETTLED source of truth — the drawer's
// Reanimated `progress` is driven live by the edge/peek gestures and commits back
// here on release, and the reaction animates `progress` to match when this flips
// from a button / back / heading-tap. Replaces the old bottom-sheet "structure" key.
interface NavDrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

// UI-thread mirror of `open`, written SYNCHRONOUSLY by the actions below so the
// slide starts in the same frame as the call. Without it the animation waits for
// React to re-render `PushDrawer` and run an effect — two commits that can land
// several frames late while the workspace's JS thread is busy (that lag is exactly
// what reads as "the drawer takes a moment to appear" after a flick).
export const drawerOpenSV = makeMutable(false);

export const useNavDrawerStore = create<NavDrawerState>((set, get) => ({
  open: false,
  openDrawer: () => {
    drawerOpenSV.value = true;
    set({ open: true });
  },
  closeDrawer: () => {
    drawerOpenSV.value = false;
    set({ open: false });
  },
  toggleDrawer: () => {
    const next = !get().open;
    drawerOpenSV.value = next;
    set({ open: next });
  },
}));
