import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeName } from "@/constants/colors";

type Language = "ar" | "en" | "fr";

interface SettingsState {
  theme: ThemeName;
  language: Language;
  hasCompletedOnboarding: boolean;
  // When TRUE (default) document edits sync to the server AS the user edits: the
  // op-queue pump isn't held and the Lexical Writer flushes on a short pause — more
  // durable (fewer chances to lose work). FALSE holds edits on-device while in the
  // editing surface and flushes only on leaving it (screen blur, preview switch,
  // app background). Read by the workspace/block-editor hold effects.
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
      syncWhileEditing: true,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setSyncWhileEditing: (v) => set({ syncWhileEditing: v }),
    }),
    {
      name: "modakerati-settings",
      storage: createJSONStorage(() => AsyncStorage),
      // v1: sync-while-editing became the default ON. Flip existing installs that
      // still carry the old default so the new behaviour actually takes effect.
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 1) return { ...s, syncWhileEditing: true } as SettingsState;
        return s as SettingsState;
      },
    }
  )
);
