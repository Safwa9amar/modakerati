// stores/ribbon-store.ts
import { create } from "zustand";
import type { RibbonTabId } from "@/components/workspace/ribbon/ribbon-config";

// "home" is the existing edit-tools tab (not part of RIBBON_TABS); the rest are
// config tab ids. This union is the single tab identifier used across the ribbon.
export type TabBarId = "home" | RibbonTabId;

interface RibbonState {
  activeTab: TabBarId;
  searchOpen: boolean;
  // Tool ids pinned to the favorites quick-row (in-memory for Phase 1).
  favorites: string[];
  setActiveTab: (tab: TabBarId) => void;
  setSearchOpen: (open: boolean) => void;
  toggleFavorite: (toolId: string) => void;
  reset: () => void;
}

const INITIAL = {
  activeTab: "home" as TabBarId,
  searchOpen: false,
  // Seed the quick-row with a few high-value defaults.
  favorites: ["design.thesisReady", "layout.margins", "ref.toc"] as string[],
};

export const useRibbonStore = create<RibbonState>((set) => ({
  ...INITIAL,
  setActiveTab: (activeTab) => set({ activeTab }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  toggleFavorite: (toolId) =>
    set((s) => ({
      favorites: s.favorites.includes(toolId)
        ? s.favorites.filter((f) => f !== toolId)
        : [...s.favorites, toolId],
    })),
  reset: () => set(INITIAL),
}));
