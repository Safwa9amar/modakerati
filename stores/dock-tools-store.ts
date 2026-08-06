import { create } from "zustand";

interface DockToolsState {
  open: boolean;
  /** Which detent the drawer rests at: 0 = half, 1 = tall. */
  detent: 0 | 1;
  openSheet: () => void;
  close: () => void;
  toggle: () => void;
  setDetent: (d: 0 | 1) => void;
}

/**
 * The document tool sheet's own state — the same shape as the Insert menu's and
 * the header/footer editor's, because it is the same surface: a root-level push
 * drawer (`components/DockToolsSheet`) that slides up while the whole app recedes
 * behind it.
 *
 * It always opens at the SMALL detent; the drag can take it taller. Callers open
 * it imperatively — `useDockToolsStore.getState().openSheet()` — from the writer's
 * bottom-edge grip and from the floating bubble's ⋮⋮ drop target.
 */
export const useDockToolsStore = create<DockToolsState>((set, get) => ({
  open: false,
  detent: 0,
  openSheet: () => set({ open: true, detent: 0 }),
  close: () => set({ open: false }),
  toggle: () => (get().open ? set({ open: false }) : set({ open: true, detent: 0 })),
  setDetent: (d) => set({ detent: d }),
}));
