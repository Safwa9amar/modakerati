import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeName } from "@/constants/colors";

type Language = "ar" | "en" | "fr";

interface SettingsState {
  theme: ThemeName;
  language: Language;
  hasCompletedOnboarding: boolean;
  setTheme: (theme: ThemeName) => void;
  setLanguage: (language: Language) => void;
  completeOnboarding: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      language: "fr",
      hasCompletedOnboarding: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
    }),
    {
      name: "modakerati-settings",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
