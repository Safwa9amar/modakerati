import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeName } from "@/constants/colors";

type Language = "ar" | "en" | "fr";

interface SettingsState {
  theme: ThemeName;
  language: Language;
  hasCompletedOnboarding: boolean;
  // When FALSE (default) document edits stay on-device while the user is in the
  // composer — the durable op queue holds them and flushes only on leaving the
  // editing surface (screen blur, preview switch, app background). TRUE restores
  // instant per-edit server sync. Read by the workspace/block-editor hold effects.
  syncWhileEditing: boolean;
  setTheme: (theme: ThemeName) => void;
  setLanguage: (language: Language) => void;
  completeOnboarding: () => void;
  setSyncWhileEditing: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      language: "fr",
      hasCompletedOnboarding: false,
      syncWhileEditing: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setSyncWhileEditing: (v) => set({ syncWhileEditing: v }),
    }),
    {
      name: "modakerati-settings",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
