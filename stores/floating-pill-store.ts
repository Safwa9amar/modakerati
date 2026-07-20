import { create } from "zustand";

interface Pos {
  x: number;
  y: number;
}

interface FloatingPillState {
  /** Whether the persistent floating pill is on screen at all. Set true on the
   *  first block selection; only set false by a drag-to-X dismiss. */
  visible: boolean;
  /** Last dragged top-left position (screen coords). null → the overlay uses its
   *  computed default spawn spot. Session-scoped (reset on workspace exit). */
  pos: Pos | null;
  show: () => void;
  hide: () => void;
  setPos: (pos: Pos) => void;
  reset: () => void;
}

export const useFloatingPillStore = create<FloatingPillState>((set) => ({
  visible: false,
  pos: null,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
  setPos: (pos) => set({ pos }),
  reset: () => set({ visible: false, pos: null }),
}));
