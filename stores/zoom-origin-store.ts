import { create } from "zustand";

// Where on screen the tap that opened the next screen landed.
//
// A screen cannot know what opened it — the navigator hands it params, not a
// gesture — so the control that navigates leaves the point behind here and the
// screen picks it up on mount. One value, not a map: only one navigation is ever
// in flight, and a stale point outliving its navigation is exactly what the
// take-once read below prevents.
//
// The POINT of the tap, not the button's rect. A finger is what the animation has
// to look like it came out of, and the press event carries that for free —
// measuring the button costs an async round-trip that would land after the push.

export interface ZoomOrigin {
  x: number;
  y: number;
}

/** A mounted `ZoomFromOrigin`, able to play its animation backwards. */
export interface Collapser {
  id: number;
  run: (done: () => void) => void;
}

interface ZoomOriginState {
  origin: ZoomOrigin | null;
  /** Leave the tap point for the screen about to be pushed. */
  setOrigin: (x: number, y: number) => void;
  /**
   * Read it and clear it, in one go. Clearing is what keeps the zoom honest:
   * a screen opened from anywhere else — a deep link, a thesis card, a redirect —
   * finds nothing here and fades in instead of growing out of wherever the last
   * chip happened to be.
   */
  take: () => ZoomOrigin | null;

  /**
   * Every mounted zoom wrapper, innermost last.
   *
   * A STACK, not a single slot: the Library is one of these screens and can push
   * the Writer, which is another, so two are alive at once. Last in wins — it is
   * the one on top — and each removes only its OWN entry on unmount, so popping
   * the Writer hands control back to the Library rather than leaving nothing
   * registered.
   *
   * Registered here rather than through React context because the component that
   * needs to collapse a screen is usually the screen ITSELF — the owner of the
   * wrapper, which sits above the provider and could never read it.
   */
  collapsers: Collapser[];
  register: (c: Collapser) => void;
  unregister: (id: number) => void;
}

const EMPTY_COLLAPSERS: Collapser[] = [];

export const useZoomOriginStore = create<ZoomOriginState>((set, get) => ({
  origin: null,
  setOrigin: (x, y) => set({ origin: { x, y } }),
  take: () => {
    const { origin } = get();
    if (origin) set({ origin: null });
    return origin;
  },

  collapsers: EMPTY_COLLAPSERS,
  register: (c) => set((s) => ({ collapsers: [...s.collapsers, c] })),
  unregister: (id) =>
    set((s) => {
      const next = s.collapsers.filter((c) => c.id !== id);
      // Hand back the shared empty array rather than a fresh `[]`, so a selector
      // reading this never sees a new snapshot for an unchanged empty list.
      return { collapsers: next.length ? next : EMPTY_COLLAPSERS };
    }),
}));
