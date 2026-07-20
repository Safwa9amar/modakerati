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
  /** Collapsed (bubble) vs expanded (full tool row). Default false = bubble. */
  expanded: boolean;
  /** Screen Y of the selecting tap → where the bubble spawns beside the block.
   *  null until a tap reports one. */
  anchorY: number | null;
  show: () => void;
  hide: () => void;
  setPos: (pos: Pos) => void;
  setExpanded: (expanded: boolean) => void;
  setAnchorY: (y: number) => void;
  reset: () => void;
}

export const useFloatingPillStore = create<FloatingPillState>((set) => ({
  visible: false,
  pos: null,
  expanded: false,
  anchorY: null,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false, expanded: false }),
  setPos: (pos) => set({ pos }),
  setExpanded: (expanded) => set({ expanded }),
  setAnchorY: (y) => set({ anchorY: y }),
  reset: () => set({ visible: false, pos: null, expanded: false, anchorY: null }),
}));
