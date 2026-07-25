import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeName } from "@/constants/colors";

type Language = "ar" | "en" | "fr";

interface SettingsState {
  theme: ThemeName;
  language: Language;
  hasCompletedOnboarding: boolean;
  // When TRUE (default) the Lexical Writer streams AI ghost-text completions as the
  // student types (see stores/completion-store). FALSE fully disables the feature —
  // no completion fetches, no ghost. Read by WorkspaceLexicalView (completionEnabled).
  autocompleteEnabled: boolean;
  setTheme: (theme: ThemeName) => void;
  setLanguage: (language: Language) => void;
  completeOnboarding: () => void;
  setAutocompleteEnabled: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      language: "fr",
      hasCompletedOnboarding: false,
      autocompleteEnabled: true,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setAutocompleteEnabled: (v) => {
        console.log(`[autocomplete] setting toggled ${v ? "ON" : "OFF"}`);
        set({ autocompleteEnabled: v });
      },
    }),
    {
      name: "modakerati-settings",
      storage: createJSONStorage(() => AsyncStorage),
      // v2: autocompleteEnabled introduced, default ON.
      // v4: the "sync while editing" toggle was removed — the Lexical Writer now
      // always saves to the server on a short pause (the local-first path lost
      // edits). Any persisted syncWhileEditing value is simply ignored.
      version: 4,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 2) return { ...s, autocompleteEnabled: s.autocompleteEnabled ?? true } as SettingsState;
        return s as SettingsState;
      },
    }
  )
);
