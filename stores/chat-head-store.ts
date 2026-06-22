import { create } from "zustand";

interface ChatHeadState {
  // Whether the floating chat-head bubble is enabled at all. Off while the user
  // is actually on the Chat tab (the bubble would be redundant there) or signed
  // out — toggled by the bubble host from route/auth state.
  enabled: boolean;
  // Whether the chat panel is expanded out of the bubble into the full overlay.
  expanded: boolean;
  setEnabled: (v: boolean) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Global state for the Messenger-style chat head: a draggable bubble that floats
 * over the app and expands into the thesis chat. Kept in a store (not local
 * component state) so any screen can open/close it — e.g. "minimize to bubble".
 */
export const useChatHead = create<ChatHeadState>()((set, get) => ({
  enabled: true,
  expanded: false,
  setEnabled: (v) => set({ enabled: v, expanded: v ? get().expanded : false }),
  open: () => set({ expanded: true }),
  close: () => set({ expanded: false }),
  toggle: () => set((s) => ({ expanded: !s.expanded })),
}));
