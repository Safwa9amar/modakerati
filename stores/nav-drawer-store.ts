import { create } from "zustand";
import { makeMutable, withSpring } from "react-native-reanimated";

// Open/closed state for the Thesis Structure push-drawer (the root-level
// `PushDrawer`). The boolean is the SETTLED source of truth — the drawer's
// Reanimated `progress` is driven live by the edge/peek gestures and commits back
// here on release, and the reaction animates `progress` to match when this flips
// from a button / back / heading-tap. Replaces the old bottom-sheet "structure" key.
// The drawer hosts TWO views on the same panel (option A of the nav redesign):
// "app" — the global command list (new thesis, writer, tools, recent theses), and
// "outline" — the thesis structure that used to own this drawer outright. Closing
// always returns to "app" so the next open starts from the index, never mid-drill.
export type DrawerView = "app" | "outline";

interface NavDrawerState {
  open: boolean;
  view: DrawerView;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  setView: (view: DrawerView) => void;
  /** Open straight onto a view — used by the workspace's Contents button. */
  openView: (view: DrawerView) => void;
}

// UI-thread mirror of `open`, written SYNCHRONOUSLY by the actions below so the
// slide starts in the same frame as the call. Without it the animation waits for
// React to re-render `PushDrawer` and run an effect — two commits that can land
// several frames late while the workspace's JS thread is busy (that lag is exactly
// what reads as "the drawer takes a moment to appear" after a flick).
export const drawerOpenSV = makeMutable(false);

/**
 * 0 = closed, 1 = open — the drawer's VISUAL truth, and the only thing that decides
 * what the student sees. It lives here rather than in `PushDrawer` so the actions
 * below can settle it themselves.
 *
 * That matters: this used to be a component-local `useSharedValue` settled by an
 * animated reaction, and a reaction is EDGE-triggered. Any action writing a value
 * the shared value already held produced no settle at all — so a close request
 * while the store already believed itself closed left the drawer sitting open,
 * with a scrim whose `pointerEvents` was gated on that same stale boolean. That is
 * the "drawer is stuck and I can't close it" bug: visible, and untouchable. The
 * actions below are level-triggered instead — every call settles, so asking twice
 * always works.
 */
export const drawerProgressSV = makeMutable(0);

/** True only while a pan gesture owns `drawerProgressSV`. */
export const drawerDraggingSV = makeMutable(false);

const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;

// Drive both shared values from one place. Deliberately UNCONDITIONAL: an earlier
// version skipped the spring while `drawerDraggingSV` was true, which meant a
// gesture that somehow never reported its end wedged the drawer permanently. The
// guard was not load-bearing anyway — a live pan writes `drawerProgressSV` every
// frame from its own onUpdate, so the finger still wins over a spring started here.
function settle(open: boolean) {
  drawerOpenSV.value = open;
  drawerProgressSV.value = withSpring(open ? 1 : 0, SPRING);
}

export const useNavDrawerStore = create<NavDrawerState>((set, get) => ({
  open: false,
  view: "app",
  openDrawer: () => {
    settle(true);
    set({ open: true });
  },
  closeDrawer: () => {
    settle(false);
    // Reset the inner view on close, not on open: resetting on open would swap the
    // panel's content in the same frame the slide starts, which reads as a flicker.
    set({ open: false, view: "app" });
  },
  toggleDrawer: () => {
    const next = !get().open;
    settle(next);
    set(next ? { open: true } : { open: false, view: "app" });
  },
  setView: (view) => set({ view }),
  openView: (view) => {
    settle(true);
    set({ open: true, view });
  },
}));
